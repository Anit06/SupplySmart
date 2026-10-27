const javaService = require("../services/javaService");

const sendInventoryServiceError = (res, error) => res
  .status(error.statusCode || 503)
  .json({
    success: false,
    code: error.code || "INVENTORY_SERVICE_ERROR",
    message: error.message || "Inventory service request failed"
  });

/*
==================================
GET INVENTORY
==================================
*/
exports.getInventory = async (req, res) => {
  try {
    const response = await javaService.getInventoryByWarehouse(
      req.params.warehouseId
    );

    return res.status(200).json(response.data);
  } catch (err) {
    return sendInventoryServiceError(res, err);
  }
};

/*
==================================
ADD INVENTORY
==================================
*/
exports.addInventory = async (req, res) => {
  try {
    const response = await javaService.addInventory(req.body);
    return res.json(response.data);
  } catch (err) {
    return sendInventoryServiceError(res, err);
  }
};

/*
==================================
UPDATE INVENTORY
==================================
*/
exports.updateInventory = async (req, res) => {
  try {
    const response = await javaService.updateInventory(
      req.params.inventoryId,
      req.body?.stock
    );

    return res.status(200).json(response.data);
  } catch (err) {
    return sendInventoryServiceError(res, err);
  }
};

/*
==================================
DELETE INVENTORY
==================================
*/
exports.deleteInventory = async (req, res) => {
  try {
    const response = await javaService.deleteInventory(req.params.inventoryId);

    return res.status(200).json(response.data);
  } catch (err) {
    return sendInventoryServiceError(res, err);
  }
};