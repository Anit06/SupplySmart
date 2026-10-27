const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");

const { createJavaService } = require("../src/services/javaService");

const token = crypto.randomBytes(32).toString("base64url");

const startServer = async (handler, t) => {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));
    return `http://127.0.0.1:${server.address().port}`;
};

test("sends the internal credential to the configured inventory endpoint", async (t) => {
    let received;
    const baseURL = await startServer((request, response) => {
        received = {
            path: request.url,
            token: request.headers["x-internal-service-token"]
        };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("[]");
    }, t);
    const service = createJavaService({ baseURL, tokenProvider: () => token });

    const response = await service.getInventoryByWarehouse("warehouse-id");

    assert.equal(response.status, 200);
    assert.equal(received.path, "/api/inventory/warehouse/warehouse-id");
    assert.equal(received.token, token);
    assert.equal(response.config.headers.get("X-Internal-Service-Token"), undefined);
});

test("does not duplicate the inventory endpoint when the URL already includes it", async (t) => {
    let receivedPath;
    const baseURL = await startServer((request, response) => {
        receivedPath = request.url;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("[]");
    }, t);
    const service = createJavaService({
        baseURL: `${baseURL}/api/inventory`,
        tokenProvider: () => token
    });

    await service.getAllInventory();

    assert.equal(receivedPath, "/api/inventory");
});

test("fails closed when the service token is missing or malformed", async () => {
    const service = createJavaService({
        baseURL: "http://localhost:8080",
        tokenProvider: () => ""
    });
    await assert.rejects(service.getAllInventory(), { code: "JAVA_SERVICE_AUTH_CONFIG_INVALID" });

    const malformed = createJavaService({
        baseURL: "http://localhost:8080",
        tokenProvider: () => "not-a-service-token"
    });
    await assert.rejects(malformed.reserveInventory({}), {
        code: "JAVA_SERVICE_AUTH_CONFIG_INVALID"
    });

    for (const invalidToken of [
        "A".repeat(42),
        `${"A".repeat(42)}B`,
        `${token}=`,
        ` ${token}`
    ]) {
        const invalidService = createJavaService({
            baseURL: "http://localhost:8080",
            tokenProvider: () => invalidToken
        });
        await assert.rejects(invalidService.getAllInventory(), {
            code: "JAVA_SERVICE_AUTH_CONFIG_INVALID"
        });
    }
});

test("rejects remote HTTP service URLs and allows local HTTP development URLs", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOptIn = process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP;

    try {
        process.env.NODE_ENV = "production";
        delete process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP;
        assert.throws(
            () => createJavaService({
                baseURL: "http://inventory.internal:8080",
                tokenProvider: () => token
            }),
            { code: "JAVA_SERVICE_URL_INSECURE" }
        );
        assert.doesNotThrow(() => createJavaService({
            baseURL: "http://127.0.0.1:8080",
            tokenProvider: () => token
        }));
    } finally {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }
        if (previousOptIn === undefined) {
            delete process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP;
        } else {
            process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP = previousOptIn;
        }
    }
});

test("allows private HTTP only with an explicit non-production development opt-in", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOptIn = process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP;

    try {
        process.env.NODE_ENV = "development";
        process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP = "true";
        assert.doesNotThrow(() => createJavaService({
            baseURL: "http://inventory.internal:8080",
            tokenProvider: () => token
        }));

        process.env.NODE_ENV = "production";
        assert.throws(
            () => createJavaService({
                baseURL: "http://inventory.internal:8080",
                tokenProvider: () => token
            }),
            { code: "JAVA_SERVICE_URL_INSECURE" }
        );
    } finally {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }
        if (previousOptIn === undefined) {
            delete process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP;
        } else {
            process.env.JAVA_SERVICE_ALLOW_PRIVATE_HTTP = previousOptIn;
        }
    }
});

test("does not retry authorization failures or unsafe inventory mutations", async (t) => {
    let calls = 0;
    const baseURL = await startServer((_request, response) => {
        calls += 1;
        response.writeHead(401);
        response.end();
    }, t);
    const service = createJavaService({ baseURL, tokenProvider: () => token });

    await assert.rejects(service.getAllInventory(), (error) => {
        assert.equal(error.response.status, 401);
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "JAVA_SERVICE_AUTH_REJECTED");
        assert.equal(JSON.stringify(error).includes(token), false);
        return true;
    });
    await assert.rejects(
        service.addInventory({ warehouseId: "w", productId: "p", stock: 1 }),
        (error) => error.response.status === 401
    );
    assert.equal(calls, 2);
});

test("retries a safe reservation request once with the same idempotency payload", async (t) => {
    let calls = 0;
    const requestBodies = [];
    const receivedTokens = [];
    const baseURL = await startServer((request, response) => {
        calls += 1;
        receivedTokens.push(request.headers["x-internal-service-token"]);
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
            requestBodies.push(body);
            response.writeHead(calls === 1 ? 503 : 200, { "Content-Type": "application/json" });
            response.end("{}");
        });
    }, t);
    const service = createJavaService({
        baseURL,
        tokenProvider: () => token,
        retryDelayMs: 1
    });
    const payload = {
        checkoutId: "checkout-12345678",
        warehouseId: "warehouse-id",
        productId: "product-id",
        quantity: 1
    };

    const response = await service.reserveInventory(payload);

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(requestBodies, [JSON.stringify(payload), JSON.stringify(payload)]);
    assert.deepEqual(receivedTokens, [token, token]);
});

test("does not retry non-idempotent mutations after timeout or service unavailability", async (t) => {
    let calls = 0;
    const baseURL = await startServer((request, response) => {
        calls += 1;
        if (request.url.includes("timeout")) {
            setTimeout(() => {
                if (!response.destroyed) response.end("{}");
            }, 1300);
            return;
        }
        response.writeHead(503);
        response.end();
    }, t);
    const service = createJavaService({
        baseURL,
        tokenProvider: () => token,
        timeoutMs: 1000
    });

    await assert.rejects(
        service.updateInventory("timeout", 3),
        (error) => error.code === "JAVA_SERVICE_TIMEOUT"
            && error.transportCode === "ECONNABORTED"
            && error.statusCode === 503
    );
    assert.equal(calls, 1);
    await assert.rejects(
        service.addInventory({ warehouseId: "w", productId: "p", stock: 1 }),
        (error) => error.response.status === 503
    );
    assert.equal(calls, 2);
});

test("rejects a missing service URL before making a request", async () => {
    const service = createJavaService({
        baseURL: "",
        tokenProvider: () => token
    });
    await assert.rejects(service.getAllInventory(), { code: "JAVA_SERVICE_CONFIG_MISSING" });
});
