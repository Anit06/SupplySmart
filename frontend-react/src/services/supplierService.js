import axios from "axios";
import { API_BASE_URL } from "./api";

const API = `${API_BASE_URL}/suppliers`;

export const getSuppliers = async () => {
    const res = await axios.get(API);
    return res.data;
};

export const addSupplier = async (data) => {
    const res = await axios.post(API, data);
    return res.data;
};

export const updateSupplier = async (id, data) => {
    const res = await axios.put(`${API}/${id}`, data);
    return res.data;
};

export const deleteSupplier = async (id) => {
    const res = await axios.delete(`${API}/${id}`);
    return res.data;
};
