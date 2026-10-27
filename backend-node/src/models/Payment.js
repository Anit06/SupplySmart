const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    amountMinor: {
      type: Number,
      required: true
    },

    amountRefundedMinor: {
      type: Number,
      default: 0
    },

    refundStatus: {
      type: String,
      enum: ["NONE", "PARTIAL", "FULL"],
      default: "NONE"
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
    },

    paymentMethod: {
      type: String,
      enum: ["Razorpay", "UPI", "COD"],
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["Pending", "Success", "Failed", "Refunded"],
      default: "Pending",
    },

    attemptId: {
      type: String,
      required: true
    },

    providerCreateState: {
      type: String,
      enum: ["CREATING", "CREATED", "UNKNOWN", "FAILED"],
      default: "CREATING"
    },

    providerResolutionSource: {
      type: String,
      enum: ["API_REJECTION", "DASHBOARD", null],
      default: null
    },

    providerResolutionReference: {
      type: String,
      default: ""
    },

    providerResolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    providerResolvedAt: {
      type: Date,
      default: null
    },

    razorpayOrderId: {
      type: String,
      default: "",
    },

    razorpayPaymentId: {
      type: String,
      default: "",
    },

    razorpaySignature: {
      type: String,
      default: "",
    },

    verifiedAt: {
      type: Date,
      default: null
    },

    verificationSource: {
      type: String,
      enum: ["CHECKOUT", "WEBHOOK", null],
      default: null
    },

    transactionId: {
      type: String,
      default: "",
    },

    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index(
  { orderId: 1, attemptId: 1 },
  { unique: true, partialFilterExpression: { attemptId: { $type: "string" } } }
);
paymentSchema.index(
  { razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $type: "string", $gt: "" } } }
);
paymentSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string", $gt: "" } } }
);
paymentSchema.index({ orderId: 1, paymentStatus: 1, verifiedAt: 1 });
paymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);