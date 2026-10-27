const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");

const Payment = require("../src/models/Payment");
const PaymentWebhookEvent = require("../src/models/PaymentWebhookEvent");
const Order = require("../src/models/Order");
const CheckoutAttempt = require("../src/models/CheckoutAttempt");
const javaService = require("../src/services/javaService");
const razorpayConfig = require("../src/config/razorpay");
const paymentService = require("../src/services/paymentService");

const mockedMethods = [
    [Payment, ["create", "findOne", "updateOne"]],
    [PaymentWebhookEvent, ["create", "findOne", "findOneAndUpdate", "updateOne"]],
    [Order, ["findOne", "findById", "updateOne"]],
    [CheckoutAttempt, ["findOne", "updateOne"]],
    [javaService, ["commitInventoryReservation"]],
    [razorpayConfig, ["getRazorpayClient"]]
];

const queryMatches = (document, query) => Object.entries(query).every(([key, expected]) => {
    const actual = document[key];
    if (key === "$or") return expected.some((clause) => queryMatches(document, clause));
    if (key === "$and") return expected.every((clause) => queryMatches(document, clause));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if ("$ne" in expected) return actual !== expected.$ne;
        if ("$in" in expected) {
            return expected.$in.includes(actual) || (actual === undefined && expected.$in.includes(null));
        }
        if ("$nin" in expected) return !expected.$nin.includes(actual);
        if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
        if ("$type" in expected) return typeof actual === "string";
        return true;
    }
    if (expected === null && actual === undefined) return true;
    return String(actual) === String(expected);
});

const setup = (t, {
    inventoryFailure = null,
    providerError = null,
    providerLookupError = null,
    providerCreate = null,
    providerPayment = null
} = {}) => {
    const oldKeyId = process.env.RAZORPAY_KEY_ID;
    const oldKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const oldWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const originals = new Map();
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

    for (const [module, methods] of mockedMethods) {
        for (const method of methods) {
            const key = `${module.modelName || "mock"}:${method}`;
            originals.set(key, module[method]);
        }
    }

    const order = {
        _id: "507f1f77bcf86cd799439011",
        userId: "shopkeeper-1",
        checkoutId: "checkout-12345678",
        warehouseId: "warehouse-1",
        items: [{ productId: "product-1", quantity: 2 }],
        finalAmount: 1234.56,
        paymentMethod: "Razorpay",
        paymentStatus: "Pending",
        status: "Placed",
        activePaymentAttemptId: null
    };
    const attempt = {
        _id: "checkout-attempt-1",
        userId: order.userId,
        checkoutId: order.checkoutId,
        status: "WAITING_PAYMENT",
        paymentState: "PENDING"
    };
    const payments = [];
    const events = new Map();
    const calls = { providerOrders: 0, providerOrderLookups: 0, providerFetches: 0, commits: 0 };
    const providerOrders = [];
    let paymentSequence = 0;

    Order.findOne = async (query) => queryMatches(order, query) ? order : null;
    Order.findById = async (id) => String(id) === order._id ? order : null;
    Order.updateOne = async (query, update) => {
        if (!queryMatches(order, query)) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(order, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete order[key];
        return { matchedCount: 1, modifiedCount: 1 };
    };

    Payment.create = async (data) => {
        if (payments.some((item) => item.orderId === data.orderId && item.attemptId === data.attemptId)) {
            throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        const payment = { razorpayOrderId: "", ...data, _id: `payment-${++paymentSequence}` };
        payments.push(payment);
        return payment;
    };
    Payment.findOne = async (query) => payments.find((payment) => queryMatches(payment, query)) || null;
    Payment.updateOne = async (query, update) => {
        const payment = payments.find((item) => queryMatches(item, query));
        if (!payment) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(payment, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete payment[key];
        return { matchedCount: 1, modifiedCount: 1 };
    };

    PaymentWebhookEvent.create = async (data) => {
        if (events.has(data.eventId)) {
            throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        events.set(data.eventId, { ...data });
    };
    PaymentWebhookEvent.findOne = async ({ eventId }) => events.get(eventId) || null;
    PaymentWebhookEvent.findOneAndUpdate = async (query, update) => {
        const event = events.get(query.eventId);
        if (
            !event
            || event.status !== query.status
            || !event.leaseExpiresAt
            || event.leaseExpiresAt > query.leaseExpiresAt.$lte
        ) {
            return null;
        }
        Object.assign(event, update.$set || {});
        event.retryCount = (event.retryCount || 0) + (update.$inc?.retryCount || 0);
        return event;
    };
    PaymentWebhookEvent.updateOne = async ({ eventId }, update) => {
        const event = events.get(eventId);
        if (!event) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(event, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
    };

    CheckoutAttempt.findOne = async (query) =>
        queryMatches(attempt, query) ? attempt : null;
    CheckoutAttempt.updateOne = async (query, update) => {
        if (!queryMatches(attempt, query)) return { matchedCount: 0 };
        Object.assign(attempt, update.$set || {});
        return { matchedCount: 1 };
    };

    javaService.commitInventoryReservation = async () => {
        calls.commits += 1;
        if (inventoryFailure) throw inventoryFailure;
    };
    razorpayConfig.getRazorpayClient = () => ({
        orders: {
            create: async (data) => {
                calls.providerOrders += 1;
                if (providerCreate) {
                    return providerCreate(data, { calls, providerOrders });
                }
                if (providerError) throw providerError;
                const providerOrder = {
                    id: `razorpay-order-${calls.providerOrders}`,
                    amount: data.amount,
                    currency: data.currency,
                    status: "created",
                    receipt: data.receipt,
                    notes: data.notes
                };
                providerOrders.push(providerOrder);
                return providerOrder;
            },
            all: async ({ receipt }) => {
                calls.providerOrderLookups += 1;
                if (providerLookupError) throw providerLookupError;
                return { items: providerOrders.filter((item) => item.receipt === receipt) };
            }
        },
        payments: {
            fetch: async (paymentId) => {
                calls.providerFetches += 1;
                return providerPayment || {
                    id: paymentId,
                    order_id: "razorpay-order-1",
                    amount: 123456,
                    currency: "INR",
                    status: "captured",
                    captured: true
                };
            }
        }
    });

    t.after(() => {
        for (const [module, methods] of mockedMethods) {
            for (const method of methods) {
                const key = `${module.modelName || "mock"}:${method}`;
                module[method] = originals.get(key);
                originals.delete(key);
            }
        }
        if (oldKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
        else process.env.RAZORPAY_KEY_ID = oldKeyId;
        if (oldKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
        else process.env.RAZORPAY_KEY_SECRET = oldKeySecret;
        if (oldWebhookSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
        else process.env.RAZORPAY_WEBHOOK_SECRET = oldWebhookSecret;
    });

    return { order, attempt, payments, events, calls, providerOrders };
};

const checkoutSignature = (orderId, paymentId) =>
    crypto.createHmac("sha256", "test_key_secret").update(`${orderId}|${paymentId}`).digest("hex");

const createEvent = (event, payment, extra = {}) => Buffer.from(JSON.stringify({
    entity: "event",
    event,
    payload: { payment: { entity: payment } },
    ...extra
}));

const webhookSignature = (rawBody) =>
    crypto.createHmac("sha256", "test_webhook_secret").update(rawBody).digest("hex");

test("fails closed when Razorpay API credentials are missing", () => {
    const originalKeyId = process.env.RAZORPAY_KEY_ID;
    const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
        assert.throws(
            () => razorpayConfig.getRazorpayClient(),
            { code: "RAZORPAY_CONFIG_MISSING" }
        );
    } finally {
        if (originalKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
        else process.env.RAZORPAY_KEY_ID = originalKeyId;
        if (originalKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
        else process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
    }
});

test("checks checkout signatures and rejects malformed or altered signatures", (t) => {
    setup(t);
    const signature = checkoutSignature("rzp-order", "rzp-payment");
    assert.equal(paymentService.verifyCheckoutSignature("rzp-order", "rzp-payment", signature), true);
    assert.equal(paymentService.verifyCheckoutSignature("rzp-order", "rzp-payment", "0".repeat(64)), false);
    assert.equal(paymentService.verifyCheckoutSignature("rzp-order", "rzp-payment", "invalid"), false);
});

test("verifies webhook signatures over the exact raw request bytes", (t) => {
    setup(t);
    const raw = Buffer.from('{"event":"payment.captured","spacing": true}');
    assert.equal(paymentService.verifyWebhookSignature(raw, webhookSignature(raw)), true);
    assert.equal(
        paymentService.verifyWebhookSignature(Buffer.from(raw.toString().replace(": ", ":")), webhookSignature(raw)),
        false
    );
});

test("passes the webhook route's original raw body to signature verification", async (t) => {
    setup(t);
    const app = require("../src/app");
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/payment/webhook`;
    const raw = Buffer.from('{\n  "event": "some.other.event"\n}');

    const validResponse = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-razorpay-signature": webhookSignature(raw),
            "x-razorpay-event-id": "raw-body-valid-event"
        },
        body: raw
    });
    assert.equal(validResponse.status, 200);

    const invalidResponse = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-razorpay-signature": webhookSignature(Buffer.from("{}")),
            "x-razorpay-event-id": "raw-body-invalid-event"
        },
        body: raw
    });
    assert.equal(invalidResponse.status, 400);
});

test("creates a provider order from trusted final amount and enforces ownership", async (t) => {
    const state = setup(t);
    await assert.rejects(
        paymentService.createPaymentOrder({
            userId: state.order.userId,
            orderId: state.order._id,
            attemptId: "short"
        }),
        { code: "INVALID_ATTEMPT_ID" }
    );
    await assert.rejects(
        paymentService.createPaymentOrder({
            userId: "other-shopkeeper",
            orderId: state.order._id,
            attemptId: "attempt-123456"
        }),
        { code: "ORDER_NOT_FOUND" }
    );
    const result = await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    assert.equal(result.amount, 123456);
    assert.equal(result.currency, "INR");
    assert.equal(result.keyId, "rzp_test_key");
    assert.equal(state.calls.providerOrders, 1);
    assert.equal(state.payments[0].amountMinor, 123456);
});

test("validates provider configuration before creating a payment attempt or taking its lock", async (t) => {
    const state = setup(t);
    razorpayConfig.getRazorpayClient = () => {
        throw Object.assign(new Error("missing provider credentials"), {
            code: "RAZORPAY_CONFIG_MISSING",
            statusCode: 503
        });
    };

    await assert.rejects(
        paymentService.createPaymentOrder({
            userId: state.order.userId,
            orderId: state.order._id,
            attemptId: "attempt-config-123"
        }),
        { code: "RAZORPAY_CONFIG_MISSING" }
    );
    assert.equal(state.payments.length, 0);
    assert.equal(state.order.activePaymentAttemptId, null);
});

test("rejects client signatures and provider amount mismatches without marking paid", async (t) => {
    const state = setup(t);
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    await assert.rejects(
        paymentService.verifyAndFinalize({
            userId: state.order.userId,
            orderId: state.order._id,
            razorpay_order_id: "razorpay-order-1",
            razorpay_payment_id: "payment-1",
            razorpay_signature: "0".repeat(64)
        }),
        { code: "INVALID_PAYMENT_SIGNATURE" }
    );
    assert.equal(state.calls.providerFetches, 0);

    const actualProviderClient = razorpayConfig.getRazorpayClient;
    let fetchedPayment = {
        order_id: "razorpay-order-1",
        amount: 1,
        currency: "INR",
        status: "captured",
        captured: true
    };
    razorpayConfig.getRazorpayClient = () => ({
        payments: {
            fetch: async (id) => ({ ...fetchedPayment, id })
        }
    });
    try {
        await assert.rejects(
            paymentService.verifyAndFinalize({
                userId: "another-shopkeeper",
                orderId: state.order._id,
                razorpay_order_id: "razorpay-order-1",
                razorpay_payment_id: "payment-2",
                razorpay_signature: checkoutSignature("razorpay-order-1", "payment-2")
            }),
            { code: "ORDER_NOT_FOUND" }
        );
        await assert.rejects(
            paymentService.verifyAndFinalize({
                userId: state.order.userId,
                orderId: state.order._id,
                razorpay_order_id: "different-provider-order",
                razorpay_payment_id: "payment-2",
                razorpay_signature: checkoutSignature("different-provider-order", "payment-2")
            }),
            { code: "PAYMENT_ORDER_MISMATCH" }
        );
        await assert.rejects(
            paymentService.verifyAndFinalize({
                userId: state.order.userId,
                orderId: state.order._id,
                razorpay_order_id: "razorpay-order-1",
                razorpay_payment_id: "payment-2",
                razorpay_signature: checkoutSignature("razorpay-order-1", "payment-2")
            }),
            { code: "PROVIDER_PAYMENT_MISMATCH" }
        );
        fetchedPayment = {
            ...fetchedPayment,
            amount: 123456,
            currency: "USD"
        };
        await assert.rejects(
            paymentService.verifyAndFinalize({
                userId: state.order.userId,
                orderId: state.order._id,
                razorpay_order_id: "razorpay-order-1",
                razorpay_payment_id: "payment-2",
                razorpay_signature: checkoutSignature("razorpay-order-1", "payment-2")
            }),
            { code: "PROVIDER_PAYMENT_MISMATCH" }
        );
    } finally {
        razorpayConfig.getRazorpayClient = actualProviderClient;
    }
    assert.equal(state.order.paymentStatus, "Pending");
});

test("reuses duplicate payment-order requests and serializes distinct attempts", async (t) => {
    const state = setup(t);
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    };
    await paymentService.createPaymentOrder(input);
    const duplicate = await paymentService.createPaymentOrder(input);
    assert.equal(duplicate.id, "razorpay-order-1");
    assert.equal(state.calls.providerOrders, 1);
    await assert.rejects(
        paymentService.createPaymentOrder({ ...input, attemptId: "attempt-654321" }),
        { code: "PAYMENT_ATTEMPT_BUSY" }
    );
    assert.equal(state.calls.providerOrders, 1);
});

test("verifies capture, commits inventory, and idempotently acknowledges duplicate webhook IDs", async (t) => {
    const state = setup(t);
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    const raw = createEvent("payment.captured", {
        id: "payment-1",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "captured",
        captured: true
    });
    const payload = {
        rawBody: raw,
        signature: webhookSignature(raw),
        eventId: "event-captured-1"
    };
    assert.deepEqual(await paymentService.processWebhook(payload), { duplicate: false });
    assert.deepEqual(await paymentService.processWebhook(payload), { duplicate: true });
    assert.equal(state.order.paymentStatus, "Paid");
    assert.equal(state.payments[0].paymentStatus, "Success");
    assert.equal(state.attempt.paymentState, "SUCCEEDED");
    assert.equal(state.calls.commits, 1);
});

test("ignores captured webhook events for provider orders not bound to an application payment", async (t) => {
    const state = setup(t);
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-webhook-binding-123"
    });
    const raw = createEvent("payment.captured", {
        id: "unrelated-provider-payment",
        order_id: "unrelated-provider-order",
        amount: 123456,
        currency: "INR",
        status: "captured",
        captured: true
    });

    await paymentService.processWebhook({
        rawBody: raw,
        signature: webhookSignature(raw),
        eventId: "event-unrelated-order"
    });

    assert.equal(state.order.paymentStatus, "Pending");
    assert.equal(state.payments[0].paymentStatus, "Pending");
    assert.equal(state.calls.commits, 0);
});

test("retains stock on failure and accepts a later captured payment event", async (t) => {
    const state = setup(t);
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    const failed = createEvent("payment.failed", {
        id: "payment-1",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "failed",
        captured: false
    });
    await paymentService.processWebhook({
        rawBody: failed,
        signature: webhookSignature(failed),
        eventId: "event-failed-1"
    });
    assert.equal(state.order.paymentStatus, "Pending");
    assert.equal(state.order.activePaymentAttemptId, undefined);
    assert.equal(state.attempt.paymentState, "PENDING");
    assert.equal(state.calls.commits, 0);
    await assert.rejects(
        paymentService.createPaymentOrder({
            userId: state.order.userId,
            orderId: state.order._id,
            attemptId: "attempt-123456"
        }),
        { code: "PAYMENT_ATTEMPT_FAILED" }
    );
    assert.equal(state.order.activePaymentAttemptId, undefined);

    const captured = createEvent("payment.captured", {
        id: "payment-1",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "captured",
        captured: true
    });
    await paymentService.processWebhook({
        rawBody: captured,
        signature: webhookSignature(captured),
        eventId: "event-captured-late"
    });
    assert.equal(state.order.paymentStatus, "Paid");
    assert.equal(state.payments[0].paymentStatus, "Success");
    assert.equal(state.calls.commits, 1);
});

test("routes a second captured payment for one application order to manual review", async (t) => {
    const state = setup(t);
    const baseInput = {
        userId: state.order.userId,
        orderId: state.order._id
    };
    await paymentService.createPaymentOrder({ ...baseInput, attemptId: "attempt-first-123" });
    const failure = createEvent("payment.failed", {
        id: "payment-first",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "failed",
        captured: false
    });
    await paymentService.processWebhook({
        rawBody: failure,
        signature: webhookSignature(failure),
        eventId: "event-failed-first"
    });
    await assert.rejects(
        paymentService.createPaymentOrder({ ...baseInput, attemptId: "attempt-first-123" }),
        { code: "PAYMENT_ATTEMPT_FAILED" }
    );
    await paymentService.createPaymentOrder({ ...baseInput, attemptId: "attempt-second-123" });

    for (const [index, providerOrderId] of ["razorpay-order-1", "razorpay-order-2"].entries()) {
        const raw = createEvent("payment.captured", {
            id: `payment-${index + 1}`,
            order_id: providerOrderId,
            amount: 123456,
            currency: "INR",
            status: "captured",
            captured: true
        });
        await paymentService.processWebhook({
            rawBody: raw,
            signature: webhookSignature(raw),
            eventId: `event-captured-${index + 1}`
        });
    }
    assert.equal(state.order.paymentStatus, "Paid");
    assert.equal(state.order.capturedPaymentId, "payment-1");
    assert.equal(state.payments.filter((payment) => payment.paymentStatus === "Success").length, 2);
    assert.equal(state.attempt.status, "MANUAL_REVIEW");
    assert.equal(state.attempt.lastRecoveryErrorCode, "MULTIPLE_CAPTURED_PAYMENTS");
    assert.equal(state.calls.commits, 1);
});

test("tracks partial and full processed refunds without releasing paid-order stock", async (t) => {
    const state = setup(t);
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-refund-123"
    });
    const captured = createEvent("payment.captured", {
        id: "payment-refund",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "captured",
        captured: true
    });
    await paymentService.processWebhook({
        rawBody: captured,
        signature: webhookSignature(captured),
        eventId: "event-before-refund"
    });

    const refundEvent = (amountRefunded, refundAmount) => Buffer.from(JSON.stringify({
        event: "refund.processed",
        payload: {
            refund: {
                entity: {
                    id: `refund-${amountRefunded}`,
                    payment_id: "payment-refund",
                    amount: refundAmount,
                    currency: "INR",
                    status: "processed"
                }
            },
            payment: {
                entity: {
                    id: "payment-refund",
                    order_id: "razorpay-order-1",
                    amount: 123456,
                    amount_refunded: amountRefunded,
                    currency: "INR"
                }
            }
        }
    }));

    const invalidRefund = refundEvent(10000, 15000);
    await assert.rejects(
        paymentService.processWebhook({
            rawBody: invalidRefund,
            signature: webhookSignature(invalidRefund),
            eventId: "event-invalid-refund"
        }),
        { code: "REFUND_PAYMENT_MISMATCH" }
    );
    const partial = refundEvent(10000, 10000);
    await paymentService.processWebhook({
        rawBody: partial,
        signature: webhookSignature(partial),
        eventId: "event-partial-refund"
    });
    assert.equal(state.payments[0].refundStatus, "PARTIAL");
    assert.equal(state.payments[0].paymentStatus, "Success");

    const full = refundEvent(123456, 113456);
    await paymentService.processWebhook({
        rawBody: full,
        signature: webhookSignature(full),
        eventId: "event-full-refund"
    });
    assert.equal(state.payments[0].refundStatus, "FULL");
    assert.equal(state.payments[0].paymentStatus, "Refunded");
    assert.equal(state.order.paymentStatus, "Paid");
    assert.equal(state.calls.commits, 1);
});

test("rejects invalid webhook signatures and mismatched amount/currency", async (t) => {
    const state = setup(t);
    await assert.rejects(
        paymentService.processWebhook({
            rawBody: Buffer.from("{}"),
            signature: "0".repeat(64),
            eventId: "bad-event"
        }),
        { code: "INVALID_WEBHOOK_SIGNATURE" }
    );
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    const raw = createEvent("payment.captured", {
        id: "payment-1",
        order_id: "razorpay-order-1",
        amount: 100,
        currency: "USD",
        status: "captured",
        captured: true
    });
    await assert.rejects(
        paymentService.processWebhook({
            rawBody: raw,
            signature: webhookSignature(raw),
            eventId: "event-mismatch"
        }),
        { code: "WEBHOOK_PAYMENT_MISMATCH" }
    );
    assert.equal(state.order.paymentStatus, "Pending");
});

test("keeps verified payments in recovery when inventory finalization fails", async (t) => {
    const state = setup(t, { inventoryFailure: new Error("inventory unavailable") });
    await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-123456"
    });
    const raw = createEvent("payment.captured", {
        id: "payment-1",
        order_id: "razorpay-order-1",
        amount: 123456,
        currency: "INR",
        status: "captured",
        captured: true
    });
    await paymentService.processWebhook({
        rawBody: raw,
        signature: webhookSignature(raw),
        eventId: "event-inventory-failure"
    });
    assert.equal(state.order.paymentStatus, "Paid");
    assert.equal(state.payments[0].paymentStatus, "Success");
    assert.equal(state.attempt.paymentState, "SUCCEEDED");
    assert.equal(state.attempt.status, "RECOVERY_REQUIRED");
});

test("marks provider API failures unresolved and avoids unsafe provider-order retries", async (t) => {
    const providerState = setup(t, { providerError: new Error("provider offline") });
    const input = {
        userId: providerState.order.userId,
        orderId: providerState.order._id,
        attemptId: "attempt-123456"
    };
    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "RAZORPAY_ORDER_CREATION_FAILED"
    });
    assert.equal(providerState.payments[0].providerCreateState, "UNKNOWN");
    await assert.rejects(
        paymentService.createPaymentOrder(input),
        { code: "PAYMENT_ORDER_UNRESOLVED" }
    );
    assert.equal(providerState.calls.providerOrders, 1);
});

test("logs an empty provider lookup separately from the order creation error", async (t) => {
    const state = setup(t, { providerError: Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }) });
    const originalWarn = console.warn;
    const originalError = console.error;
    const logs = [];
    console.warn = (line) => logs.push(JSON.parse(line));
    console.error = (line) => logs.push(JSON.parse(line));

    try {
        await assert.rejects(
            paymentService.createPaymentOrder({
                userId: state.order.userId,
                orderId: state.order._id,
                attemptId: "attempt-no-match-123"
            }),
            { code: "RAZORPAY_ORDER_CREATION_FAILED" }
        );
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }

    assert.ok(logs.some((entry) => entry.event === "razorpay_order_create_request_failed"));
    assert.ok(logs.some((entry) => entry.event === "razorpay_order_lookup_no_match"));
    assert.equal(state.payments[0].providerCreateState, "UNKNOWN");
    assert.equal(state.calls.providerOrders, 1);
});

test("logs provider lookup API errors separately and retains the unresolved attempt", async (t) => {
    const state = setup(t, {
        providerError: Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }),
        providerLookupError: Object.assign(new Error("lookup unavailable"), { statusCode: 503 })
    });
    const originalWarn = console.warn;
    const originalError = console.error;
    const logs = [];
    console.warn = (line) => logs.push(JSON.parse(line));
    console.error = (line) => logs.push(JSON.parse(line));

    try {
        await assert.rejects(
            paymentService.createPaymentOrder({
                userId: state.order.userId,
                orderId: state.order._id,
                attemptId: "attempt-lookup-error-123"
            }),
            { code: "RAZORPAY_ORDER_CREATION_FAILED" }
        );
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }

    assert.ok(logs.some((entry) => entry.event === "razorpay_order_create_request_failed"));
    assert.ok(logs.some((entry) => entry.event === "razorpay_order_lookup_failed"));
    assert.equal(logs.some((entry) => entry.event === "razorpay_order_lookup_no_match"), false);
    assert.equal(state.payments[0].providerCreateState, "UNKNOWN");
    assert.equal(state.order.activePaymentAttemptId, "attempt-lookup-error-123");
    assert.equal(state.calls.providerOrders, 1);
});

test("reconciles an order created before a provider timeout without creating another order", async (t) => {
    const state = setup(t, {
        providerCreate: async (data, { providerOrders }) => {
            providerOrders.push({
                id: "razorpay-order-after-timeout",
                amount: data.amount,
                currency: data.currency,
                status: "created",
                receipt: data.receipt,
                notes: data.notes
            });
            throw Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
        }
    });

    const result = await paymentService.createPaymentOrder({
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-timeout-123"
    });

    assert.equal(result.id, "razorpay-order-after-timeout");
    assert.equal(state.payments[0].providerCreateState, "CREATED");
    assert.equal(state.payments[0].razorpayOrderId, result.id);
    assert.equal(state.calls.providerOrders, 1);
    assert.equal(state.calls.providerOrderLookups, 1);
});

test("does not open checkout for an existing provider order that is already paid", async (t) => {
    const state = setup(t, {
        providerCreate: async (data, { providerOrders }) => {
            providerOrders.push({
                id: "razorpay-order-already-paid",
                amount: data.amount,
                currency: data.currency,
                status: "paid",
                receipt: data.receipt,
                notes: data.notes
            });
            throw Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
        }
    });
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-provider-paid-123"
    };

    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "RAZORPAY_ORDER_CREATION_FAILED"
    });
    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "PAYMENT_ORDER_UNRESOLVED"
    });
    assert.equal(state.payments[0].providerCreateState, "UNKNOWN");
    assert.equal(state.payments[0].razorpayOrderId, "");
    assert.equal(state.calls.providerOrders, 1);
});

test("reconciles matching existing orders for both CREATING and UNKNOWN payment records", async (t) => {
    for (const initialState of ["CREATING", "UNKNOWN"]) {
        const state = setup(t, { providerError: new Error("provider offline") });
        const input = {
            userId: state.order.userId,
            orderId: state.order._id,
            attemptId: `attempt-${initialState.toLowerCase()}-123`
        };
        await assert.rejects(paymentService.createPaymentOrder(input), {
            code: "RAZORPAY_ORDER_CREATION_FAILED"
        });
        state.payments[0].providerCreateState = initialState;
        const receipt = `${state.order._id.slice(-20)}-${input.attemptId.slice(0, 16)}`;
        state.providerOrders.push({
            id: `razorpay-order-${initialState.toLowerCase()}`,
            amount: state.payments[0].amountMinor,
            currency: "INR",
            status: "created",
            receipt,
            notes: {
                applicationOrderId: state.order._id,
                paymentAttemptId: input.attemptId
            }
        });

        const result = await paymentService.createPaymentOrder(input);
        assert.equal(result.id, `razorpay-order-${initialState.toLowerCase()}`);
        assert.equal(state.payments[0].providerCreateState, "CREATED");
        assert.equal(state.calls.providerOrders, 1);
    }
});

test("resolves an UNKNOWN attempt only after explicit Dashboard evidence and allows a safe new attempt", async (t) => {
    const state = setup(t, {
        providerCreate: async (data, { calls, providerOrders }) => {
            if (calls.providerOrders === 1) {
                throw Object.assign(new Error("provider offline"), { code: "ETIMEDOUT" });
            }
            const providerOrder = {
                id: "razorpay-order-after-manual-resolution",
                amount: data.amount,
                currency: data.currency,
                status: "created",
                receipt: data.receipt,
                notes: data.notes
            };
            providerOrders.push(providerOrder);
            return providerOrder;
        }
    });
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-manual-resolution-123"
    };
    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "RAZORPAY_ORDER_CREATION_FAILED"
    });

    await assert.rejects(
        paymentService.resolveUnknownPaymentAttempt({
            orderId: state.order._id,
            attemptId: input.attemptId,
            adminId: "507f1f77bcf86cd799439012",
            evidenceReference: "short"
        }),
        { code: "INVALID_RECONCILIATION_EVIDENCE" }
    );
    assert.equal(state.payments[0].providerCreateState, "UNKNOWN");
    assert.equal(state.order.activePaymentAttemptId, input.attemptId);

    const resolution = {
        orderId: state.order._id,
        attemptId: input.attemptId,
        adminId: "507f1f77bcf86cd799439012",
        evidenceReference: "dashboard-case-123"
    };
    const result = await paymentService.resolveUnknownPaymentAttempt(resolution);
    assert.deepEqual(result, { resolved: true, retryAllowed: true, idempotent: false });
    assert.equal(state.payments[0].paymentStatus, "Failed");
    assert.equal(state.payments[0].providerCreateState, "FAILED");
    assert.equal(state.payments[0].providerResolutionSource, "DASHBOARD");
    assert.equal(state.payments[0].providerResolutionReference, resolution.evidenceReference);
    assert.equal(state.payments[0].providerResolvedBy, resolution.adminId);
    assert.equal(state.order.activePaymentAttemptId, undefined);
    assert.equal(state.order.paymentStatus, "Pending");
    assert.equal(state.attempt.status, "WAITING_PAYMENT");
    assert.equal(state.calls.commits, 0);

    const repeatedResolution = await paymentService.resolveUnknownPaymentAttempt(resolution);
    assert.deepEqual(repeatedResolution, { resolved: true, retryAllowed: true, idempotent: true });

    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "PAYMENT_ATTEMPT_FAILED"
    });
    const newAttempt = await paymentService.createPaymentOrder({
        ...input,
        attemptId: "attempt-new-after-dashboard-123"
    });
    assert.ok(newAttempt.id);
    assert.equal(state.order.paymentStatus, "Pending");
    assert.equal(state.calls.providerOrders, 2);
});

test("does not resolve an UNKNOWN attempt when its order lock or provider order state changed", async (t) => {
    const state = setup(t, { providerError: new Error("provider offline") });
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-changed-resolution-123"
    };
    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "RAZORPAY_ORDER_CREATION_FAILED"
    });
    state.order.activePaymentAttemptId = "different-active-attempt";

    await assert.rejects(
        paymentService.resolveUnknownPaymentAttempt({
            orderId: state.order._id,
            attemptId: input.attemptId,
            adminId: "507f1f77bcf86cd799439012",
            evidenceReference: "dashboard-case-456"
        }),
        { code: "PAYMENT_ATTEMPT_STATE_CHANGED" }
    );
    assert.equal(state.payments[0].providerCreateState, "UNKNOWN");
    assert.equal(state.payments[0].paymentStatus, "Pending");
});

test("does not unlock a confirmed rejection until a new attempt is requested", async (t) => {
    const state = setup(t, {
        providerCreate: async (data, { calls, providerOrders }) => {
            if (calls.providerOrders === 1) {
                throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
            }
            const providerOrder = {
                id: "razorpay-order-retry",
                amount: data.amount,
                currency: data.currency,
                status: "created",
                receipt: data.receipt,
                notes: data.notes
            };
            providerOrders.push(providerOrder);
            return providerOrder;
        }
    });
    const firstInput = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-rejected-123"
    };

    await assert.rejects(paymentService.createPaymentOrder(firstInput), {
        code: "PAYMENT_ATTEMPT_FAILED"
    });
    assert.equal(state.payments[0].providerCreateState, "FAILED");
    assert.equal(state.payments[0].paymentStatus, "Failed");
    assert.equal(state.order.activePaymentAttemptId, undefined);
    const result = await paymentService.createPaymentOrder({
        ...firstInput,
        attemptId: "attempt-retry-123456"
    });
    assert.equal(result.id, "razorpay-order-retry");
    assert.equal(state.calls.providerOrders, 2);
});

test("serializes concurrent requests using the same payment attempt", async (t) => {
    let signalStarted;
    let finishProviderRequest;
    const providerStarted = new Promise((resolve) => { signalStarted = resolve; });
    const state = setup(t, {
        providerCreate: (data, { providerOrders }) => {
            signalStarted();
            return new Promise((resolve) => {
                finishProviderRequest = () => {
                    const providerOrder = {
                        id: "razorpay-order-concurrent",
                        amount: data.amount,
                        currency: data.currency,
                        status: "created",
                        receipt: data.receipt,
                        notes: data.notes
                    };
                    providerOrders.push(providerOrder);
                    resolve(providerOrder);
                };
            });
        }
    });
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-concurrent-123"
    };
    const firstRequest = paymentService.createPaymentOrder(input);
    await providerStarted;
    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "PAYMENT_ORDER_UNRESOLVED"
    });
    finishProviderRequest();
    const result = await firstRequest;

    assert.equal(result.id, "razorpay-order-concurrent");
    assert.equal(state.calls.providerOrders, 1);
    assert.equal(state.payments.length, 1);
});

test("does not return a second checkout order for an already successful payment", async (t) => {
    const state = setup(t);
    const input = {
        userId: state.order.userId,
        orderId: state.order._id,
        attemptId: "attempt-successful-123"
    };
    await paymentService.createPaymentOrder(input);
    state.payments[0].paymentStatus = "Success";

    await assert.rejects(paymentService.createPaymentOrder(input), {
        code: "ORDER_NOT_PAYABLE"
    });
    await assert.rejects(
        paymentService.createPaymentOrder({
            ...input,
            attemptId: "attempt-second-success-123"
        }),
        { code: "ORDER_NOT_PAYABLE" }
    );
    assert.equal(state.calls.providerOrders, 1);
});
