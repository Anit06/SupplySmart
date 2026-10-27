const mongoose = require("mongoose");

const productHoldingSchema =
  new mongoose.Schema(
    {
      productId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true
      },
      quantity: Number,
      unit: String,
      stock: Number,
      stockStatus: {
        type: String,
        enum: [
          "In Stock",
          "Low Stock",
          "Out Of Stock"
        ],
        default: "In Stock"
      }
    },
    {
      timestamps: true
    }
  );

productHoldingSchema.index({ productId: 1 }, { unique: true });

module.exports =
  mongoose.model(
    "ProductHolding",
    productHoldingSchema
  );