const User = require("../models/User");

const Product = require("../models/Product");
const ProductPrice = require("../models/ProductPrice");
const javaService = require("../services/javaService");
const ShopkeeperDetails = require("../models/ShopkeeperDetails");

exports.getWarehouseCatalog = async (req, res) => {
  try {
    const warehouseId = req.params.warehouseId;

    const user = await User.findById(req.user.id);

    const shopkeeper = await ShopkeeperDetails.findOne({
      userId: req.user.id,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // GET INVENTORY FROM JAVA

    const inventoryResponse =
      await javaService.getInventoryByWarehouse(warehouseId);

    const inventory =
      inventoryResponse.data.inventory || inventoryResponse.data || [];

    let catalog = [];

    for (const item of inventory) {
      const product = await Product.findById(item.productId);

      if (!product) {
        continue;
      }

      const productPrice = await ProductPrice.findOne({
        productId: product._id,
      });

      catalog.push({
        inventoryId: item.inventoryId,

        warehouseId: item.warehouseId,

        warehouseName: item.warehouseName,

        productId: product._id,

        name: product.name,

        sku: product.sku,

        category: product.category,

        description: product.description,

        image: product.image,

        unit: product.unit || "KG",

        stock: item.stock,

        price: productPrice ? productPrice.price : 0,
      });
    }

    // REMOVE OUT OF STOCK

    catalog = catalog.filter((product) => product.stock > 0);

    // FILTER SHOP CATEGORY

    if (user.role === "user") {
      if (!shopkeeper) {
        return res.status(404).json({
          success: false,
          message: "Shopkeeper details not found",
        });
      }

      const categories = (shopkeeper.shopCategory || []).map((category) =>
        category.trim().toLowerCase(),
      );

      

      catalog = catalog.filter((product) => {
        const match = categories.includes(
          product.category.trim().toLowerCase(),
        );

        

        return match;
      });
    }

    return res.status(200).json({
      success: true,
      totalProducts: catalog.length,
      products: catalog,
    });
  } catch (error) {
    const isJavaServiceError =
      typeof error.code === "string" && error.code.startsWith("JAVA_SERVICE_");
    const statusCode = isJavaServiceError
      ? error.statusCode || 503
      : 500;

    console.error(JSON.stringify({
      event: "inventory_catalog_request_failed",
      errorCode: String(error.code || error.name || "INVENTORY_SERVICE_ERROR").slice(0, 80),
      statusCode: error.response?.status || statusCode,
      requestId: req.requestId || null
    }));

    return res.status(statusCode).json({
      success: false,
      message: isJavaServiceError
        ? error.message
        : "Unable to load product catalog",
    });
  }
};
