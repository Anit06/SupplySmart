const mongoose = require("mongoose");

const checkoutAttemptSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        checkoutId: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: [
                "PROCESSING",
                "RECOVERING",
                "RECOVERY_REQUIRED",
                "WAITING_PAYMENT",
                "COMPLETED",
                "CANCELLED",
                "MANUAL_REVIEW"
            ],
            default: "PROCESSING",
            required: true
        },
        paymentState: {
            type: String,
            enum: ["NOT_STARTED", "PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"],
            default: "NOT_STARTED",
            required: true
        },
        paymentReference: {
            type: String,
            default: ""
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            default: null
        },
        warehouseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null
        },
        reservationItems: {
            type: [{
                productId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                    required: true
                },
                quantity: {
                    type: Number,
                    min: 1,
                    required: true
                }
            }],
            default: []
        },
        leaseExpiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 15 * 60 * 1000),
            index: true
        },
        recoveryLeaseUntil: {
            type: Date,
            default: null
        },
        recoveryAttempts: {
            type: Number,
            default: 0
        },
        lastRecoveryAt: {
            type: Date,
            default: null
        },
        lastRecoveryErrorCode: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

checkoutAttemptSchema.index({ userId: 1, checkoutId: 1 }, { unique: true });
checkoutAttemptSchema.index({ status: 1, leaseExpiresAt: 1, recoveryLeaseUntil: 1 });

module.exports = mongoose.model("CheckoutAttempt", checkoutAttemptSchema);
