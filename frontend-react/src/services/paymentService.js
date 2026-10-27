import api from "./api";

export const createOrder = async (orderId, attemptId) => {
    const response = await api.post("/payment/create-order", { orderId, attemptId });
    return response.data;
};

export const verifyPayment = async (paymentData) => {
    const response = await api.post("/payment/verify", paymentData);
    return response.data;
};

export const cashOnDelivery = async (orderData) => {
    const response = await api.post("/payment/cod", orderData);
    return response.data;
};

export const getPaymentHistory = async () => {
    const response = await api.get("/payment/history");
    return response.data;
};