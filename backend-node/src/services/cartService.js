const Cart = require("../models/Cart");
const Order = require("../models/Order");
const User = require("../models/User");
const ShopkeeperDetails = require("../models/ShopkeeperDetails");
const Product = require("../models/Product");
const ProductPrice = require("../models/ProductPrice");
const CheckoutAttempt = require("../models/CheckoutAttempt");
const javaService = require("./javaService");

const getCheckoutRecoveryGraceMs = () => {
    const configured = Number(process.env.CHECKOUT_RECOVERY_GRACE_MS);
    return Number.isFinite(configured) && configured >= 60_000
        ? configured
        : 15 * 60 * 1000;
};

/*
=========================================
Calculate Cart Total
=========================================
*/

const validateCartItemQuantity = (quantity, availableStock) => {
    const requestedQuantity = Number(quantity);
    const stock = Number(availableStock);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
        return { valid: false, message: "Quantity must be at least 1" };
    }

    if (!Number.isFinite(stock) || requestedQuantity > stock) {
        return { valid: false, message: "Requested quantity exceeds available stock" };
    }

    return { valid: true, message: "" };
};

const getCurrentProduct = async (productId) => {
    const product = await Product.findById(productId).lean();
    if (!product || product.status === "Inactive") {
        throw new Error("Product is not available");
    }

    const priceDoc = await ProductPrice.findOne({ productId }).lean();
    const price = Number(priceDoc?.price ?? product.price);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error("Product price is unavailable");
    }

    return {
        productId: product._id,
        productName: product.name,
        category: product.category,
        image: product.image,
        sku: product.sku,
        description: product.description,
        unit: product.unit || "KG",
        price
    };
};

const calculateCheckoutTotals = (items, couponCode) => {
    const subtotal = Math.round(items.reduce(
        (total, item) => total + item.price * item.quantity,
        0
    ) * 100) / 100;
    const normalizedCode = String(couponCode || "").trim().toUpperCase();
    let discountAmount = 0;

    if (normalizedCode === "SAVE10") {
        discountAmount = Math.round(subtotal * 0.1);
    } else if (normalizedCode === "FLAT100") {
        if (subtotal < 1000) {
            throw new Error("Minimum order value ₹1000 required for this coupon");
        }
        discountAmount = 100;
    } else if (normalizedCode) {
        throw new Error("Invalid coupon code");
    }

    discountAmount = Math.min(discountAmount, subtotal);
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = Math.round(taxableAmount * 0.18);

    return {
        subtotal,
        discountAmount,
        taxAmount,
        finalAmount: Math.round((taxableAmount + taxAmount) * 100) / 100,
        couponCode: normalizedCode
    };
};

const calculateCartTotals = (items = []) => ({
    cartTotal: items.reduce(
        (total, item) => total + Number(item.price) * Number(item.quantity),
        0
    )
});

const calculateCartTotal = (items) => {
    items.forEach((item) => {
        item.subtotal = item.price * item.quantity;
    });

    return calculateCartTotals(items).cartTotal;
};

const getAvailableStock = async (warehouseId, productId) => {
    const response = await javaService.getInventoryByWarehouse(warehouseId);
    const inventory = response.data?.inventory || response.data || [];
    const productInventory = inventory.find(
        (item) => String(item.productId) === String(productId)
    );

    if (!productInventory) {
        throw new Error("Product is not available in this warehouse");
    }

    return productInventory.stock;
};

/*
=========================================
Add Product To Cart
=========================================
*/

const addItemToCart = async (data) => {

    const availableStock = await getAvailableStock(data.warehouseId, data.productId);
    const requestedQuantity = Number(data.quantity);
    const quantityValidation = validateCartItemQuantity(requestedQuantity, availableStock);
    if (!quantityValidation.valid) {
        throw new Error(quantityValidation.message);
    }

    const currentProduct = await getCurrentProduct(data.productId);

    let cart = await Cart.findOne({

        userId: data.userId,
        warehouseId: data.warehouseId

    });

    if (!cart) {

        cart = new Cart({

            userId: data.userId,
            warehouseId: data.warehouseId,
            items: []

        });

    }

    const existingItem = cart.items.find(

        item => item.productId.toString() === data.productId

    );
    const quantityToValidate = requestedQuantity + (existingItem?.quantity || 0);
    const combinedQuantityValidation = validateCartItemQuantity(quantityToValidate, availableStock);

    if (!combinedQuantityValidation.valid) {
        throw new Error(combinedQuantityValidation.message);
    }

    if (existingItem) {

        existingItem.quantity = quantityToValidate;
        Object.assign(existingItem, currentProduct);

        existingItem.subtotal =
            existingItem.quantity * existingItem.price;

    }

    else {

        cart.items.push({

            ...currentProduct,

            quantity: requestedQuantity,

            subtotal: currentProduct.price * requestedQuantity

        });

    }

    cart.cartTotal = calculateCartTotal(cart.items);

    await cart.save();

    return cart;

};

/*
=========================================
Get Cart
=========================================
*/

const getCart = async (userId, warehouseId) => {

    const cart = await Cart.findOne({

        userId,
        warehouseId

    });

    return cart;

};

/*
=========================================
Update Quantity
=========================================
*/

const updateQuantity = async (

    userId,
    warehouseId,
    productId,
    quantity

) => {

    const cart = await Cart.findOne({

        userId,
        warehouseId

    });

    if (!cart) {

        throw new Error("Cart not found");

    }

    const item = cart.items.find(

        item => item.productId.toString() === productId

    );

    if (!item) {

        throw new Error("Product not found in cart");

    }

    const availableStock = await getAvailableStock(warehouseId, productId);
    const quantityValidation = validateCartItemQuantity(quantity, availableStock);

    if (!quantityValidation.valid) {
        throw new Error(quantityValidation.message);
    }

    const currentProduct = await getCurrentProduct(productId);
    Object.assign(item, currentProduct);
    item.quantity = Number(quantity);

    item.subtotal = item.quantity * item.price;

    cart.cartTotal = calculateCartTotal(cart.items);

    await cart.save();

    return cart;

};

/*
=========================================
Remove Product
=========================================
*/

const removeItem = async (

    userId,
    warehouseId,
    productId

) => {

    const cart = await Cart.findOne({

        userId,
        warehouseId

    });

    if (!cart) {

        throw new Error("Cart not found");

    }

    cart.items = cart.items.filter(

        item => item.productId.toString() !== productId

    );

    cart.cartTotal = calculateCartTotal(cart.items);

    await cart.save();

    return cart;

};

/*
=========================================
Clear Cart
=========================================
*/

const clearCart = async (

    userId,
    warehouseId

) => {

    await Cart.deleteOne({

        userId,
        warehouseId

    });

};

/*
=========================================
Place Order
=========================================
*/

const placeOrder = async (userId, orderData) => {
    const warehouseId = orderData.warehouseId;
    const checkoutId = String(orderData.checkoutId || "");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId)) {
        throw new Error("A valid checkout ID is required");
    }

    const finalizeExistingOrder = async (order) => {
        await CheckoutAttempt.updateOne(
            { userId, checkoutId },
            {
                $set: {
                    status: "RECOVERY_REQUIRED",
                    orderId: order._id,
                    warehouseId: order.warehouseId,
                    reservationItems: order.items.map((item) => ({
                        productId: item.productId,
                        quantity: item.quantity
                    })),
                    leaseExpiresAt: new Date()
                }
            },
            { upsert: true }
        );
        return order;
    };

    const existingOrder = await Order.findOne({ userId, checkoutId });
    if (existingOrder) {
        return finalizeExistingOrder(existingOrder);
    }

    try {
        await CheckoutAttempt.create({
            userId,
            checkoutId,
            status: "PROCESSING",
            paymentState: "NOT_STARTED",
            warehouseId,
            leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
        });
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }

        const duplicateOrder = await Order.findOne({ userId, checkoutId });
        if (duplicateOrder) {
            return finalizeExistingOrder(duplicateOrder);
        }

        const attempt = await CheckoutAttempt.findOne({ userId, checkoutId }).lean();
        if (attempt?.status === "CANCELLED") {
            throw Object.assign(
                new Error("This checkout expired during recovery. Start checkout again."),
                { code: "CHECKOUT_EXPIRED" }
            );
        }
        if (attempt?.status === "RECOVERY_REQUIRED") {
            throw new Error("Checkout needs inventory recovery before it can be retried");
        }
        throw new Error("Checkout is already being processed; retry with the same checkout ID");
    }

    let orderCreated = false;
    let reservationItems = [];
    try {
        const cart = await Cart.findOne({ userId, warehouseId });
        if (!cart) {
            throw new Error("Cart not found");
        }
        if (cart.items.length === 0) {
            throw new Error("Cart is empty");
        }

        const currentItems = [];
        for (const item of cart.items) {
            const quantityValidation = validateCartItemQuantity(item.quantity, Number.MAX_SAFE_INTEGER);
            if (!quantityValidation.valid) {
                throw new Error(quantityValidation.message);
            }

            const currentProduct = await getCurrentProduct(item.productId);
            currentItems.push({
                ...currentProduct,
                quantity: item.quantity,
                subtotal: currentProduct.price * item.quantity
            });
        }
        const totals = calculateCheckoutTotals(currentItems, orderData.couponCode);

        reservationItems = currentItems.map((item) => ({
            checkoutId,
            warehouseId: String(cart.warehouseId),
            productId: String(item.productId),
            quantity: item.quantity
        }));
        await CheckoutAttempt.updateOne(
            { userId, checkoutId, status: "PROCESSING" },
            {
                $set: {
                    warehouseId: cart.warehouseId,
                    reservationItems: reservationItems.map(({ productId, quantity }) => ({
                        productId,
                        quantity
                    })),
                    leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
                }
            }
        );
        for (const reservation of reservationItems) {
            await CheckoutAttempt.updateOne(
                { userId, checkoutId, status: "PROCESSING" },
                {
                    $set: {
                        leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
                    }
                }
            );
            await javaService.reserveInventory(reservation);
        }

        const user = await User.findById(userId);
        const profile = await ShopkeeperDetails.findOne({ userId });
        const addresses = profile?.addresses || [];
        const selectedAddress = addresses.id?.(orderData.addressId)
            || addresses.find((item) => item.isDefault)
            || addresses[0]
            || null;
        if (orderData.addressId && !addresses.some(
            (address) => String(address._id) === String(orderData.addressId)
        )) {
            throw new Error("Selected delivery address is not available");
        }
        const deliveryAddress = selectedAddress
            ? [
                selectedAddress.fullName,
                selectedAddress.phone,
                selectedAddress.addressLine1,
                selectedAddress.addressLine2,
                selectedAddress.landmark,
                selectedAddress.city,
                selectedAddress.state,
                selectedAddress.country,
                selectedAddress.pincode
            ].filter(Boolean).join(", ")
            : "";

        const order = await Order.create({
            orderNumber: `ORD-${Date.now()}-${checkoutId.slice(0, 8)}`,
            checkoutId,
            shopkeeperName: profile?.fullName || user?.fullName || "",
            shopkeeperPhone: profile?.phone || user?.phone || "",
            deliveryAddress,
            userId,
            warehouseId: cart.warehouseId,
            items: currentItems,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            taxAmount: totals.taxAmount,
            couponCode: totals.couponCode,
            finalAmount: totals.finalAmount,
            totalAmount: totals.finalAmount,
            paymentMethod: orderData.paymentMethod === "Cash On Delivery"
                ? "Cash On Delivery"
                : "Razorpay",
            paymentStatus: "Pending",
            addressId: selectedAddress?._id || null
        });
        orderCreated = true;
        await CheckoutAttempt.updateOne(
            { userId, checkoutId },
            {
                $set: {
                    status: "RECOVERY_REQUIRED",
                    orderId: order._id,
                    leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
                }
            }
        );

        for (const reservation of reservationItems) {
            await javaService.commitInventoryReservation(reservation);
        }
        await CheckoutAttempt.updateOne(
            { userId, checkoutId },
            {
                $set: {
                    status: order.paymentMethod === "Cash On Delivery" ? "COMPLETED" : "WAITING_PAYMENT",
                    paymentState: order.paymentMethod === "Cash On Delivery" ? "NOT_STARTED" : "PENDING",
                    orderId: order._id,
                    leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
                }
            }
        );

        await Cart.deleteOne({
            _id: cart._id,
            userId,
            warehouseId,
            updatedAt: cart.updatedAt
        });
        return order;
    } catch (error) {
        if (orderCreated) {
            throw new Error(
                "Order was created, but checkout finalization failed. Retry using the same checkout ID."
            );
        }

        let persistedOrder;
        try {
            persistedOrder = await Order.findOne({ userId, checkoutId });
        } catch (lookupError) {
            throw new Error(
                "Checkout state could not be confirmed. Reserved stock was left unchanged; retry with the same checkout ID."
            );
        }
        if (persistedOrder) {
            return finalizeExistingOrder(persistedOrder);
        }

        const releaseFailures = [];
        for (const reservation of reservationItems.slice().reverse()) {
            try {
                await javaService.releaseInventoryReservation(reservation);
            } catch (releaseError) {
                releaseFailures.push(releaseError);
            }
        }

        if (releaseFailures.length > 0) {
            await CheckoutAttempt.updateOne(
                { userId, checkoutId },
                {
                    $set: {
                        status: "RECOVERY_REQUIRED",
                        leaseExpiresAt: new Date(Date.now() + getCheckoutRecoveryGraceMs())
                    }
                }
            );
            throw new Error(
                `Checkout failed and reserved stock could not be fully released: ${error.message}`
            );
        }

        await CheckoutAttempt.updateOne(
            { userId, checkoutId },
            {
                $set: {
                    status: "CANCELLED",
                    leaseExpiresAt: new Date(),
                    recoveryLeaseUntil: null
                }
            }
        );
        throw Object.assign(new Error(error.message), {
            code: "CHECKOUT_RETRY_NEW_ID"
        });
    }
};

module.exports = {

    addItemToCart,

    getCart,

    updateQuantity,

    removeItem,

    clearCart,

    placeOrder,

    calculateCartTotal,

    validateCartItemQuantity,

    calculateCartTotals
};
