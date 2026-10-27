const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { getSafeMongoTestUri } = require("../../src/config/testMongoUri");

const configuredUri = process.env.MONGO_TEST_URI;
const testDatabaseUri = configuredUri ? getSafeMongoTestUri(configuredUri) : null;
const shouldRun = Boolean(testDatabaseUri);

const Inventory = require("../../src/models/Inventory");
const Cart = require("../../src/models/Cart");
const CheckoutAttempt = require("../../src/models/CheckoutAttempt");
const Order = require("../../src/models/Order");
const Payment = require("../../src/models/Payment");
const PaymentWebhookEvent = require("../../src/models/PaymentWebhookEvent");
const Product = require("../../src/models/Product");
const ProductHolding = require("../../src/models/ProductHolding");
const ProductPrice = require("../../src/models/ProductPrice");
const ShopkeeperDetails = require("../../src/models/ShopkeeperDetails");
const User = require("../../src/models/User");
const Prediction = require("../../src/models/Prediction");
const Warehouse = require("../../src/models/Warehouse");
const Supplier = require("../../src/models/Supplier");
const javaService = require("../../src/services/javaService");
const paymentService = require("../../src/services/paymentService");

const prefix = `it-${crypto.randomUUID()}`;
const ids = {
    inventory: [],
    attempts: [],
    orders: [],
    paymentEvents: [],
    payments: [],
    users: [],
    products: [],
    productHoldings: [],
    productPrices: [],
    shopkeeperDetails: [],
    carts: [],
    predictions: [],
    warehouses: [],
    suppliers: []
};

const makeObjectId = () => new mongoose.Types.ObjectId();
const checkoutId = (suffix) => `${prefix}-${suffix}`;

const inventoryReservationUpdate = async (inventoryId, request) =>
    Inventory.collection.updateOne(
        {
            _id: inventoryId,
            stock: { $gte: request.quantity },
            "reservations.checkoutId": { $ne: request.checkoutId }
        },
        {
            $inc: { stock: -request.quantity },
            $push: {
                reservations: {
                    checkoutId: request.checkoutId,
                    quantity: request.quantity,
                    status: "RESERVED",
                    createdAt: new Date()
                }
            }
        }
    );

const releaseReservationUpdate = async (warehouseId, productId, request) =>
    Inventory.collection.updateOne(
        {
            warehouse: warehouseId,
            product: productId,
            reservations: {
                $elemMatch: {
                    checkoutId: request.checkoutId,
                    quantity: request.quantity,
                    status: { $in: ["RESERVED", "COMMITTED"] }
                }
            }
        },
        {
            $inc: { stock: request.quantity },
            $set: { "reservations.$.status": "RELEASED" }
        }
    );

const reserveIdempotently = async (inventoryId, request) => {
    const existing = await Inventory.collection.findOne({
        _id: inventoryId,
        "reservations.checkoutId": request.checkoutId
    });
    if (existing) {
        const reservation = existing.reservations.find(
            (item) => item.checkoutId === request.checkoutId
        );
        if (reservation.quantity !== request.quantity || reservation.status === "RELEASED") {
            throw new Error("Reservation does not match or has already been released");
        }
        return { reserved: true, duplicate: true };
    }

    const result = await inventoryReservationUpdate(inventoryId, request);
    if (result.matchedCount === 1) return { reserved: true, duplicate: false };

    const raced = await Inventory.collection.findOne({
        _id: inventoryId,
        "reservations.checkoutId": request.checkoutId
    });
    const reservation = raced?.reservations?.find(
        (item) => item.checkoutId === request.checkoutId
    );
    if (reservation && reservation.quantity === request.quantity && reservation.status !== "RELEASED") {
        return { reserved: true, duplicate: true };
    }
    return { reserved: false, duplicate: false };
};

const spawnRecoveryWorker = ({ delayMs = 0, crashAfterClaim = false } = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [path.join(__dirname, "../../scripts/recoveryWorkerForIntegration.js")],
            {
                cwd: path.join(__dirname, "../.."),
                env: {
                    ...process.env,
                    RECOVERY_COMMIT_DELAY_MS: String(delayMs),
                    RECOVERY_CRASH_AFTER_CLAIM: crashAfterClaim ? "1" : "0"
                },
                stdio: ["ignore", "pipe", "pipe"]
            }
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
    });

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const makeSignedWebhook = (eventId, event) => {
    const rawBody = Buffer.from(JSON.stringify(event));
    const signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
    return { rawBody, signature, eventId };
};

test("MongoDB integration: isolated concurrency and index verification", { skip: !shouldRun }, async (t) => {
    await mongoose.connect(testDatabaseUri, { serverSelectionTimeoutMS: 5000 });
    t.after(async () => {
        await Promise.all([
            Inventory.deleteMany({ _id: { $in: ids.inventory } }),
            CheckoutAttempt.deleteMany({ _id: { $in: ids.attempts } }),
            Order.deleteMany({ _id: { $in: ids.orders } }),
            PaymentWebhookEvent.deleteMany({ eventId: { $in: ids.paymentEvents } }),
            Payment.deleteMany({ _id: { $in: ids.payments } }),
            User.deleteMany({ _id: { $in: ids.users } }),
            Product.deleteMany({ _id: { $in: ids.products } }),
            ProductHolding.deleteMany({ _id: { $in: ids.productHoldings } }),
            ProductPrice.deleteMany({ _id: { $in: ids.productPrices } }),
            ShopkeeperDetails.deleteMany({ _id: { $in: ids.shopkeeperDetails } }),
            Cart.deleteMany({ _id: { $in: ids.carts } }),
            Prediction.deleteMany({ _id: { $in: ids.predictions } }),
            Warehouse.deleteMany({ _id: { $in: ids.warehouses } }),
            Supplier.deleteMany({ _id: { $in: ids.suppliers } })
        ]);
        await mongoose.disconnect();
    });

    const database = mongoose.connection.db;
    const buildInfo = await database.admin().command({ buildInfo: 1 });
    console.info(JSON.stringify({
        event: "mongo_integration_environment",
        database: database.databaseName,
        version: buildInfo.version,
        host: "local test MongoDB"
    }));

    const indexedModels = [
        Inventory,
        Cart,
        CheckoutAttempt,
        Order,
        Payment,
        PaymentWebhookEvent,
        ProductHolding,
        ProductPrice,
        ShopkeeperDetails,
        User,
        Product,
        Prediction,
        Warehouse,
        Supplier
    ];
    for (const model of indexedModels) {
        await model.createIndexes();
    }

    await t.test("all declared unique indexes were created", async () => {
        const uniqueModels = indexedModels.filter((model) =>
            model.schema.indexes().some(([, options]) => options.unique)
        );
        for (const model of uniqueModels) {
            const declaredIndexes = model.schema.indexes()
                .filter(([, options]) => options.unique);
            const actualIndexes = await model.collection.indexes();
            for (const [keys, options] of declaredIndexes) {
                assert.ok(actualIndexes.some((index) =>
                    index.unique
                    && JSON.stringify(index.key) === JSON.stringify(keys)
                ), `${model.collection.collectionName} is missing unique index ${JSON.stringify(options)}`);
            }
        }
    });

    await t.test("declared indexes exist and enforce inventory uniqueness", async () => {
        const inventoryIndexes = await Inventory.collection.indexes();
        assert.ok(inventoryIndexes.some((index) =>
            index.name === "warehouse_product_unique" && index.unique
        ));
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        const inventoryId = makeObjectId();
        ids.inventory.push(inventoryId);
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 1,
            reservations: []
        });
        await assert.rejects(
            Inventory.collection.insertOne({
                _id: makeObjectId(),
                warehouse: warehouseId,
                product: productId,
                stock: 1,
                reservations: []
            }),
            (error) => error.code === 11000
        );
        const plan = await CheckoutAttempt.find({
            userId: makeObjectId(),
            checkoutId: checkoutId("query-plan")
        }).explain("executionStats");
        const serializedPlan = JSON.stringify(plan.queryPlanner.winningPlan);
        assert.match(serializedPlan, /userId_1_checkoutId_1/);
    });

    await t.test("two users cannot reserve the last unit concurrently", async () => {
        const inventoryId = makeObjectId();
        ids.inventory.push(inventoryId);
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: makeObjectId(),
            product: makeObjectId(),
            stock: 1,
            reservations: []
        });
        const results = await Promise.all([
            inventoryReservationUpdate(inventoryId, {
                checkoutId: checkoutId("last-unit-a"),
                quantity: 1
            }),
            inventoryReservationUpdate(inventoryId, {
                checkoutId: checkoutId("last-unit-b"),
                quantity: 1
            })
        ]);
        assert.equal(results.filter((result) => result.matchedCount === 1).length, 1);
        const inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations.length, 1);
        assert.ok(inventory.stock >= 0);
    });

    await t.test("concurrent limited-stock reservations never oversell", async () => {
        const inventoryId = makeObjectId();
        const availableStock = 7;
        ids.inventory.push(inventoryId);
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: makeObjectId(),
            product: makeObjectId(),
            stock: availableStock,
            reservations: []
        });
        const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
            inventoryReservationUpdate(inventoryId, {
                checkoutId: checkoutId(`limited-${index}`),
                quantity: 1
            })
        ));
        assert.equal(results.filter((result) => result.matchedCount === 1).length, availableStock);
        const inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations.reduce((sum, item) => sum + item.quantity, 0), availableStock);
        assert.ok(inventory.stock >= 0);
    });

    await t.test("repeated simultaneous reservation is idempotent", async () => {
        const inventoryId = makeObjectId();
        ids.inventory.push(inventoryId);
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: makeObjectId(),
            product: makeObjectId(),
            stock: 5,
            reservations: []
        });
        const request = { checkoutId: checkoutId("same-reservation"), quantity: 2 };
        const results = await Promise.all([
            reserveIdempotently(inventoryId, request),
            reserveIdempotently(inventoryId, request)
        ]);
        assert.ok(results.every((result) => result.reserved));
        const inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(inventory.stock, 3);
        assert.equal(inventory.reservations.filter((item) => item.checkoutId === request.checkoutId).length, 1);
    });

    await t.test("repeated concurrent release returns reserved stock exactly once", async () => {
        const inventoryId = makeObjectId();
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        const request = { checkoutId: checkoutId("retry-release"), quantity: 2 };
        ids.inventory.push(inventoryId);
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 3,
            reservations: [{
                ...request,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });

        const results = await Promise.all([
            releaseReservationUpdate(warehouseId, productId, request),
            releaseReservationUpdate(warehouseId, productId, request)
        ]);
        assert.equal(results.filter((result) => result.modifiedCount === 1).length, 1);
        await releaseReservationUpdate(warehouseId, productId, request);
        const inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(inventory.stock, 5);
        assert.equal(inventory.reservations[0].status, "RELEASED");
    });

    await t.test("checkout key and payment-attempt indexes reject concurrent duplicates", async () => {
        const userId = makeObjectId();
        const warehouseId = makeObjectId();
        ids.users.push(userId);
        const attemptDoc = {
            userId,
            checkoutId: checkoutId("duplicate-checkout"),
            status: "PROCESSING"
        };
        const attempts = await Promise.allSettled([
            CheckoutAttempt.create(attemptDoc),
            CheckoutAttempt.create(attemptDoc)
        ]);
        const createdAttempt = attempts.find((result) => result.status === "fulfilled");
        assert.ok(createdAttempt);
        ids.attempts.push(createdAttempt.value._id);
        assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);

        const orderData = {
            orderNumber: checkoutId("order-number"),
            checkoutId: attemptDoc.checkoutId,
            userId,
            warehouseId
        };
        const orders = await Promise.allSettled([
            Order.create(orderData),
            Order.create({ ...orderData, orderNumber: checkoutId("other-order-number") })
        ]);
        const createdOrder = orders.find((result) => result.status === "fulfilled");
        assert.ok(createdOrder);
        ids.orders.push(createdOrder.value._id);
        assert.equal(orders.filter((result) => result.status === "fulfilled").length, 1);

        const paymentData = {
            userId,
            orderId: createdOrder.value._id,
            amount: 1,
            amountMinor: 100,
            attemptId: checkoutId("payment-attempt"),
            paymentMethod: "Razorpay"
        };
        const paymentResults = await Promise.allSettled([
            Payment.create(paymentData),
            Payment.create(paymentData)
        ]);
        const createdPayment = paymentResults.find((result) => result.status === "fulfilled");
        assert.ok(createdPayment);
        ids.payments.push(createdPayment.value._id);
        assert.equal(paymentResults.filter((result) => result.status === "fulfilled").length, 1);
    });

    await t.test("simultaneous duplicate webhook events are processed once", async (subtest) => {
        const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        process.env.RAZORPAY_WEBHOOK_SECRET = "mongo-integration-webhook-secret";
        subtest.after(() => {
            if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
            else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
        });
        const eventId = checkoutId("duplicate-webhook");
        ids.paymentEvents.push(eventId);
        const rawBody = Buffer.from(JSON.stringify({ event: "integration.noop" }));
        const signature = crypto
            .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest("hex");
        const results = await Promise.allSettled([
            paymentService.processWebhook({ rawBody, signature, eventId }),
            paymentService.processWebhook({ rawBody, signature, eventId })
        ]);
        const fulfilled = results.filter((result) => result.status === "fulfilled");
        assert.equal(fulfilled.filter((result) => result.value.duplicate === false).length, 1);
        const event = await PaymentWebhookEvent.findOne({ eventId }).lean();
        assert.equal(event.status, "PROCESSED");
        const replay = await paymentService.processWebhook({ rawBody, signature, eventId });
        assert.deepEqual(replay, { duplicate: true });
    });

    await t.test("late capture after failure is retained and recovered after inventory failure", async (subtest) => {
        const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const originalCommit = javaService.commitInventoryReservation;
        process.env.RAZORPAY_WEBHOOK_SECRET = "mongo-integration-webhook-secret";
        javaService.commitInventoryReservation = async () => {
            throw Object.assign(new Error("simulated inventory outage"), { code: "ECONNRESET" });
        };
        subtest.after(() => {
            if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
            else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
            javaService.commitInventoryReservation = originalCommit;
        });

        const userId = makeObjectId();
        const orderId = makeObjectId();
        const attemptId = makeObjectId();
        const inventoryId = makeObjectId();
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        const id = checkoutId("late-capture");
        const attemptKey = checkoutId("late-capture-payment-attempt");
        const providerOrderId = checkoutId("late-capture-provider-order");
        const providerPaymentId = checkoutId("late-capture-provider-payment");
        ids.orders.push(orderId);
        ids.attempts.push(attemptId);
        ids.inventory.push(inventoryId);
        ids.payments.push(makeObjectId());
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 0,
            reservations: [{
                checkoutId: id,
                quantity: 1,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });
        await CheckoutAttempt.create({
            _id: attemptId,
            userId,
            checkoutId: id,
            status: "WAITING_PAYMENT",
            paymentState: "PENDING",
            orderId,
            warehouseId,
            reservationItems: [{ productId, quantity: 1 }]
        });
        await Order.create({
            _id: orderId,
            orderNumber: checkoutId("late-capture-order"),
            userId,
            checkoutId: id,
            warehouseId,
            items: [{ productId, quantity: 1 }],
            paymentMethod: "Razorpay",
            paymentStatus: "Pending"
        });
        await Payment.create({
            _id: ids.payments[ids.payments.length - 1],
            userId,
            orderId,
            amount: 1,
            amountMinor: 100,
            currency: "INR",
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            attemptId: attemptKey,
            providerCreateState: "CREATED",
            razorpayOrderId: providerOrderId
        });

        const paymentEntity = {
            id: providerPaymentId,
            order_id: providerOrderId,
            amount: 100,
            currency: "INR"
        };
        const failedEventId = checkoutId("late-capture-failed-event");
        ids.paymentEvents.push(failedEventId);
        await paymentService.processWebhook(makeSignedWebhook(failedEventId, {
            event: "payment.failed",
            payload: { payment: { entity: { ...paymentEntity, status: "failed", captured: false } } }
        }));
        let inventory = await Inventory.collection.findOne({ _id: inventoryId });
        let payment = await Payment.findById(ids.payments[ids.payments.length - 1]).lean();
        assert.equal(payment.paymentStatus, "Failed");
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations[0].status, "RESERVED");

        const capturedEventId = checkoutId("late-capture-captured-event");
        ids.paymentEvents.push(capturedEventId);
        await paymentService.processWebhook(makeSignedWebhook(capturedEventId, {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: { ...paymentEntity, status: "captured", captured: true }
                }
            }
        }));
        const paidOrder = await Order.findById(orderId).lean();
        const recoveredAttempt = await CheckoutAttempt.findById(attemptId).lean();
        inventory = await Inventory.collection.findOne({ _id: inventoryId });
        payment = await Payment.findById(ids.payments[ids.payments.length - 1]).lean();
        assert.equal(paidOrder.paymentStatus, "Paid");
        assert.equal(payment.paymentStatus, "Success");
        assert.equal(recoveredAttempt.paymentState, "SUCCEEDED");
        assert.equal(recoveredAttempt.status, "RECOVERY_REQUIRED");
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations[0].status, "RESERVED");

        const retry = await spawnRecoveryWorker();
        assert.equal(retry.code, 0, retry.stderr);
        const finalAttempt = await CheckoutAttempt.findById(attemptId).lean();
        inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(finalAttempt.status, "COMPLETED");
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations[0].status, "COMMITTED");
    });

    await t.test("two Node worker processes cannot both own a recovery lease", async (subtest) => {
        const originalLeaseMs = process.env.CHECKOUT_RECOVERY_LEASE_MS;
        process.env.CHECKOUT_RECOVERY_LEASE_MS = "3000";
        subtest.after(() => {
            if (originalLeaseMs === undefined) delete process.env.CHECKOUT_RECOVERY_LEASE_MS;
            else process.env.CHECKOUT_RECOVERY_LEASE_MS = originalLeaseMs;
        });
        const userId = makeObjectId();
        const orderId = makeObjectId();
        const inventoryId = makeObjectId();
        const id = checkoutId("two-workers");
        ids.orders.push(orderId);
        ids.inventory.push(inventoryId);
        ids.attempts.push(makeObjectId());
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 0,
            reservations: [{
                checkoutId: id,
                quantity: 1,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });
        const attempt = await CheckoutAttempt.create({
            _id: ids.attempts[ids.attempts.length - 1],
            userId,
            checkoutId: id,
            status: "RECOVERY_REQUIRED",
            warehouseId,
            reservationItems: [{ productId, quantity: 1 }],
            leaseExpiresAt: new Date(Date.now() - 10_000)
        });
        const orderItems = [{
            productId: attempt.reservationItems[0].productId,
            quantity: 1
        }];
        await Order.create({
            _id: orderId,
            orderNumber: checkoutId("two-workers-order"),
            userId,
            warehouseId: attempt.warehouseId,
            checkoutId: id,
            items: orderItems,
            paymentMethod: "Cash On Delivery",
            paymentStatus: "Pending"
        });
        const firstWorker = spawnRecoveryWorker({ delayMs: 600 });
        await wait(100);
        const secondWorker = await spawnRecoveryWorker();
        const firstResult = await firstWorker;
        assert.equal(firstResult.code, 0, firstResult.stderr);
        assert.equal(secondWorker.code, 0, secondWorker.stderr);
        const refreshed = await CheckoutAttempt.findById(attempt._id).lean();
        assert.equal(refreshed.recoveryAttempts, 1);
        assert.equal(refreshed.status, "COMPLETED");
    });

    await t.test("a crashed lease owner is retried after expiry", async (subtest) => {
        const originalLeaseMs = process.env.CHECKOUT_RECOVERY_LEASE_MS;
        process.env.CHECKOUT_RECOVERY_LEASE_MS = "1000";
        subtest.after(() => {
            if (originalLeaseMs === undefined) delete process.env.CHECKOUT_RECOVERY_LEASE_MS;
            else process.env.CHECKOUT_RECOVERY_LEASE_MS = originalLeaseMs;
        });
        const userId = makeObjectId();
        const orderId = makeObjectId();
        const inventoryId = makeObjectId();
        const id = checkoutId("crashed-worker");
        ids.orders.push(orderId);
        ids.inventory.push(inventoryId);
        const attemptId = makeObjectId();
        ids.attempts.push(attemptId);
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 0,
            reservations: [{
                checkoutId: id,
                quantity: 1,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });
        await CheckoutAttempt.create({
            _id: attemptId,
            userId,
            checkoutId: id,
            status: "RECOVERY_REQUIRED",
            warehouseId,
            reservationItems: [{ productId, quantity: 1 }],
            leaseExpiresAt: new Date(Date.now() - 10_000)
        });
        await Order.create({
            _id: orderId,
            orderNumber: checkoutId("crashed-order"),
            userId,
            warehouseId,
            checkoutId: id,
            items: [{ productId, quantity: 1 }],
            paymentMethod: "Cash On Delivery",
            paymentStatus: "Pending"
        });
        const crashed = await spawnRecoveryWorker({ crashAfterClaim: true });
        assert.equal(crashed.code, 86);
        const claimed = await CheckoutAttempt.findById(attemptId).lean();
        assert.equal(claimed.status, "RECOVERING");
        await wait(1100);
        const retry = await spawnRecoveryWorker();
        assert.equal(retry.code, 0, retry.stderr);
        const recovered = await CheckoutAttempt.findById(attemptId).lean();
        assert.equal(recovered.status, "COMPLETED");
        assert.equal(recovered.recoveryAttempts, 2);
    });

    await t.test("verified payment survives a worker crash before inventory commitment", async (subtest) => {
        const originalLeaseMs = process.env.CHECKOUT_RECOVERY_LEASE_MS;
        process.env.CHECKOUT_RECOVERY_LEASE_MS = "1000";
        subtest.after(() => {
            if (originalLeaseMs === undefined) delete process.env.CHECKOUT_RECOVERY_LEASE_MS;
            else process.env.CHECKOUT_RECOVERY_LEASE_MS = originalLeaseMs;
        });
        const userId = makeObjectId();
        const orderId = makeObjectId();
        const attemptId = makeObjectId();
        const inventoryId = makeObjectId();
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        const id = checkoutId("paid-before-commit");
        ids.orders.push(orderId);
        ids.attempts.push(attemptId);
        ids.inventory.push(inventoryId);
        ids.payments.push(makeObjectId());
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 0,
            reservations: [{
                checkoutId: id,
                quantity: 1,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });
        await CheckoutAttempt.create({
            _id: attemptId,
            userId,
            checkoutId: id,
            status: "RECOVERY_REQUIRED",
            paymentState: "SUCCEEDED",
            orderId,
            warehouseId,
            reservationItems: [{ productId, quantity: 1 }],
            leaseExpiresAt: new Date(Date.now() - 10_000)
        });
        await Order.create({
            _id: orderId,
            orderNumber: checkoutId("paid-before-commit-order"),
            userId,
            checkoutId: id,
            warehouseId,
            items: [{ productId, quantity: 1 }],
            paymentMethod: "Razorpay",
            paymentStatus: "Paid"
        });
        await Payment.create({
            _id: ids.payments[ids.payments.length - 1],
            userId,
            orderId,
            amount: 1,
            amountMinor: 100,
            currency: "INR",
            paymentMethod: "Razorpay",
            paymentStatus: "Success",
            attemptId: checkoutId("paid-before-commit-attempt"),
            providerCreateState: "CREATED",
            razorpayOrderId: checkoutId("provider-order"),
            razorpayPaymentId: checkoutId("provider-payment"),
            verifiedAt: new Date(),
            verificationSource: "WEBHOOK"
        });

        const crashed = await spawnRecoveryWorker({ crashAfterClaim: true });
        assert.equal(crashed.code, 86);
        const afterCrash = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(afterCrash.stock, 0);
        assert.equal(afterCrash.reservations[0].status, "RESERVED");
        await wait(1100);

        const retry = await spawnRecoveryWorker();
        assert.equal(retry.code, 0, retry.stderr);
        const recovered = await CheckoutAttempt.findById(attemptId).lean();
        const inventory = await Inventory.collection.findOne({ _id: inventoryId });
        assert.equal(recovered.status, "COMPLETED");
        assert.equal(inventory.stock, 0);
        assert.equal(inventory.reservations[0].status, "COMMITTED");
    });

    await t.test("a stale worker cannot overwrite a newer recovery lease owner", async (subtest) => {
        const originalLeaseMs = process.env.CHECKOUT_RECOVERY_LEASE_MS;
        process.env.CHECKOUT_RECOVERY_LEASE_MS = "1000";
        subtest.after(() => {
            if (originalLeaseMs === undefined) delete process.env.CHECKOUT_RECOVERY_LEASE_MS;
            else process.env.CHECKOUT_RECOVERY_LEASE_MS = originalLeaseMs;
        });
        const userId = makeObjectId();
        const orderId = makeObjectId();
        const inventoryId = makeObjectId();
        const id = checkoutId("expired-running-worker");
        ids.orders.push(orderId);
        ids.inventory.push(inventoryId);
        const attemptId = makeObjectId();
        ids.attempts.push(attemptId);
        const warehouseId = makeObjectId();
        const productId = makeObjectId();
        await Inventory.collection.insertOne({
            _id: inventoryId,
            warehouse: warehouseId,
            product: productId,
            stock: 0,
            reservations: [{
                checkoutId: id,
                quantity: 1,
                status: "RESERVED",
                createdAt: new Date()
            }]
        });
        await CheckoutAttempt.create({
            _id: attemptId,
            userId,
            checkoutId: id,
            status: "RECOVERY_REQUIRED",
            warehouseId,
            reservationItems: [{ productId, quantity: 1 }],
            leaseExpiresAt: new Date(Date.now() - 10_000)
        });
        await Order.create({
            _id: orderId,
            orderNumber: checkoutId("expired-running-order"),
            userId,
            warehouseId,
            checkoutId: id,
            items: [{ productId, quantity: 1 }],
            paymentMethod: "Cash On Delivery",
            paymentStatus: "Pending"
        });

        const staleWorker = spawnRecoveryWorker({ delayMs: 2200 });
        await wait(1200);
        const currentWorker = await spawnRecoveryWorker();
        const staleResult = await staleWorker;
        assert.equal(staleResult.code, 0, staleResult.stderr);
        assert.equal(currentWorker.code, 0, currentWorker.stderr);
        const recovered = await CheckoutAttempt.findById(attemptId).lean();
        assert.equal(recovered.status, "COMPLETED");
        assert.equal(recovered.recoveryAttempts, 2);
    });
});

test("MongoDB integration URI rejects non-local or non-test databases", () => {
    assert.throws(
        () => getSafeMongoTestUri("mongodb://example.com/supply_chain_test"),
        /restricted/
    );
    assert.throws(
        () => getSafeMongoTestUri("mongodb://127.0.0.1/supply_chain_db"),
        /restricted/
    );
});
