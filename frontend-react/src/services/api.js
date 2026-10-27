import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
export const getBackendAssetUrl = (path) =>
    path ? `${API_ORIGIN}/${String(path).replace(/\\/g, "/").replace(/^\/+/, "")}` : "";

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json"
    }
});

/*
=========================================
Attach JWT Token Automatically
=========================================
*/

api.interceptors.request.use(
    (config) => {

        const token = localStorage.getItem("token");

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

/*
=========================================
Global Response Handler
=========================================
*/

api.interceptors.response.use(
    (response) => response,

    (error) => {

        if (error.response?.status === 401) {

            localStorage.removeItem("token");
            localStorage.removeItem("user");

            window.location.href = "/login";
        }

        return Promise.reject(error);
    }
);

export default api;