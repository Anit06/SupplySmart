const test = require("node:test");
const assert = require("node:assert/strict");

const CheckoutAttempt = require("../src/models/CheckoutAttempt");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const javaService = require("../src/services/javaService");
const { recoverAbandonedCheckouts } = require("../src/services/checkoutRecoveryService");

const originalMethods = {};
const mockedMethods = [
    [CheckoutAttempt, ["find", "findOneAndUpdate", "updateOne"]],
    [Order, ["findById", "findOne", "updateOne"]],
    [Payment, ["findOne"]],
    [javaService, ["commitInventoryReservation", "releaseInventoryReservation"]]
];

const makeAttempt = (overrides = {}) => ({
    _id: "attempt-1",
    userId: "user-1",
    checkoutId: "checkout-recovery-01",
    status: "PROCESSING",
    paymentState: "NOT_STARTED",
    warehouseId: "warehouse-1",
    reservationItems: [{ productId: "product-1", quantity: 1 }],
    leaseExpiresAt: new Date("2026-10-26T00:00:00.000Z"),
    recoveryAttempts: 0,
    ...overrides
});

const makeOrder = (overrides = {}) => ({
    _id: "order-1",
    userId: "user-1",
    checkoutId: "checkout-recovery-01",
    warehouseId: "warehouse-1",
    items: [{ productId: "product-1", quantity: 1 }],
    paymentMethod: "Razorpay",
    paymentStatus: "Pending",
    status: "Placed",
    ...overrides
});

const setup = (t, {
    attempts = [],
    order = null,
    successfulPayment = null,
    releaseFailure = null,
    commitFailure = null
} = {}) => {
    const records = new Map(attempts.map((attempt) => [attempt._id, attempt]));
    let releaseCalls = 0;
    let commitCalls = 0;
    let releasedUnits = 0;

    for (const [module, methods] of mockedMethods) {
        for (const method of methods) {
            const key = `${module.modelName || "java"}:${method}`;
            originalMethods[key] = module[method];
        }
    }
    t.after(() => {
        for (const [module, methods] of mockedMethods) {
            for (const method of methods) {
                const key = `${module.modelName || "java"}:${method}`;
                module[method] = originalMethods[key];
                delete originalMethods[key];
            }
        }
    });

    CheckoutAttempt.find = () => ({
        sort() { return this; },
        limit() { return this; },
        lean: async () => [...records.values()].filter((attempt) =>
            ["PROCESSING", "RECOVERY_REQUIRED", "WAITING_PAYMENT"].includes(attempt.status)
            || (attempt.status === "RECOVERING"
                && attempt.recoveryLeaseUntil <= new Date("2026-10-26T13:00:00.000Z"))
        )
    });
    CheckoutAttempt.findOneAndUpdate = (filter, update) => {
        const attempt = records.get(filter._id);
        if (!attempt || attempt.status !== filter.status) {
            return { lean: async () => null };
        }
        if (attempt.status === "RECOVERING"
            && attempt.recoveryLeaseUntil > filter.recoveryLeaseUntil.$lte) {
            return { lean: async () => null };
        }
        if (attempt.status !== "RECOVERING"
            && attempt.leaseExpiresAt
            && attempt.leaseExpiresAt > filter.$or[0].leaseExpiresAt.$lte) {
            return { lean: async () => null };
        }
        Object.assign(attempt, update.$set);
        attempt.recoveryAttempts += update.$inc.recoveryAttempts;
        return {
            lean: async () => attempt
        };
    };
    CheckoutAttempt.updateOne = async (filter, update) => {
        const attempt = records.get(filter._id);
        if (!attempt || (filter.status && attempt.status !== filter.status)) {
            return { modifiedCount: 0 };
        }
        if (filter.recoveryLeaseUntil
            && attempt.recoveryLeaseUntil?.getTime() !== filter.recoveryLeaseUntil.getTime()) {
            return { modifiedCount: 0 };
        }
        Object.assign(attempt, update.$set);
        return { modifiedCount: attempt ? 1 : 0 };
    };
    Order.findById = async () => order;
    Order.findOne = async () => order;
    Order.updateOne = async (_filter, update) => {
        if (order) Object.assign(order, update.$set);
        return { modifiedCount: order ? 1 : 0 };
    };
    Payment.findOne = () => ({ lean: async () => successfulPayment });
    javaService.commitInventoryReservation = async () => {
        commitCalls += 1;
        if (commitFailure) {
            const error = typeof commitFailure === "function"
                ? commitFailure(commitCalls)
                : commitFailure;
            if (error) throw error;
        }
    };
    javaService.releaseInventoryReservation = async (reservation) => {
        releaseCalls += 1;
        if (releaseFailure) {
            const error = typeof releaseFailure === "function"
                ? releaseFailure(releaseCalls)
                : releaseFailure;
            if (error) throw error;
        }
        releasedUnits += reservation.quantity;
    };

    return {
        records,
        get releaseCalls() { return releaseCalls; },
        get commitCalls() { return commitCalls; },
        get releasedUnits() { return releasedUnits; }
    };
};

test("releases stale reservation only when no order exists and payment never started", async (t) => {
    const state = setup(t, { attempts: [makeAttempt()] });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.cancelled, 1);
    assert.equal(state.releaseCalls, 1);
    assert.equal(state.releasedUnits, 1);
    assert.equal(state.records.get("attempt-1").status, "CANCELLED");
});

test("does not recover a checkout before its lease expires", async (t) => {
    const state = setup(t, {
        attempts: [makeAttempt({
            leaseExpiresAt: new Date("2026-10-26T13:30:00.000Z")
        })]
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.claimed, 0);
    assert.equal(state.releaseCalls, 0);
});

test("does not release orphan stock when payment state is unresolved", async (t) => {
    const state = setup(t, {
        attempts: [makeAttempt({ paymentState: "PENDING" })]
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.manualReview, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(state.records.get("attempt-1").status, "MANUAL_REVIEW");
});

test("sends legacy attempts without explicit payment or reservation state to manual review", async (t) => {
    const first = makeAttempt({
        _id: "legacy-payment-state",
        paymentState: undefined
    });
    const second = makeAttempt({
        _id: "legacy-reservation-state",
        reservationItems: undefined
    });
    const state = setup(t, { attempts: [first, second] });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.manualReview, 2);
    assert.equal(state.releaseCalls, 0);
    assert.equal(first.status, "MANUAL_REVIEW");
    assert.equal(second.status, "MANUAL_REVIEW");
});

test("preserves stock but requires review when payment success is not safely bound to the order", async (t) => {
    const order = makeOrder({ paymentStatus: "Pending" });
    const state = setup(t, {
        attempts: [makeAttempt()],
        order,
        successfulPayment: { paymentStatus: "Success" }
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.manualReview, 1);
    assert.equal(state.commitCalls, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(state.records.get("attempt-1").status, "MANUAL_REVIEW");
    assert.equal(order.paymentStatus, "Pending");
});

test("preserves stock and reconciles a payment with a persisted verification timestamp", async (t) => {
    const order = makeOrder({ paymentStatus: "Pending" });
    const state = setup(t, {
        attempts: [makeAttempt()],
        order,
        successfulPayment: {
            paymentStatus: "Success",
            verifiedAt: new Date("2026-10-26T12:00:00.000Z")
        }
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.manualReview, 1);
    assert.equal(state.commitCalls, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(order.paymentStatus, "Paid");
    assert.equal(state.records.get("attempt-1").paymentState, "SUCCEEDED");
    assert.equal(state.records.get("attempt-1").status, "MANUAL_REVIEW");
});

test("preserves and completes an order with an explicitly persisted paid state", async (t) => {
    const state = setup(t, {
        attempts: [makeAttempt()],
        order: makeOrder({ paymentStatus: "Paid" })
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.completed, 1);
    assert.equal(state.commitCalls, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(state.records.get("attempt-1").status, "COMPLETED");
});

test("retries a partial commit for a paid order without releasing stock", async (t) => {
    const attempt = makeAttempt();
    let failFirstCommit = true;
    const state = setup(t, {
        attempts: [attempt],
        order: makeOrder({ paymentStatus: "Paid" }),
        commitFailure: (call) => call === 1 && failFirstCommit
            ? Object.assign(new Error("inventory unavailable"), { code: "ECONNRESET" })
            : null
    });

    const first = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(first.failed, 1);
    assert.equal(attempt.status, "RECOVERY_REQUIRED");
    assert.equal(state.releaseCalls, 0);

    failFirstCommit = false;
    const retried = await recoverAbandonedCheckouts({
        now: new Date(Date.now() + 20 * 60 * 1000)
    });
    assert.equal(retried.completed, 1);
    assert.equal(state.commitCalls, 2);
    assert.equal(state.releaseCalls, 0);
});

test("keeps an online order reserved while payment is pending, regardless of age", async (t) => {
    const state = setup(t, {
        attempts: [makeAttempt()],
        order: makeOrder()
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.waitingPayment, 1);
    assert.equal(state.commitCalls, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(state.records.get("attempt-1").status, "WAITING_PAYMENT");
});

test("releases stock only after a persisted server-side failed payment state", async (t) => {
    const attempt = makeAttempt({
        status: "RECOVERY_REQUIRED",
        paymentState: "FAILED"
    });
    const order = makeOrder({
        paymentStatus: "Failed",
        status: "Cancelled"
    });
    const state = setup(t, { attempts: [attempt], order });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.cancelled, 1);
    assert.equal(state.releaseCalls, 1);
    assert.equal(order.returnedStock, true);
});

test("does not release a cancelled online order with unresolved payment", async (t) => {
    const state = setup(t, {
        attempts: [makeAttempt()],
        order: makeOrder({ status: "Cancelled" })
    });
    const result = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(result.manualReview, 1);
    assert.equal(state.releaseCalls, 0);
    assert.equal(state.records.get("attempt-1").status, "MANUAL_REVIEW");
});

test("retries a partial release and makes duplicate processing idempotent", async (t) => {
    const attempt = makeAttempt({
        reservationItems: [
            { productId: "product-1", quantity: 1 },
            { productId: "product-2", quantity: 1 }
        ]
    });
    let failFirstRun = true;
    const state = setup(t, {
        attempts: [attempt],
        releaseFailure: (call) => call === 2 && failFirstRun
            ? Object.assign(new Error("inventory timeout"), { code: "ETIMEDOUT" })
            : null
    });
    const first = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T13:00:00.000Z")
    });
    assert.equal(first.failed, 1);
    assert.equal(attempt.status, "RECOVERY_REQUIRED");

    failFirstRun = false;
    const retry = await recoverAbandonedCheckouts({
        now: new Date(Date.now() + 20 * 60 * 1000)
    });
    assert.equal(retry.cancelled, 1);
    assert.equal(state.releaseCalls, 4);
    assert.equal(state.records.get("attempt-1").status, "CANCELLED");

    const repeated = await recoverAbandonedCheckouts({
        now: new Date("2026-10-26T14:00:00.000Z")
    });
    assert.equal(repeated.claimed, 0);
    assert.equal(state.releaseCalls, 4);
});

test("only one recovery worker claims a stale attempt at a time", async (t) => {
    const state = setup(t, { attempts: [makeAttempt()] });
    const now = new Date("2026-10-26T13:00:00.000Z");
    const results = await Promise.all([
        recoverAbandonedCheckouts({ now }),
        recoverAbandonedCheckouts({ now })
    ]);
    assert.equal(results.reduce((sum, result) => sum + result.claimed, 0), 1);
    assert.equal(state.releaseCalls, 1);
});
