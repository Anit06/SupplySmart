const axios = require("axios");

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:5001";
const PYTHON_TIMEOUT_MS = Number(process.env.PYTHON_SERVICE_TIMEOUT_MS) >= 1000
    && Number(process.env.PYTHON_SERVICE_TIMEOUT_MS) <= 30_000
    ? Number(process.env.PYTHON_SERVICE_TIMEOUT_MS)
    : 10_000;

const predictDemand = async (payload) => {
    const response = await axios.post(`${PYTHON_URL}/predict`, payload, { timeout: PYTHON_TIMEOUT_MS });
    return response.data;
};

const predictAllDemand = async () => {
    const response = await axios.get(`${PYTHON_URL}/predict-all`, { timeout: PYTHON_TIMEOUT_MS });
    return response.data;
};

const predictAllLive = async (currentMonthDemand, warehouseProducts) => {
    const payload = {
        warehouseProducts,
        currentMonthDemand: (currentMonthDemand || []).map(item => ({
            warehouseName: item.warehouseName,
            productName: item.productName,
            quantity: item.currentMonthDemand
        }))
    };

    const response = await axios.post(`${PYTHON_URL}/predict-all-live`, payload, {
        timeout: PYTHON_TIMEOUT_MS
    });

    return response.data;
};

const reloadModel = async () => {
    const response = await axios.post(`${PYTHON_URL}/reload-model`, {}, { timeout: PYTHON_TIMEOUT_MS });
    return response.data;
};

module.exports = {
    predictDemand,
    predictAllDemand,
    predictAllLive,
    reloadModel
};