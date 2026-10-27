const mongoose = require("mongoose");

const paymentWebhookEventSchema = new mongoose.Schema(
    {
        eventId: {
            type: String,
            required: true,
            unique: true
        },
        eventType: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ["PROCESSING", "PROCESSED"],
            default: "PROCESSING"
        },
        processingToken: {
            type: String,
            default: null
        },
        leaseExpiresAt: {
            type: Date,
            default: null
        },
        retryCount: {
            type: Number,
            default: 0
        },
        processedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

paymentWebhookEventSchema.index({ status: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
