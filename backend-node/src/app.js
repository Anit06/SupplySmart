const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const profileRoutes = require("./routes/profileRoutes");
const shopkeeperRoutes = require("./routes/shopkeeperRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const aiRoutes = require("./routes/aiRoutes");
const historyRoutes = require("./routes/historyRoutes");
const reportRoutes = require("./routes/reportRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const paymentController = require("./controllers/paymentController");
const errorMiddleware = require("./middleware/errorMiddleware");
const mongoose = require("mongoose");
const { requestObservability, renderMetrics } = require("./services/observability");

const app = express();

const configuredCorsOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOriginSet = new Set(configuredCorsOrigins);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || corsOriginSet.has(origin)),
  exposedHeaders: ["X-Request-Id"]
}));
app.use(requestObservability);
app.get("/health/live", (req, res) => res.status(200).json({ status: "live" }));
app.get("/health/ready", (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ status: "not_ready", dependency: "mongodb" });
  }
  return res.status(200).json({ status: "ready" });
});
app.get("/metrics", (req, res) => {
  res.type("text/plain").send(renderMetrics());
});
app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  paymentController.webhook
);
app.use(express.json());

app.use("/uploads", express.static("uploads"));

app.get("/", (req, res) => {
  res.send("AI Supply Chain API Running");
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/shopkeeper", shopkeeperRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/payment", paymentRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    errors: []
  });
});

app.use(errorMiddleware);

module.exports = app;
