const crypto = require("crypto");
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const Payment = require("../models/Payment");
const PaymentWebhookEvent = require("../models/PaymentWebhookEvent");
const Order = require("../models/Order");
const CheckoutAttempt = require("../models/CheckoutAttempt");
const javaService = require("./javaService");
const razorpayConfig = require("../config/razorpay");

const createPaymentError = (message, code, statusCode = 400) =>
    Object.assign(new Error(message), { code, statusCode });

const logPayment = (level, event, details = {}) => {
    const writer = console[level] || console.log;
    writer(JSON.stringify({ event, ...details }));
};

const getProviderErrorCode = (error) =>
    String(
        error?.error?.code
        || error?.code
        || error?.statusCode
        || error?.name
        || "PROVIDER_ERROR"
    ).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

const getExpectedAmountMinor = (order) => {
    const amount = Number(order.finalAmount);
    if (!Number.isFinite(amount) || amount < 1) {
        throw createPaymentError("Order amount is invalid for payment", "INVALID_ORDER_AMOUNT", 409);
    }
    const amountMinor = Math.round(amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) {
        throw createPaymentError("Order amount is invalid for payment", "INVALID_ORDER_AMOUNT", 409);
    }
    return amountMinor;
};

const verifyCheckoutSignature = (razorpayOrderId, razorpayPaymentId, signature) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
        throw createPaymentError("Razorpay server configuration is missing", "RAZORPAY_CONFIG_MISSING", 503);
    }
    if (
        typeof razorpayOrderId !== "string"
        || typeof razorpayPaymentId !== "string"
        || typeof signature !== "string"
        || !/^[a-f0-9]{64}$/i.test(signature)
    ) {
        return false;
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest();
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(expected, received);
};

const verifyWebhookSignature = (rawBody, signature) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        throw createPaymentError("Razorpay webhook configuration is missing", "RAZORPAY_CONFIG_MISSING", 503);
    }
    if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(expected, received);
};

const getOwnedOrder = async (userId, orderId) => {
    if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId)) {
        throw createPaymentError("A valid application order ID is required", "INVALID_ORDER_ID");
    }
    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) {
        throw createPaymentError("Order not found", "ORDER_NOT_FOUND", 404);
    }
    return order;
};

const getProviderReceipt = (orderId, attemptId) =>
    `${String(orderId).slice(-20)}-${attemptId.slice(0, 16)}`;

const getMatchingProviderOrder = async (client, order, attemptId, amountMinor) => {
    const receipt = getProviderReceipt(order._id, attemptId);
    const response = await client.orders.all({ receipt, count: 100, skip: 0 });
    if (!Array.isArray(response?.items)) {
        throw createPaymentError(
            "Razorpay returned an invalid order lookup response",
            "RAZORPAY_ORDER_LOOKUP_INVALID",
            502
        );
    }

    const receiptMatches = response.items.filter((item) => item?.receipt === receipt);
    const exactMatches = receiptMatches.filter((item) =>
        typeof item.id === "string"
        && Number(item.amount) === amountMinor
        && item.currency === "INR"
        && item.status === "created"
        && item.notes?.applicationOrderId === String(order._id)
        && item.notes?.paymentAttemptId === attemptId
    );

    if (receiptMatches.length === 0) return { order: null, ambiguous: false };
    if (receiptMatches.length !== 1 || exactMatches.length !== 1) {
        return { order: null, ambiguous: true };
    }
    return { order: exactMatches[0], ambiguous: false };
};

const logProviderOrderLookup = (level, event, context, error = null) => {
    logPayment(level, event, {
        requestId: context.requestId || "",
        applicationOrderId: String(context.order._id),
        checkoutId: context.order.checkoutId || "",
        paymentId: String(context.payment._id),
        attemptId: context.attemptId,
        ...(context.providerOrderId ? { providerOrderId: context.providerOrderId } : {}),
        ...(error ? { errorCode: getProviderErrorCode(error) } : {})
    });
};

const persistProviderOrder = async (payment, providerOrder) => {
    let result;
    try {
        result = await Payment.updateOne(
            {
                _id: payment._id,
                providerCreateState: { $in: ["CREATING", "UNKNOWN"] },
                razorpayOrderId: { $in: ["", null] }
            },
            {
                $set: {
                    razorpayOrderId: providerOrder.id,
                    providerCreateState: "CREATED"
                }
            }
        );
    } catch (error) {
        logPayment("error", "razorpay_order_persistence_unresolved", {
            applicationOrderId: String(payment.orderId),
            paymentId: String(payment._id),
            attemptId: payment.attemptId,
            providerOrderId: providerOrder.id,
            errorCode: getProviderErrorCode(error)
        });
        throw createPaymentError(
            "Razorpay has an order for this attempt, but it could not be saved yet. Retry this same checkout; do not start another payment.",
            "PAYMENT_ORDER_UNRESOLVED",
            409
        );
    }
    if (result.matchedCount === 1) return;

    const current = await Payment.findOne({ _id: payment._id });
    if (
        current?.providerCreateState === "CREATED"
        && current.razorpayOrderId === providerOrder.id
    ) {
        return;
    }
    throw createPaymentError(
        "Payment order could not be safely reconciled; contact support",
        "PAYMENT_ORDER_UNRESOLVED",
        409
    );
};

const paymentOrderResponse = (payment, order) => ({
    keyId: process.env.RAZORPAY_KEY_ID,
    id: payment.razorpayOrderId,
    amount: payment.amountMinor,
    currency: payment.currency,
    applicationOrderId: String(order._id),
    paymentAttemptId: payment.attemptId
});

const isConfirmedProviderRejection = (error) =>
    [401, 403, 404, 422].includes(Number(error?.statusCode));

const createPaymentOrder = async ({ userId, orderId, attemptId, requestId }) => {
    if (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(attemptId)) {
        throw createPaymentError("A valid payment attempt ID is required", "INVALID_ATTEMPT_ID");
    }
    const order = await getOwnedOrder(userId, orderId);
    if (order.paymentStatus === "Paid" || order.status === "Cancelled") {
        throw createPaymentError("This order is not available for payment", "ORDER_NOT_PAYABLE", 409);
    }
    if (order.paymentMethod === "Cash On Delivery") {
        throw createPaymentError("Cash-on-delivery orders do not use Razorpay", "INVALID_PAYMENT_METHOD", 409);
    }

    const alreadySettledPayment = await Payment.findOne({
        userId,
        orderId: order._id,
        paymentStatus: { $in: ["Success", "Refunded"] }
    });
    if (alreadySettledPayment) {
        throw createPaymentError("This order already has a confirmed payment", "ORDER_NOT_PAYABLE", 409);
    }

    const amountMinor = getExpectedAmountMinor(order);
    const razorpayClient = razorpayConfig.getRazorpayClient();
    const paymentLock = await Order.updateOne(
        {
            _id: order._id,
            userId,
            paymentStatus: "Pending",
            $or: [
                { activePaymentAttemptId: attemptId },
                { activePaymentAttemptId: null },
                { activePaymentAttemptId: { $exists: false } }
            ]
        },
        { $set: { activePaymentAttemptId: attemptId } }
    );
    if (paymentLock.matchedCount !== 1) {
        throw createPaymentError(
            "Another payment attempt for this order is still unresolved",
            "PAYMENT_ATTEMPT_BUSY",
            409
        );
    }

    let payment;
    try {
        payment = await Payment.create({
            userId,
            orderId: order._id,
            amount: amountMinor / 100,
            amountMinor,
            currency: "INR",
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            attemptId,
            providerCreateState: "CREATING"
        });
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }
        payment = await Payment.findOne({ userId, orderId: order._id, attemptId });
        if (!payment) {
            throw createPaymentError("Payment attempt is being processed", "PAYMENT_ATTEMPT_BUSY", 409);
        }
        if (payment.paymentStatus === "Failed") {
            await Order.updateOne(
                { _id: order._id, userId, activePaymentAttemptId: attemptId, paymentStatus: "Pending" },
                { $unset: { activePaymentAttemptId: 1 } }
            );
            throw createPaymentError("This payment attempt failed; start a new attempt", "PAYMENT_ATTEMPT_FAILED", 409);
        }
        if (["Success", "Refunded"].includes(payment.paymentStatus)) {
            throw createPaymentError("This payment has already been confirmed", "ORDER_NOT_PAYABLE", 409);
        }
        if (payment.providerCreateState === "CREATED" && payment.razorpayOrderId) {
            return paymentOrderResponse(payment, order);
        }

        let lookup;
        try {
            lookup = await getMatchingProviderOrder(
                razorpayClient,
                order,
                attemptId,
                amountMinor
            );
        } catch (error) {
            logProviderOrderLookup(
                "warn",
                "razorpay_order_lookup_failed",
                { requestId, order, payment, attemptId },
                error
            );
            throw createPaymentError(
                "Razorpay order lookup is unavailable. Retry this same checkout later; do not start another payment.",
                "PAYMENT_ORDER_UNRESOLVED",
                409
            );
        }

        if (lookup.order) {
            await persistProviderOrder(payment, lookup.order);
            logProviderOrderLookup("info", "razorpay_order_reconciled", {
                requestId,
                order,
                payment,
                attemptId,
                providerOrderId: lookup.order.id
            });
            payment.razorpayOrderId = lookup.order.id;
            payment.providerCreateState = "CREATED";
            return paymentOrderResponse(payment, order);
        }

        logProviderOrderLookup(
            lookup.ambiguous ? "error" : "warn",
            lookup.ambiguous
                ? "razorpay_order_lookup_ambiguous"
                : "razorpay_order_lookup_no_match",
            { requestId, order, payment, attemptId }
        );
        throw createPaymentError(
            "Razorpay order creation is still being reconciled. Retry this same checkout shortly; do not start another payment. Contact support if it remains unresolved.",
            "PAYMENT_ORDER_UNRESOLVED",
            409
        );
    }

    const receipt = getProviderReceipt(order._id, attemptId);
    let providerOrder;
    try {
        providerOrder = await razorpayClient.orders.create({
            amount: amountMinor,
            currency: "INR",
            receipt,
            notes: {
                applicationOrderId: String(order._id),
                paymentAttemptId: attemptId
            }
        });
    } catch (error) {
        const context = { requestId, order, payment, attemptId };
        logProviderOrderLookup(
            "warn",
            "razorpay_order_create_request_failed",
            context,
            error
        );

        let lookup;
        let lookupFailed = false;
        try {
            lookup = await getMatchingProviderOrder(
                razorpayClient,
                order,
                attemptId,
                amountMinor
            );
        } catch (lookupError) {
            lookupFailed = true;
            logProviderOrderLookup(
                "warn",
                "razorpay_order_lookup_failed",
                context,
                lookupError
            );
        }

        if (lookup?.order) {
            await persistProviderOrder(payment, lookup.order);
            payment.razorpayOrderId = lookup.order.id;
            payment.providerCreateState = "CREATED";
            logProviderOrderLookup("info", "razorpay_order_reconciled", {
                ...context,
                providerOrderId: lookup.order.id
            });
            return paymentOrderResponse(payment, order);
        }

        if (lookup && !lookupFailed) {
            logProviderOrderLookup(
                lookup.ambiguous ? "error" : "warn",
                lookup.ambiguous
                    ? "razorpay_order_lookup_ambiguous"
                    : "razorpay_order_lookup_no_match",
                context
            );
        }

        const confirmedFailure =
            !lookupFailed
            && !lookup?.ambiguous
            && isConfirmedProviderRejection(error);
        await Payment.updateOne(
            { _id: payment._id, providerCreateState: "CREATING" },
            {
                $set: confirmedFailure
                    ? {
                        providerCreateState: "FAILED",
                        paymentStatus: "Failed",
                        providerResolutionSource: "API_REJECTION",
                        providerResolutionReference: getProviderErrorCode(error),
                        providerResolvedAt: new Date()
                    }
                    : { providerCreateState: "UNKNOWN" }
            }
        );
        if (confirmedFailure) {
            await Order.updateOne(
                { _id: order._id, userId, activePaymentAttemptId: attemptId, paymentStatus: "Pending" },
                { $unset: { activePaymentAttemptId: 1 } }
            );
            logPayment("warn", "razorpay_order_creation_rejected", {
                requestId: requestId || "",
                applicationOrderId: String(order._id),
                checkoutId: order.checkoutId || "",
                paymentId: String(payment._id),
                attemptId,
                errorCode: getProviderErrorCode(error)
            });
            throw createPaymentError(
                "Razorpay rejected this order request and no matching order was found. Start a new payment attempt.",
                "PAYMENT_ATTEMPT_FAILED",
                409
            );
        }

        logPayment("error", "razorpay_order_creation_unresolved", {
            requestId: requestId || "",
            applicationOrderId: String(order._id),
            checkoutId: order.checkoutId || "",
            paymentId: String(payment._id),
            attemptId,
            errorCode: getProviderErrorCode(error)
        });
        throw createPaymentError(
            "Razorpay could not confirm order creation. Your checkout is protected; retry with the same attempt ID to check again. Contact support if it remains unresolved.",
            "RAZORPAY_ORDER_CREATION_FAILED",
            502
        );
    }

    if (
        !providerOrder?.id
        || Number(providerOrder.amount) !== amountMinor
        || providerOrder.currency !== "INR"
        || providerOrder.status !== "created"
        || providerOrder.receipt !== receipt
    ) {
        await Payment.updateOne(
            { _id: payment._id, providerCreateState: "CREATING" },
            { $set: { providerCreateState: "UNKNOWN" } }
        );
        throw createPaymentError(
            "Razorpay returned an unexpected order response; reconciliation is required",
            "PAYMENT_ORDER_UNRESOLVED",
            409
        );
    }

    await persistProviderOrder(payment, providerOrder);
    payment.razorpayOrderId = providerOrder.id;
    payment.providerCreateState = "CREATED";
    return paymentOrderResponse(payment, order);
};

const resolveUnknownPaymentAttempt = async ({
    orderId,
    attemptId,
    adminId,
    evidenceReference,
    requestId
}) => {
    if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId)) {
        throw createPaymentError("A valid application order ID is required", "INVALID_ORDER_ID");
    }
    if (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(attemptId)) {
        throw createPaymentError("A valid payment attempt ID is required", "INVALID_ATTEMPT_ID");
    }
    if (typeof adminId !== "string" || !mongoose.isValidObjectId(adminId)) {
        throw createPaymentError("A valid administrator identity is required", "INVALID_ADMIN_ID", 401);
    }
    if (
        typeof evidenceReference !== "string"
        || !/^[A-Za-z0-9._/-]{8,128}$/.test(evidenceReference)
    ) {
        throw createPaymentError(
            "A Dashboard verification reference is required",
            "INVALID_RECONCILIATION_EVIDENCE"
        );
    }

    const order = await Order.findOne({ _id: orderId });
    if (!order) {
        throw createPaymentError("Order not found", "ORDER_NOT_FOUND", 404);
    }
    if (
        order.paymentStatus !== "Pending"
        || order.status === "Cancelled"
    ) {
        throw createPaymentError(
            "The order is no longer waiting on this payment attempt",
            "PAYMENT_ATTEMPT_STATE_CHANGED",
            409
        );
    }

    const payment = await Payment.findOne({
        orderId: order._id,
        userId: order.userId,
        attemptId
    });
    if (!payment || Number(payment.amountMinor) !== getExpectedAmountMinor(order)) {
        throw createPaymentError(
            "Payment attempt does not match the order",
            "PAYMENT_ORDER_MISMATCH",
            409
        );
    }
    if (
        payment.providerCreateState === "FAILED"
        && payment.providerResolutionSource === "DASHBOARD"
        && payment.providerResolutionReference === evidenceReference
    ) {
        await Order.updateOne(
            {
                _id: order._id,
                userId: order.userId,
                paymentStatus: "Pending",
                activePaymentAttemptId: attemptId
            },
            { $unset: { activePaymentAttemptId: 1 } }
        );
        return { resolved: true, retryAllowed: true, idempotent: true };
    }
    if (order.activePaymentAttemptId !== attemptId) {
        throw createPaymentError(
            "The order is no longer waiting on this payment attempt",
            "PAYMENT_ATTEMPT_STATE_CHANGED",
            409
        );
    }
    if (
        payment.paymentStatus !== "Pending"
        || payment.providerCreateState !== "UNKNOWN"
        || payment.razorpayOrderId
        || payment.paymentMethod !== "Razorpay"
    ) {
        throw createPaymentError(
            "Only an unresolved payment with no provider order can be manually resolved",
            "PAYMENT_ATTEMPT_NOT_UNRESOLVED",
            409
        );
    }

    const resolutionTime = new Date();
    const updated = await Payment.updateOne(
        {
            _id: payment._id,
            orderId: order._id,
            userId: order.userId,
            attemptId,
            paymentStatus: "Pending",
            providerCreateState: "UNKNOWN",
            razorpayOrderId: ""
        },
        {
            $set: {
                paymentStatus: "Failed",
                providerCreateState: "FAILED",
                providerResolutionSource: "DASHBOARD",
                providerResolutionReference: evidenceReference,
                providerResolvedBy: adminId,
                providerResolvedAt: resolutionTime
            }
        }
    );
    if (updated.matchedCount !== 1) {
        throw createPaymentError(
            "Payment attempt changed during reconciliation; reload and check its current state",
            "PAYMENT_ATTEMPT_STATE_CHANGED",
            409
        );
    }

    await Order.updateOne(
        {
            _id: order._id,
            userId: order.userId,
            paymentStatus: "Pending",
            activePaymentAttemptId: attemptId
        },
        { $unset: { activePaymentAttemptId: 1 } }
    );
    logPayment("warn", "razorpay_attempt_manually_resolved_no_order", {
        requestId: requestId || "",
        applicationOrderId: String(order._id),
        checkoutId: order.checkoutId || "",
        paymentId: String(payment._id),
        attemptId,
        adminId,
        evidenceReference
    });
    return { resolved: true, retryAllowed: true, idempotent: false };
};

const getReservations = (order) => {
    if (!order.checkoutId || !order.warehouseId || !Array.isArray(order.items)) {
        return null;
    }
    return order.items.map((item) => ({
        checkoutId: order.checkoutId,
        warehouseId: String(order.warehouseId),
        productId: String(item.productId),
        quantity: Number(item.quantity)
    }));
};

const finalizeCapturedPayment = async (payment, providerPayment, source) => {
    const order = await Order.findById(payment.orderId);
    if (!order || String(order.userId) !== String(payment.userId)) {
        throw createPaymentError("Payment is not associated with its application order", "ORDER_BINDING_MISMATCH", 409);
    }
    if (
        providerPayment.order_id !== payment.razorpayOrderId
        || Number(providerPayment.amount) !== Number(payment.amountMinor)
        || providerPayment.currency !== payment.currency
        || providerPayment.status !== "captured"
        || providerPayment.captured !== true
    ) {
        throw createPaymentError("Provider payment does not match the expected order", "PROVIDER_PAYMENT_MISMATCH", 409);
    }

    const verifiedAt = payment.verifiedAt || new Date();
    const captureClaim = await Order.updateOne(
        {
            _id: order._id,
            userId: order.userId,
            $or: [
                { capturedPaymentId: providerPayment.id },
                { capturedPaymentId: null },
                { capturedPaymentId: { $exists: false } }
            ]
        },
        {
            $set: {
                paymentStatus: "Paid",
                capturedPaymentId: providerPayment.id
            }
        }
    );
    if (captureClaim.matchedCount !== 1) {
        await Payment.updateOne(
            { _id: payment._id },
            {
                $set: {
                    paymentStatus: payment.refundStatus === "FULL" ? "Refunded" : "Success",
                    razorpayPaymentId: providerPayment.id,
                    transactionId: providerPayment.id,
                    verifiedAt,
                    verificationSource: source,
                    paidAt: verifiedAt
                }
            }
        );
        if (order.checkoutId) {
            await CheckoutAttempt.updateOne(
                { userId: order.userId, checkoutId: order.checkoutId },
                {
                    $set: {
                        paymentState: "SUCCEEDED",
                        paymentReference: payment.razorpayOrderId,
                        status: "MANUAL_REVIEW",
                        lastRecoveryErrorCode: "MULTIPLE_CAPTURED_PAYMENTS"
                    }
                }
            );
        }
        logPayment("error", "multiple_captured_payments_for_order", {
            applicationOrderId: String(order._id)
        });
        return { paid: true, reconciliationPending: true };
    }

    const previousCapture = await Payment.findOne({
        orderId: order._id,
        paymentStatus: "Success",
        verifiedAt: { $ne: null },
        razorpayPaymentId: { $ne: providerPayment.id }
    });
    await Payment.updateOne(
        { _id: payment._id },
        {
            $set: {
                paymentStatus: payment.refundStatus === "FULL" ? "Refunded" : "Success",
                razorpayPaymentId: providerPayment.id,
                transactionId: providerPayment.id,
                verifiedAt,
                verificationSource: source,
                paidAt: verifiedAt
            }
        }
    );
    if (previousCapture) {
        if (order.checkoutId) {
            await CheckoutAttempt.updateOne(
                { userId: order.userId, checkoutId: order.checkoutId },
                {
                    $set: {
                        paymentState: "SUCCEEDED",
                        paymentReference: payment.razorpayOrderId,
                        status: "MANUAL_REVIEW",
                        lastRecoveryErrorCode: "MULTIPLE_CAPTURED_PAYMENTS"
                    }
                }
            );
        }
        logPayment("error", "multiple_captured_payments_for_order", {
            applicationOrderId: String(order._id)
        });
        return { paid: true, reconciliationPending: true };
    }

    if (!order.checkoutId) {
        logPayment("error", "verified_payment_missing_checkout_attempt", {
            applicationOrderId: String(order._id)
        });
        return { paid: true, reconciliationPending: true };
    }

    const attempt = await CheckoutAttempt.findOne({ userId: order.userId, checkoutId: order.checkoutId });
    if (!attempt) {
        logPayment("error", "verified_payment_missing_checkout_attempt", {
            applicationOrderId: String(order._id),
            checkoutId: order.checkoutId
        });
        return { paid: true, reconciliationPending: true };
    }

    await CheckoutAttempt.updateOne(
        { _id: attempt._id },
        {
            $set: {
                paymentState: "SUCCEEDED",
                paymentReference: payment.razorpayOrderId,
                status: "RECOVERY_REQUIRED",
                orderId: order._id,
                leaseExpiresAt: new Date(),
                recoveryLeaseUntil: null,
                lastRecoveryErrorCode: ""
            }
        }
    );

    const reservations = getReservations(order);
    if (!reservations) {
        await CheckoutAttempt.updateOne(
            { _id: attempt._id },
            { $set: { status: "MANUAL_REVIEW", lastRecoveryErrorCode: "ORDER_RESERVATION_LIST_MISSING" } }
        );
        logPayment("error", "verified_payment_reservation_data_missing", {
            applicationOrderId: String(order._id)
        });
        return { paid: true, reconciliationPending: true };
    }

    try {
        for (const reservation of reservations) {
            await javaService.commitInventoryReservation(reservation);
        }
        const cancelled = order.status === "Cancelled";
        await CheckoutAttempt.updateOne(
            { _id: attempt._id },
            {
                $set: {
                    status: cancelled ? "MANUAL_REVIEW" : "COMPLETED",
                    lastRecoveryErrorCode: cancelled ? "LATE_PAYMENT_AFTER_CANCELLATION" : ""
                }
            }
        );
        if (cancelled) {
            logPayment("error", "verified_payment_after_order_cancellation", {
                applicationOrderId: String(order._id)
            });
        }
        return { paid: true, reconciliationPending: cancelled };
    } catch (error) {
        await CheckoutAttempt.updateOne(
            { _id: attempt._id },
            {
                $set: {
                    status: "RECOVERY_REQUIRED",
                    lastRecoveryErrorCode: String(error.code || error.name || "INVENTORY_ERROR").slice(0, 80),
                    leaseExpiresAt: new Date()
                }
            }
        );
        logPayment("error", "verified_payment_inventory_commit_pending", {
            applicationOrderId: String(order._id),
            errorCode: String(error.code || error.name || "INVENTORY_ERROR").slice(0, 80)
        });
        return { paid: true, reconciliationPending: true };
    }
};

const verifyAndFinalize = async ({ userId, orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
    if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
        throw createPaymentError("Payment signature verification failed", "INVALID_PAYMENT_SIGNATURE", 400);
    }
    const order = await getOwnedOrder(userId, orderId);
    const payment = await Payment.findOne({
        userId,
        orderId: order._id,
        razorpayOrderId: razorpay_order_id
    });
    if (!payment || String(payment.orderId) !== String(order._id)) {
        throw createPaymentError("Payment order does not belong to this application order", "PAYMENT_ORDER_MISMATCH", 409);
    }

    const providerPayment = await razorpayConfig.getRazorpayClient().payments.fetch(razorpay_payment_id);
    if (
        providerPayment.id !== razorpay_payment_id
        || providerPayment.order_id !== payment.razorpayOrderId
        || Number(providerPayment.amount) !== Number(payment.amountMinor)
        || providerPayment.currency !== payment.currency
    ) {
        throw createPaymentError("Provider payment details do not match the expected order", "PROVIDER_PAYMENT_MISMATCH", 409);
    }
    if (providerPayment.status === "failed") {
        if (!["Success", "Refunded"].includes(payment.paymentStatus)) {
            await Payment.updateOne(
                { _id: payment._id, paymentStatus: { $nin: ["Success", "Refunded"] } },
                { $set: { paymentStatus: "Failed", razorpayPaymentId: providerPayment.id } }
            );
        }
        await Order.updateOne(
            { _id: order._id, userId, activePaymentAttemptId: payment.attemptId, paymentStatus: "Pending" },
            { $unset: { activePaymentAttemptId: 1 } }
        );
        return { paid: false, paymentStatus: "Failed" };
    }
    if (providerPayment.status !== "captured" || providerPayment.captured !== true) {
        return { paid: false, paymentStatus: providerPayment.status || "Pending" };
    }
    return finalizeCapturedPayment(payment, providerPayment, "CHECKOUT");
};

const processPaymentEvent = async (event) => {
    const eventType = event.event;
    const paymentEntity = event.payload?.payment?.entity;
    if (eventType === "payment.captured" || eventType === "payment.failed") {
        if (
            typeof paymentEntity?.order_id !== "string"
            || typeof paymentEntity?.id !== "string"
        ) {
            throw createPaymentError("Payment event is missing required provider fields", "INVALID_WEBHOOK_EVENT");
        }
        const payment = await Payment.findOne({ razorpayOrderId: paymentEntity.order_id });
        if (!payment) {
            logPayment("warn", "razorpay_event_for_unknown_order", {
                eventType,
                providerOrderId: String(paymentEntity.order_id)
            });
            return;
        }
        if (
            Number(paymentEntity.amount) !== Number(payment.amountMinor)
            || paymentEntity.currency !== payment.currency
        ) {
            throw createPaymentError("Webhook payment amount or currency mismatch", "WEBHOOK_PAYMENT_MISMATCH", 409);
        }
        if (eventType === "payment.failed" && paymentEntity.status !== "failed") {
            throw createPaymentError("Failed event has an unexpected payment state", "INVALID_WEBHOOK_EVENT", 409);
        }
        if (eventType === "payment.captured") {
            if (paymentEntity.status !== "captured" || paymentEntity.captured !== true) {
                throw createPaymentError("Captured event has an unexpected payment state", "INVALID_WEBHOOK_EVENT", 409);
            }
            await finalizeCapturedPayment(payment, paymentEntity, "WEBHOOK");
        } else if (
            !["Success", "Refunded"].includes(payment.paymentStatus)
            && payment.refundStatus !== "FULL"
        ) {
            await Payment.updateOne(
                { _id: payment._id, paymentStatus: { $nin: ["Success", "Refunded"] } },
                {
                    $set: {
                        paymentStatus: "Failed",
                        razorpayPaymentId: paymentEntity.id
                    }
                }
            );
            await Order.updateOne(
                {
                    _id: payment.orderId,
                    userId: payment.userId,
                    activePaymentAttemptId: payment.attemptId,
                    paymentStatus: "Pending"
                },
                { $unset: { activePaymentAttemptId: 1 } }
            );
            logPayment("info", "razorpay_payment_failed_retained_reservation", {
                applicationOrderId: String(payment.orderId),
                providerPaymentId: String(paymentEntity.id)
            });
        }
        return;
    }

    if (eventType === "refund.processed") {
        const refund = event.payload?.refund?.entity;
        const providerPayment = event.payload?.payment?.entity;
        if (
            !refund?.id
            || refund.status !== "processed"
            || !providerPayment?.id
            || refund.payment_id !== providerPayment.id
        ) {
            throw createPaymentError("Processed refund event is missing valid provider details", "INVALID_REFUND_EVENT");
        }
        const payment = await Payment.findOne({ razorpayOrderId: providerPayment.order_id });
        if (payment) {
            const amountRefundedMinor = Number(providerPayment.amount_refunded);
            if (
                Number(providerPayment.amount) !== Number(payment.amountMinor)
                || Number(refund.amount) < 1
                || !Number.isSafeInteger(Number(refund.amount))
                || Number(refund.amount) > amountRefundedMinor
                || refund.currency !== payment.currency
                || providerPayment.currency !== payment.currency
                || !Number.isSafeInteger(amountRefundedMinor)
                || amountRefundedMinor < 0
                || amountRefundedMinor > Number(payment.amountMinor)
            ) {
                throw createPaymentError("Refund amount or currency does not match the provider payment", "REFUND_PAYMENT_MISMATCH", 409);
            }
            const fullRefund = amountRefundedMinor >= Number(payment.amountMinor);
            await Payment.updateOne(
                { _id: payment._id },
                {
                    $set: {
                        razorpayPaymentId: providerPayment.id,
                        amountRefundedMinor,
                        refundStatus: fullRefund ? "FULL" : "PARTIAL",
                        ...(fullRefund ? { paymentStatus: "Refunded" } : {})
                    }
                }
            );
        } else {
            logPayment("warn", "razorpay_refund_for_unknown_payment", {
                providerPaymentId: String(providerPayment.id)
            });
        }
    }
};

const processWebhook = async ({ rawBody, signature, eventId }) => {
    if (!verifyWebhookSignature(rawBody, signature)) {
        throw createPaymentError("Webhook signature verification failed", "INVALID_WEBHOOK_SIGNATURE", 400);
    }
    if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 200) {
        throw createPaymentError("Webhook event ID is required", "INVALID_WEBHOOK_EVENT_ID", 400);
    }

    let event;
    try {
        event = JSON.parse(rawBody.toString("utf8"));
    } catch {
        throw createPaymentError("Webhook body is invalid JSON", "INVALID_WEBHOOK_BODY", 400);
    }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.event !== "string") {
        throw createPaymentError("Webhook event shape is invalid", "INVALID_WEBHOOK_BODY", 400);
    }

    const now = new Date();
    const processingToken = randomUUID();
    try {
        await PaymentWebhookEvent.create({
            eventId,
            eventType: String(event.event || "unknown"),
            status: "PROCESSING",
            processingToken,
            leaseExpiresAt: new Date(now.getTime() + 60_000)
        });
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }
        const existing = await PaymentWebhookEvent.findOneAndUpdate(
            {
                eventId,
                status: "PROCESSING",
                leaseExpiresAt: { $lte: now }
            },
            {
                $set: {
                    processingToken,
                    leaseExpiresAt: new Date(now.getTime() + 60_000),
                    eventType: String(event.event)
                },
                $inc: { retryCount: 1 }
            },
            { new: true }
        );
        if (existing) {
            // A previous worker's lease expired; replay is safe because payment state transitions are idempotent.
        } else {
            const current = await PaymentWebhookEvent.findOne({ eventId });
            if (current?.status === "PROCESSED") {
                return { duplicate: true };
            }
            throw createPaymentError(
                "Webhook event is already being processed; provider should retry",
                "PAYMENT_EVENT_PROCESSING",
                503
            );
        }
    }

    await processPaymentEvent(event);
    const processed = await PaymentWebhookEvent.updateOne(
        { eventId, status: "PROCESSING", processingToken },
        {
            $set: {
                status: "PROCESSED",
                processedAt: new Date(),
                leaseExpiresAt: null,
                processingToken: null
            }
        }
    );
    if (processed.modifiedCount !== 1) {
        const current = await PaymentWebhookEvent.findOne({ eventId });
        if (current?.status === "PROCESSED") {
            return { duplicate: true };
        }
        throw createPaymentError(
            "Webhook processing lease was lost; provider should retry",
            "PAYMENT_EVENT_LEASE_LOST",
            503
        );
    }
    return { duplicate: false };
};

const cashOnDelivery = async ({ userId, orderId }) => {
    const order = await getOwnedOrder(userId, orderId);
    if (order.status === "Cancelled" || order.paymentStatus === "Paid") {
        throw createPaymentError("Order is not eligible for cash on delivery", "ORDER_NOT_PAYABLE", 409);
    }
    await Order.updateOne(
        { _id: order._id, userId, paymentStatus: "Pending" },
        { $set: { paymentMethod: "Cash On Delivery" } }
    );
    return { success: true };
};

const getPaymentHistory = async (userId) =>
    Payment.find({ userId }).sort({ createdAt: -1 });

module.exports = {
    createPaymentOrder,
    resolveUnknownPaymentAttempt,
    verifyAndFinalize,
    verifyCheckoutSignature,
    verifyWebhookSignature,
    processWebhook,
    cashOnDelivery,
    getPaymentHistory
};
