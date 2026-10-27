const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.post("/create-order", authMiddleware, paymentController.createOrder);
router.post(
    "/admin/reconcile-attempt",
    authMiddleware,
    roleMiddleware("admin"),
    paymentController.resolveUnknownAttempt
);
router.post("/verify", authMiddleware, paymentController.verifyPayment);
router.post("/cod", authMiddleware, paymentController.cashOnDelivery);
router.get("/history", authMiddleware, paymentController.getPaymentHistory);

module.exports = router;
