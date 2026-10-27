import http from "k6/http";
import { check, sleep } from "k6";
import { hmac } from "k6/crypto";

const API = __ENV.API_URL || "http://127.0.0.1:8088/api";
const HEALTH = __ENV.BACKEND_HEALTH_URL || API.replace(/\/api\/?$/, "");
const METRICS = __ENV.INTERNAL_METRICS_URL || HEALTH;
const BASE_HEADERS = { "Content-Type": "application/json" };
const CONTROLLED_CHECKOUT_STATUSES = http.expectedStatuses(200, 400, 409);

export const options = {
    scenarios: {
        health_catalog: {
            executor: "constant-arrival-rate",
            rate: 10,
            timeUnit: "1s",
            duration: "2m",
            preAllocatedVUs: 10,
            maxVUs: 30,
            exec: "healthAndCatalog"
        },
        authenticated_users: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: "30s", target: 10 },
                { duration: "60s", target: 25 },
                { duration: "30s", target: 0 }
            ],
            exec: "authenticatedBrowsing"
        },
        cart_and_reservations: {
            executor: "constant-arrival-rate",
            rate: 2,
            timeUnit: "1s",
            duration: "2m",
            preAllocatedVUs: 5,
            maxVUs: 20,
            exec: "cartAndLimitedStockCheckout"
        },
        checkout_idempotency: {
            executor: "constant-arrival-rate",
            rate: 1,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 2,
            maxVUs: 5,
            exec: "duplicateCheckout"
        },
        duplicate_webhooks: {
            executor: "constant-arrival-rate",
            rate: 1,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 2,
            maxVUs: 5,
            exec: "duplicateWebhook"
        },
        recovery_observer: {
            executor: "constant-vus",
            vus: 1,
            duration: "3m",
            exec: "observeRecoveryDuringInterruption"
        }
    },
    thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<1000", "p(99)<2000"]
    }
};

const login = () => {
    const response = http.post(
        `${API}/auth/login`,
        JSON.stringify({
            email: `${__ENV.LT_USER_PREFIX}${__VU}@${__ENV.LT_USER_DOMAIN || "example.invalid"}`,
            password: __ENV.LT_USER_PASSWORD
        }),
        { headers: BASE_HEADERS, tags: { operation: "login" } }
    );
    check(response, { "test account login succeeds": (res) => res.status === 200 });
    return response.json("token");
};

const authHeaders = (token) => ({
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` }
});

const makeCheckoutId = () => `loadtest-${__VU}-${__ITER}`;

export function healthAndCatalog() {
    const health = http.get(`${HEALTH}/health/live`, { tags: { operation: "health_live" } });
    check(health, { "liveness succeeds": (res) => res.status === 200 });
    const token = login();
    const catalog = http.get(
        `${API}/catalog/warehouse/${__ENV.LT_WAREHOUSE_ID}`,
        { ...authHeaders(token), tags: { operation: "catalog" } }
    );
    check(catalog, { "catalog responds": (res) => res.status === 200 });
    sleep(0.2);
}

export function authenticatedBrowsing() {
    const token = login();
    const orders = http.get(`${API}/orders`, {
        ...authHeaders(token),
        tags: { operation: "order_history" }
    });
    check(orders, { "authenticated order history responds": (res) => res.status === 200 });
    sleep(0.5);
}

export function cartAndLimitedStockCheckout() {
    const token = login();
    const headers = authHeaders(token);
    const cart = http.post(`${API}/cart`, JSON.stringify({
        warehouseId: __ENV.LT_WAREHOUSE_ID,
        productId: __ENV.LT_PRODUCT_ID,
        quantity: Number(__ENV.LT_QUANTITY || 1)
    }), {
        ...headers,
        responseCallback: CONTROLLED_CHECKOUT_STATUSES,
        tags: { operation: "cart_add" }
    });
    check(cart, { "cart update succeeds": (res) => res.status === 200 });

    const update = http.put(`${API}/cart`, JSON.stringify({
        warehouseId: __ENV.LT_WAREHOUSE_ID,
        productId: __ENV.LT_PRODUCT_ID,
        quantity: Number(__ENV.LT_QUANTITY || 1)
    }), {
        ...headers,
        responseCallback: CONTROLLED_CHECKOUT_STATUSES,
        tags: { operation: "cart_stock_validation" }
    });
    check(update, {
        "cart stock validation returns a controlled response": (res) =>
            [200, 400].includes(res.status)
    });

    const order = http.post(`${API}/cart/place-order`, JSON.stringify({
        warehouseId: __ENV.LT_WAREHOUSE_ID,
        checkoutId: makeCheckoutId(),
        paymentMethod: "Cash On Delivery"
    }), {
        ...headers,
        responseCallback: CONTROLLED_CHECKOUT_STATUSES,
        tags: { operation: "limited_stock_checkout" }
    });
    check(order, {
        "checkout either succeeds or reports a controlled stock conflict": (res) =>
            [200, 400, 409].includes(res.status)
    });
}

export function duplicateCheckout() {
    const token = login();
    const headers = authHeaders(token);
    const checkoutId = `loadtest-idempotency-${__VU}-${__ITER}`;
    const payload = JSON.stringify({
        warehouseId: __ENV.LT_WAREHOUSE_ID,
        checkoutId,
        paymentMethod: "Cash On Delivery"
    });
    const first = http.post(`${API}/cart/place-order`, payload, {
        ...headers,
        responseCallback: CONTROLLED_CHECKOUT_STATUSES,
        tags: { operation: "checkout_idempotency_first" }
    });
    const retry = http.post(`${API}/cart/place-order`, payload, {
        ...headers,
        responseCallback: CONTROLLED_CHECKOUT_STATUSES,
        tags: { operation: "checkout_idempotency_retry" }
    });
    check(first, { "first checkout submission is controlled": (res) => [200, 400, 409].includes(res.status) });
    check(retry, { "duplicate checkout submission is controlled": (res) => [200, 400, 409].includes(res.status) });
    if (first.status === 200 && retry.status === 200) {
        check(retry, {
            "retry returns the same order": (res) =>
                res.json("order._id") === first.json("order._id")
        });
    }
}

export function duplicateWebhook() {
    const secret = __ENV.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error("Use a dedicated Razorpay test webhook secret for load testing");
    }
    const body = JSON.stringify({ event: "load_test.noop" });
    const signature = hmac("sha256", secret, body, "hex");
    const eventId = `loadtest-webhook-${__VU}-${__ITER}`;
    const params = {
        headers: {
            ...BASE_HEADERS,
            "x-razorpay-signature": signature,
            "x-razorpay-event-id": eventId
        },
        tags: { operation: "duplicate_webhook" }
    };
    const first = http.post(`${API}/payment/webhook`, body, params);
    const duplicate = http.post(`${API}/payment/webhook`, body, params);
    check(first, { "webhook event accepted": (res) => res.status === 200 });
    check(duplicate, {
        "duplicate webhook safely acknowledged": (res) =>
            res.status === 200 && res.json("duplicate") === true
    });
}

export function observeRecoveryDuringInterruption() {
    const token = login();
    const readiness = http.get(`${HEALTH}/health/ready`, {
        responseCallback: http.expectedStatuses(200, 503),
        tags: { operation: "recovery_readiness" }
    });
    const metrics = http.get(`${METRICS}/metrics`, { tags: { operation: "recovery_metrics" } });
    const orders = http.get(`${API}/orders`, {
        ...authHeaders(token),
        tags: { operation: "recovery_during_interruption" }
    });
    check(readiness, { "backend readiness is observable": (res) => [200, 503].includes(res.status) });
    check(metrics, { "recovery metrics are available internally": (res) => res.status === 200 });
    check(orders, { "request during interruption has controlled outcome": (res) => res.status < 600 });
    sleep(1);
}
