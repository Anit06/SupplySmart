const Razorpay = require("razorpay");

let client;

const getRazorpayClient = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw Object.assign(new Error("Razorpay server configuration is missing"), {
            code: "RAZORPAY_CONFIG_MISSING",
            statusCode: 503
        });
    }

    if (!client) {
        client = new Razorpay({ key_id: keyId, key_secret: keySecret });
        client.api.rq.defaults.timeout = Number(process.env.RAZORPAY_API_TIMEOUT_MS) >= 1000
            ? Number(process.env.RAZORPAY_API_TIMEOUT_MS)
            : 10_000;
    }

    return client;
};

module.exports = { getRazorpayClient };
