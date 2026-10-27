const axios = require("axios");
const { recordInventoryFailure } = require("./observability");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INTERNAL_INVENTORY_PATH = "/api/inventory";
const RETRYABLE_OPERATIONS = new Set([
    "GET:",
    "POST:/reserve",
    "PUT:/reservation/commit",
    "PUT:/reservation/release"
]);

const createServiceError = (message, code) => Object.assign(new Error(message), { code });

const isValidServiceToken = (token) => {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
    const decoded = Buffer.from(token, "base64url");
    return decoded.length >= 32 && decoded.toString("base64url") === token;
};

const sanitizeServiceError = (error) => {
    const status = error.response?.status;
    const code = status === 401
        ? "JAVA_SERVICE_AUTH_REJECTED"
        : status >= 500
            ? "JAVA_SERVICE_UNAVAILABLE"
            : !status && error.code === "ECONNABORTED"
                ? "JAVA_SERVICE_TIMEOUT"
                : !status
                    ? "JAVA_SERVICE_UNAVAILABLE"
                    : "JAVA_SERVICE_REQUEST_FAILED";
    const message = status === 401
        ? "Inventory service rejected the configured credentials"
        : code === "JAVA_SERVICE_TIMEOUT"
            ? "Inventory service request timed out"
            : code === "JAVA_SERVICE_UNAVAILABLE"
                ? "Inventory service is unavailable"
                : "Inventory service request failed";
    const safeError = createServiceError(message, code);
    safeError.statusCode = status === 401 ? 502 : status || 503;
    if (error.code === "ECONNABORTED") safeError.transportCode = error.code;
    if (error.response) {
        safeError.response = {
            status: error.response.status,
            data: error.response.data
        };
    }
    return safeError;
};

const isLoopback = (hostname) =>
    ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());

const validateBaseUrl = (baseURL) => {
    if (typeof baseURL !== "string" || !baseURL.trim()) {
        throw createServiceError("JAVA_SERVICE_URL is required", "JAVA_SERVICE_CONFIG_MISSING");
    }
    let parsed;
    try {
        parsed = new URL(baseURL);
    } catch {
        throw createServiceError("JAVA_SERVICE_URL is invalid", "JAVA_SERVICE_URL_INVALID");
    }
    const allowPrivateHttp = process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP === "true"
        && process.env.NODE_ENV !== "production";
    if (!["http:", "https:"].includes(parsed.protocol)
        || (parsed.protocol !== "https:"
            && !isLoopback(parsed.hostname)
            && !allowPrivateHttp)
        || parsed.username
        || parsed.password) {
        throw createServiceError(
            "JAVA_SERVICE_URL must use HTTPS except for a loopback development URL",
            "JAVA_SERVICE_URL_INSECURE"
        );
    }
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname.endsWith(INTERNAL_INVENTORY_PATH)) {
        pathname = `${pathname}${INTERNAL_INVENTORY_PATH}`;
    }
    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/, "");
};

const getTimeout = (configuredTimeout) => {
    const timeout = Number(configuredTimeout);
    return Number.isFinite(timeout) && timeout >= 1_000 && timeout <= 30_000
        ? timeout
        : 10_000;
};

const isRetryableFailure = (error) =>
    !error.response || error.response.status >= 500;

const createJavaService = ({
    baseURL = process.env.JAVA_SERVICE_URL,
    tokenProvider = () => process.env.JAVA_SERVICE_TOKEN,
    timeoutMs = process.env.JAVA_SERVICE_TIMEOUT_MS,
    retryDelayMs = 100,
    client
} = {}) => {
    const target = baseURL ? validateBaseUrl(baseURL) : null;
    const timeout = getTimeout(timeoutMs);
    const http = client || axios.create({
        baseURL: target,
        timeout,
        headers: { "Content-Type": "application/json" }
    });

    const request = async (method, path, data) => {
        if (!target) {
            throw createServiceError("JAVA_SERVICE_URL is required", "JAVA_SERVICE_CONFIG_MISSING");
        }
        const token = tokenProvider();
        if (!isValidServiceToken(token)) {
            throw createServiceError(
                "JAVA_SERVICE_TOKEN must be a 32-byte-or-stronger base64url secret",
                "JAVA_SERVICE_AUTH_CONFIG_INVALID"
            );
        }

        const retryPath = path.split("?")[0];
        const retrySafe = RETRYABLE_OPERATIONS.has(`${method}:${retryPath}`);
        const maxAttempts = retrySafe ? 2 : 1;
        for (let attempt = 1; ; attempt += 1) {
            try {
                const response = await http.request({
                    method,
                    url: path,
                    data,
                    timeout,
                    headers: { "X-Internal-Service-Token": token }
                });
                response.config?.headers?.delete?.("X-Internal-Service-Token");
                return response;
            } catch (error) {
                if (attempt >= maxAttempts || !isRetryableFailure(error)) {
                    recordInventoryFailure();
                    throw sanitizeServiceError(error);
                }
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
    };

    return {
        addInventory: (data) => request("POST", "", data),
        getInventoryByWarehouse: (id) => request("GET", `/warehouse/${encodeURIComponent(id)}`),
        updateInventory: (id, stock) =>
            request("PUT", `/${encodeURIComponent(id)}?stock=${encodeURIComponent(stock)}`),
        deleteInventory: (id) => request("DELETE", `/${encodeURIComponent(id)}`),
        reduceInventory: (data) => request("PUT", "/reduce", data),
        reserveInventory: (data) => request("POST", "/reserve", data),
        commitInventoryReservation: (data) => request("PUT", "/reservation/commit", data),
        releaseInventoryReservation: (data) => request("PUT", "/reservation/release", data),
        addInventoryStock: (data) => request("PUT", "/add", data),
        getAllInventory: () => request("GET", "")
    };
};

module.exports = {
    ...createJavaService(),
    createJavaService
};
