const paymentService = require("../services/paymentService");
const { recordPaymentVerificationFailure } = require("../services/observability");

const handleError = (res, error) => {
    const statusCode = Number(error.statusCode) || 500;
    if (statusCode >= 500) {
        console.error(JSON.stringify({
            event: "payment_request_failed",
            errorCode: String(error.code || error.name || "PAYMENT_ERROR").slice(0, 80)
        }));
    }
    return res.status(statusCode).json({
        success: false,
        code: error.code || "PAYMENT_ERROR",
        message: statusCode >= 500 && error.code !== "RAZORPAY_ORDER_CREATION_FAILED"
            ? "Payment could not be completed. Please retry safely."
            : error.message
    });
};

exports.createOrder = async (req, res) => {
    try {
        const order = await paymentService.createPaymentOrder({
            userId: req.user.id,
            orderId: req.body?.orderId,
            attemptId: req.body?.attemptId,
            requestId: req.requestId
        });
        return res.status(200).json({ success: true, order });
    } catch (error) {
        return handleError(res, error);
    }
};

exports.resolveUnknownAttempt = async (req, res) => {
    try {
        if (req.body?.providerOutcome !== "NO_ORDER_CONFIRMED") {
            return res.status(400).json({
                success: false,
                code: "INVALID_RECONCILIATION_OUTCOME",
                message: "Confirm the Dashboard-verified absence of a Razorpay order."
            });
        }
        const result = await paymentService.resolveUnknownPaymentAttempt({
            orderId: req.body?.orderId,
            attemptId: req.body?.attemptId,
            adminId: req.user.id,
            evidenceReference: req.body?.evidenceReference,
            requestId: req.requestId
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return handleError(res, error);
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const result = await paymentService.verifyAndFinalize({
            userId: req.user.id,
            orderId: req.body?.orderId,
            razorpay_order_id: req.body?.razorpay_order_id,
            razorpay_payment_id: req.body?.razorpay_payment_id,
            razorpay_signature: req.body?.razorpay_signature
        });
        return res.status(result.paid ? 200 : 202).json({
            success: true,
            ...result
        });
    } catch (error) {
        recordPaymentVerificationFailure();
        return handleError(res, error);
    }
};

exports.webhook = async (req, res) => {
    try {
        const result = await paymentService.processWebhook({
            rawBody: req.body,
            signature: req.get("x-razorpay-signature"),
            eventId: req.get("x-razorpay-event-id")
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return handleError(res, error);
    }
};

exports.cashOnDelivery = async (req, res) => {
    try {
        await paymentService.cashOnDelivery({
            userId: req.user.id,
            orderId: req.body?.orderId
        });
        return res.status(200).json({ success: true, message: "Cash On Delivery Selected" });
    } catch (error) {
        return handleError(res, error);
    }
};

exports.getPaymentHistory = async (req, res) => {
    try {
        const payments = await paymentService.getPaymentHistory(req.user.id);
        return res.status(200).json({ success: true, payments });
    } catch (error) {
        return handleError(res, error);
    }
};
