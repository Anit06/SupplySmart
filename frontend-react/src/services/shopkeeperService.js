import axios from "axios";
import { API_BASE_URL } from "./api";

const API_URL = `${API_BASE_URL}/shopkeeper`;

const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };
};

const createProfile = async (userId, data) => {
    return axios.post(API_URL, { userId, ...data }, getAuthHeaders());
};

const getProfile = async (userId) => {
    return axios.get(`${API_URL}/${userId}`, getAuthHeaders());
};

const updateProfile = async (userId, data) => {
    return axios.put(`${API_URL}/profile/${userId}`, data, getAuthHeaders());
};

const addAddress = async (userId, data) => {
    return axios.post(`${API_URL}/${userId}/address`, data, getAuthHeaders());
};

const getAddresses = async (userId) => {
    return axios.get(`${API_URL}/${userId}/address`, getAuthHeaders());
};

const updateAddress = async (userId, addressId, data) => {
    return axios.put(`${API_URL}/${userId}/address/${addressId}`, data, getAuthHeaders());
};

const deleteAddress = async (userId, addressId) => {
    return axios.delete(`${API_URL}/${userId}/address/${addressId}`, getAuthHeaders());
};

const setDefaultAddress = async (userId, addressId) => {
    return axios.put(`${API_URL}/${userId}/address/default/${addressId}`, {}, getAuthHeaders());
};

const deleteProfile = async (userId) => {
    return axios.delete(`${API_URL}/${userId}`, getAuthHeaders());
};
export const getProductCategories = () => {
  return axios.get(`${API_BASE_URL}/products/categories`);
};

export {
    createProfile,
    getProfile,
    updateProfile,
    addAddress,
    getAddresses,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    deleteProfile,
};

export default {
    createProfile,
    getProfile,
    updateProfile,
    addAddress,
    getAddresses,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    deleteProfile,
};
