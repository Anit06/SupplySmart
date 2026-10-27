const test = require("node:test");
const assert = require("node:assert/strict");

const Cart = require("../src/models/Cart");
const CheckoutAttempt = require("../src/models/CheckoutAttempt");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const Product = require("../src/models/Product");
const ProductPrice = require("../src/models/ProductPrice");
const User = require("../src/models/User");
const ShopkeeperDetails = require("../src/models/ShopkeeperDetails");
const javaService = require("../src/services/javaService");
const cartService = require("../src/services/cartService");
const orderService = require("../src/services/orderService");
const cartController = require("../src/controllers/cartController");

const originalMethods = {};
const mockedModules = [
    [Cart, ["findOne", "deleteOne"]],
    [CheckoutAttempt, ["create", "findOne", "updateOne", "deleteOne"]],
    [Order, ["findOne", "create"]],
    [Payment, ["findOne"]],
    [Product, ["findById"]],
    [ProductPrice, ["findOne"]],
    [User, ["findById"]],
    [ShopkeeperDetails, ["findOne"]],
    [javaService, ["reserveInventory", "commitInventoryReservation", "releaseInventoryReservation"]]
];

const makeCart = (userId, quantity = 1) => ({
    _id: `cart-${userId}`,
    userId,
    warehouseId: "warehouse-1",
    items: Array.isArray(quantity)
        ? quantity
        : [{ productId: "product-1", quantity, price: 999, productName: "Untrusted name" }],
    updatedAt: new Date()
});

const setup = (t, {
    stock = 1,
    carts = [],
    orderCreateFailure = null,
    reserveFailure = null,
    commitFailure = null
} = {}) => {
    const cartByUser = new Map(carts.map((cart) => [String(cart.userId), cart]));
    const attempts = new Map();
    const orders = new Map();
    const reservations = new Map();
    let availableStock = stock;
    let reserveCalls = 0;
    let releaseCalls = 0;
    let createdOrders = 0;
    let commitCalls = 0;

    for (const [module, methods] of mockedModules) {
        for (const method of methods) {
            const methodKey = `${module.modelName || "java"}:${method}`;
            originalMethods[methodKey] = module[method];
        }
    }
    t.after(() => {
        for (const [module, methods] of mockedModules) {
            for (const method of methods) {
                const methodKey = `${module.modelName || "java"}:${method}`;
                module[method] = originalMethods[methodKey];
                delete originalMethods[methodKey];
            }
        }
    });

    Cart.findOne = async ({ userId }) => cartByUser.get(String(userId)) || null;
    Cart.deleteOne = async () => ({ deletedCount: 1 });
    CheckoutAttempt.create = async ({ userId, checkoutId, status }) => {
        const key = `${userId}:${checkoutId}`;
        if (attempts.has(key)) {
            const error = new Error("duplicate attempt");
            error.code = 11000;
            throw error;
        }
        attempts.set(key, { userId, checkoutId, status });
        return attempts.get(key);
    };
    CheckoutAttempt.findOne = (filter) => ({
        lean: async () => attempts.get(`${filter.userId}:${filter.checkoutId}`) || null
    });
    CheckoutAttempt.updateOne = async (filter, update, options = {}) => {
        const key = `${filter.userId}:${filter.checkoutId}`;
        const current = attempts.get(key) || (options.upsert ? {} : null);
        if (current) {
            Object.assign(current, update.$set);
            attempts.set(key, current);
        }
        return { modifiedCount: current ? 1 : 0 };
    };
    CheckoutAttempt.deleteOne = async (filter) => ({
        deletedCount: attempts.delete(`${filter.userId}:${filter.checkoutId}`) ? 1 : 0
    });
    Order.findOne = async (filter) => orders.get(`${filter.userId}:${filter.checkoutId}`) || null;
    Payment.findOne = () => ({ lean: async () => null });
    Order.create = async (data) => {
        if (orderCreateFailure) {
            throw orderCreateFailure;
        }
        const order = { ...data, _id: `order-${++createdOrders}`, items: data.items };
        orders.set(`${data.userId}:${data.checkoutId}`, order);
        return order;
    };
    Product.findById = (productId) => ({
        lean: async () => ({
            _id: productId,
            name: "Verified product",
            category: "Food",
            image: "verified.jpg",
            sku: "VERIFIED-1",
            description: "verified",
            unit: "KG",
            price: 10,
            status: "Active"
        })
    });
    ProductPrice.findOne = () => ({ lean: async () => ({ price: 20 }) });
    User.findById = async () => ({ fullName: "Shopkeeper", phone: "123" });
    ShopkeeperDetails.findOne = async () => ({ addresses: [] });
    javaService.reserveInventory = async (reservation) => {
        reserveCalls += 1;
        if (reserveFailure) {
            const failure = typeof reserveFailure === "function"
                ? reserveFailure(reservation)
                : reserveFailure;
            if (failure) {
                throw failure;
            }
        }
        const key = `${reservation.checkoutId}:${reservation.productId}`;
        if (reservations.has(key)) {
            return;
        }
        if (availableStock < reservation.quantity) {
            throw new Error("Not enough stock available");
        }
        availableStock -= reservation.quantity;
        reservations.set(key, { ...reservation, status: "RESERVED" });
    };
    javaService.commitInventoryReservation = async (reservation) => {
        commitCalls += 1;
        if (commitFailure && commitCalls === 1) {
            throw commitFailure;
        }
        const key = `${reservation.checkoutId}:${reservation.productId}`;
        const current = reservations.get(key);
        if (current) {
            current.status = "COMMITTED";
        }
    };
    javaService.releaseInventoryReservation = async (reservation) => {
        releaseCalls += 1;
        const key = `${reservation.checkoutId}:${reservation.productId}`;
        const current = reservations.get(key);
        if (current && current.status !== "RELEASED") {
            availableStock += current.quantity;
            current.status = "RELEASED";
        }
    };

    return {
        get availableStock() { return availableStock; },
        get reserveCalls() { return reserveCalls; },
        get releaseCalls() { return releaseCalls; },
        get commitCalls() { return commitCalls; },
        get createdOrders() { return createdOrders; },
        attempts,
        orders
    };
};

const checkout = (userId, checkoutId, overrides = {}) => cartService.placeOrder(userId, {
    warehouseId: "warehouse-1",
    checkoutId,
    addressId: null,
    paymentMethod: "Cash On Delivery",
    subtotal: 1,
    discountAmount: 9999,
    finalAmount: 0,
    ...overrides
});

test("checkout rejects non-positive and fractional quantities", () => {
    const { validateCartItemQuantity } = cartService;
    assert.equal(validateCartItemQuantity(0, 10).valid, false);
    assert.equal(validateCartItemQuantity(-1, 10).valid, false);
    assert.equal(validateCartItemQuantity(1.5, 10).valid, false);
});

test("checkout retry errors return conflict codes so the client rotates its idempotency key", async () => {
    const originalPlaceOrder = cartService.placeOrder;
    let statusCode;
    let responseBody;
    cartService.placeOrder = async () => {
        throw Object.assign(new Error("Checkout expired"), {
            code: "CHECKOUT_EXPIRED"
        });
    };
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        }
    };

    try {
        await cartController.placeOrder(
            { user: { id: "user-1" }, body: {} },
            response
        );
        assert.equal(statusCode, 409);
        assert.equal(responseBody.code, "CHECKOUT_EXPIRED");
    } finally {
        cartService.placeOrder = originalPlaceOrder;
    }
});

test("cart retrieval is scoped to the requesting shopkeeper", async (t) => {
    const cart = makeCart("owner");
    setup(t, { carts: [cart] });
    assert.equal(await cartService.getCart("owner", "warehouse-1"), cart);
    assert.equal(await cartService.getCart("another-user", "warehouse-1"), null);
});

test("order detail lookup includes the requesting shopkeeper in its query", async (t) => {
    setup(t);
    const originalFindOne = Order.findOne;
    let query;
    const order = { _id: "owned-order" };
    Order.findOne = (filter) => {
        query = filter;
        return {
            populate() { return this; },
            then(resolve, reject) {
                return Promise.resolve(filter.userId === "owner" ? order : null).then(resolve, reject);
            }
        };
    };

    await assert.rejects(orderService.getOrderById("another-user", "owned-order"), /Order not found/);
    assert.equal(query.userId, "another-user");
    assert.equal(query._id, "owned-order");
    Order.findOne = originalFindOne;
});

test("checkout rejects quantities above currently available warehouse stock", async (t) => {
    const state = setup(t, { stock: 1, carts: [makeCart("user-1", 2)] });
    await assert.rejects(checkout("user-1", "checkout-stock-01"), /stock/i);
    assert.equal(state.createdOrders, 0);
    assert.equal(state.availableStock, 1);
});

test("checkout revalidates stock after a cart item was added", async (t) => {
    const state = setup(t, { stock: 0, carts: [makeCart("user-1", 1)] });
    await assert.rejects(checkout("user-1", "checkout-changed-01"), /stock/i);
    assert.equal(state.reserveCalls, 1);
    assert.equal(state.createdOrders, 0);
    assert.equal(state.availableStock, 0);
});

test("only one of two users can reserve the last unit concurrently", async (t) => {
    const state = setup(t, {
        stock: 1,
        carts: [makeCart("user-1", 1), makeCart("user-2", 1)]
    });
    const results = await Promise.allSettled([
        checkout("user-1", "checkout-user-001"),
        checkout("user-2", "checkout-user-002")
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(state.createdOrders, 1);
    assert.equal(state.availableStock, 0);
});

test("concurrent purchases never oversell limited stock", async (t) => {
    const state = setup(t, {
        stock: 3,
        carts: [
            makeCart("user-1", 2),
            makeCart("user-2", 2),
            makeCart("user-3", 1)
        ]
    });
    const results = await Promise.allSettled([
        checkout("user-1", "checkout-limit-001"),
        checkout("user-2", "checkout-limit-002"),
        checkout("user-3", "checkout-limit-003")
    ]);
    const orderedQuantity = results
        .filter((result) => result.status === "fulfilled")
        .reduce((total, result) => total + result.value.items[0].quantity, 0);
    assert.ok(orderedQuantity <= 3);
    assert.equal(state.availableStock, 3 - orderedQuantity);
});

test("duplicate checkout submissions create one order and reuse it on retry", async (t) => {
    const state = setup(t, { stock: 2, carts: [makeCart("user-1", 1)] });
    const submissions = await Promise.allSettled([
        checkout("user-1", "checkout-duplicate-01"),
        checkout("user-1", "checkout-duplicate-01")
    ]);
    assert.equal(submissions.filter((result) => result.status === "fulfilled").length, 1);
    const order = submissions.find((result) => result.status === "fulfilled").value;
    const retriedOrder = await checkout("user-1", "checkout-duplicate-01");
    assert.equal(state.createdOrders, 1);
    assert.equal(state.reserveCalls, 1);
    assert.equal(retriedOrder._id, order._id);
});

test("order creation followed by commit failure is recovered without duplicate order creation", async (t) => {
    const state = setup(t, {
        stock: 2,
        carts: [makeCart("user-1", 1)],
        commitFailure: new Error("Inventory commit unavailable")
    });
    await assert.rejects(
        checkout("user-1", "checkout-commit-01"),
        /finalization failed/
    );
    assert.equal(state.createdOrders, 1);
    assert.equal(state.attempts.get("user-1:checkout-commit-01").status, "RECOVERY_REQUIRED");

    const retry = await checkout("user-1", "checkout-commit-01");
    assert.equal(state.createdOrders, 1);
    assert.equal(retry._id, "order-1");
    assert.equal(state.releaseCalls, 0);
});

test("inventory failure does not create an order or consume stock", async (t) => {
    const state = setup(t, {
        stock: 2,
        carts: [makeCart("user-1", 1)],
        reserveFailure: new Error("Inventory service unavailable")
    });
    await assert.rejects(checkout("user-1", "checkout-down-0001"), /Inventory service unavailable/);
    assert.equal(state.createdOrders, 0);
    assert.equal(state.availableStock, 2);
});

test("database failure after reservation releases stock", async (t) => {
    const state = setup(t, {
        stock: 2,
        carts: [makeCart("user-1", 1)],
        orderCreateFailure: new Error("Database write failed")
    });
    await assert.rejects(
        checkout("user-1", "checkout-db-000001"),
        (error) => error.code === "CHECKOUT_RETRY_NEW_ID"
            && /Database write failed/.test(error.message)
    );
    assert.equal(state.availableStock, 2);
    assert.equal(state.releaseCalls, 1);
    assert.equal(state.createdOrders, 0);
});

test("a later item reservation failure releases earlier item reservations", async (t) => {
    const state = setup(t, {
        stock: 2,
        carts: [makeCart("user-1", [
            { productId: "product-1", quantity: 1, price: 1 },
            { productId: "product-2", quantity: 1, price: 1 }
        ])],
        reserveFailure: (reservation) => reservation.productId === "product-2"
            ? new Error("Second product unavailable")
            : null
    });
    await assert.rejects(checkout("user-1", "checkout-partial-01"), /Second product unavailable/);
    assert.equal(state.availableStock, 2);
    assert.equal(state.releaseCalls, 2);
    assert.equal(state.createdOrders, 0);
});

test("checkout ignores client prices and totals and recalculates order amount", async (t) => {
    setup(t, { stock: 2, carts: [makeCart("user-1", 2)] });
    const order = await checkout("user-1", "checkout-price-0001", { couponCode: "SAVE10" });
    assert.equal(order.items[0].productName, "Verified product");
    assert.equal(order.items[0].price, 20);
    assert.equal(order.subtotal, 40);
    assert.equal(order.discountAmount, 4);
    assert.equal(order.taxAmount, 6);
    assert.equal(order.finalAmount, 42);
});
