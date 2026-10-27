const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },

    stock: {
      type: Number,
      required: true,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

inventorySchema.index(
  { warehouse: 1, product: 1 },
  { unique: true, name: "warehouse_product_unique" }
);

module.exports = mongoose.model(
  "Inventory",
  inventorySchema,
  // Spring Boot owns this shared collection and explicitly names it
  // `inventory`; Mongoose would otherwise query its pluralized `inventories`.
  "inventory"
);