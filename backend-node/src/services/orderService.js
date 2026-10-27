const Order = require("../models/Order");
const Payment = require("../models/Payment");
const CheckoutAttempt = require("../models/CheckoutAttempt");
const Supplier = require("../models/Supplier");
const javaService = require("./javaService");
const {

    calculateOrderWeight,

    validateOrderStatusTransition

} = require("./orderWorkflowService");

const parseCapacityToKg = (value) => {

    if (value === null || value === undefined || value === "") {

        return 0;

    }

    if (typeof value === "number") {

        return value;

    }

    const numericValue = parseFloat(String(value).replace(/[^\d.]/g, ""));

    return Number.isFinite(numericValue) ? numericValue : 0;

};

const releaseSupplierCapacity = async (order) => {

    if (!order.allocatedSupplier || !order.assignedWeight) {

        return;

    }

    const supplier = await Supplier.findById(order.allocatedSupplier);

    if (!supplier) {

        return;

    }

    supplier.currentAssignedWeight = Math.max(

        0,

        Number(supplier.currentAssignedWeight || 0) - Number(order.assignedWeight || 0)

    );

    await supplier.save();

};

/*
==================================
GET SHOPKEEPER ORDERS
==================================
*/

const getOrdersByUser = async (userId) => {

    const orders = await Order.find({

        userId

    })

    .populate(

        "warehouseId",

        "name location"

    )

    .sort({

        createdAt: -1

    });

    return orders;

};

/*
==================================
GET ORDER DETAILS
==================================
*/

const getOrderById = async (

    userId,

    orderId

) => {

    const query = userId

        ? {

            _id: orderId,

            userId

        }

        : {

            _id: orderId

        };

    const order = await Order.findOne(query)

        .populate(

            "userId",

            "name email phone"

        )

        .populate(

            "warehouseId",

            "name location"

        )

        .populate(

            "allocatedSupplier",

            "supplierName supplierVehiclenumber supplierCapacity currentAssignedWeight"

        );

    if (!order) {

        throw new Error(

            "Order not found"

        );

    }

    return order;

};

/*
==================================
ADMIN GET ALL ORDERS
==================================
*/

const getAllOrders = async () => {

    const orders = await Order.find()

        .populate(

            "userId",

            "name email"

        )

        .populate(

            "warehouseId",

            "name location"

        )

        .populate(

            "allocatedSupplier",

            "supplierName supplierVehiclenumber supplierCapacity currentAssignedWeight"

        )

        .sort({

            createdAt: -1

        });

    return orders;

};

/*
==================================
UPDATE ORDER STATUS
==================================
*/

const updateOrderStatus = async (

    orderId,

    status,

    supplierId = null

) => {

    const order = await Order.findById(orderId)

        .populate(

            "allocatedSupplier",

            "supplierName supplierVehiclenumber supplierCapacity currentAssignedWeight"

        );

    if (!order) {

        throw new Error("Order not found");

    }

    /*
    =====================================
    Do nothing if status is same
    =====================================
    */

    if (order.status === status) {

        return order;

    }

    const validation = validateOrderStatusTransition({

        currentStatus: order.status,

        nextStatus: status,

        order,

        supplierId

    });

    if (!validation.isValid) {

        throw new Error(validation.message);

    }

    if (status === "Cancelled") {
        const successfulPayment = await Payment.findOne({
            orderId: order._id,
            paymentStatus: "Success"
        }).lean();
        if (order.paymentStatus === "Paid" || successfulPayment) {
            throw new Error("A paid order cannot be cancelled until a refund is completed.");
        }
        if (order.paymentMethod !== "Cash On Delivery" && order.paymentStatus !== "Failed") {
            throw new Error("Confirm payment failure before cancelling this order.");
        }
    }

    const orderWeight = calculateOrderWeight(order.items || []);

    if (status === "Shipped") {

        const selectedSupplier = await Supplier.findById(supplierId || order.allocatedSupplier);

        if (!selectedSupplier) {

            throw new Error("Supplier not found.");

        }

        if (order.allocatedSupplier && order.allocatedSupplier.toString() !== selectedSupplier._id.toString()) {

            throw new Error("Supplier is already allocated for this order.");

        }

        const currentAssignedWeight = Number(selectedSupplier.currentAssignedWeight || 0);

        const supplierCapacity = parseCapacityToKg(selectedSupplier.supplierCapacity);

        if (currentAssignedWeight + orderWeight > supplierCapacity) {

            throw new Error("Supplier Capacity Full");

        }

        order.allocatedSupplier = selectedSupplier._id;

        order.assignedWeight = orderWeight;

        order.allocatedAt = new Date();

        selectedSupplier.currentAssignedWeight = currentAssignedWeight + orderWeight;

        await selectedSupplier.save();

    }

    if (status === "Delivered" || status === "Cancelled") {

        /*
        =====================================
        Release supplier capacity once the order reaches a terminal state.
        This keeps the supplier capacity usage aligned with completed shipping.
        =====================================
        */

        await releaseSupplierCapacity(order);

    }

    /*
    =====================================
    Save Status History
    =====================================
    */

    order.statusHistory.push({

        status,

        updatedAt: new Date()

    });

    /*
    =====================================
    Cancel Order
    Return Inventory Only Once
    =====================================
    */

    if (

        status === "Cancelled" &&

        !order.returnedStock

    ) {
        if (order.checkoutId) {
            await CheckoutAttempt.updateOne(
                { userId: order.userId, checkoutId: order.checkoutId },
                {
                    $set: {
                        status: "RECOVERY_REQUIRED",
                        orderId: order._id,
                        ...(order.paymentStatus === "Failed" ? { paymentState: "FAILED" } : {}),
                        leaseExpiresAt: new Date()
                    }
                }
            );
        }
        order.status = status;
        await order.save();

        for (const item of order.items) {

            if (order.checkoutId) {
                await javaService.releaseInventoryReservation({
                    checkoutId: order.checkoutId,
                    warehouseId: order.warehouseId.toString(),
                    productId: item.productId.toString(),
                    quantity: item.quantity
                });
            } else {
                await javaService.addInventoryStock({
                    warehouseId: order.warehouseId.toString(),
                    productId: item.productId.toString(),
                    stock: item.quantity
                });
            }

        }

        order.returnedStock = true;
        await order.save();
        if (order.checkoutId) {
            await CheckoutAttempt.updateOne(
                { userId: order.userId, checkoutId: order.checkoutId },
                { $set: { status: "CANCELLED", recoveryLeaseUntil: null } }
            );
        }
        return order;

    }

    /*
    =====================================
    If Cancelled -> Another Status
    Don't return inventory again
    =====================================
    */

    if (

        status !== "Cancelled" &&

        order.status === "Cancelled"

    ) {

        order.returnedStock = true;

    }

    /*
    =====================================
    Update Current Status
    =====================================
    */

    order.status = status;

    await order.save();

    return order;

};

/*
==================================
ORDER ANALYTICS
==================================
*/

const getOrderAnalytics = async () => {

    const orders = await Order.find();

    let totalRevenue = 0;

    let placed = 0;
    let confirmed = 0;
    let packed = 0;
    let shipped = 0;
    let delivered = 0;
    let cancelled = 0;

    const productMap = {};

    orders.forEach(order => {

        /*
        ==========================
        STATUS COUNT
        ==========================
        */

        switch (order.status) {

            case "Placed":
                placed++;
                break;

            case "Confirmed":
                confirmed++;
                break;

            case "Packed":
                packed++;
                break;

            case "Shipped":
                shipped++;
                break;

            case "Delivered":
                delivered++;
                break;

            case "Cancelled":
                cancelled++;
                break;

        }

        /*
        ==========================
        IGNORE CANCELLED ORDERS
        ==========================
        */

        if (order.status === "Cancelled") {

            return;

        }

        /*
        ==========================
        TOTAL REVENUE
        ==========================
        */

        totalRevenue += order.totalAmount;

        /*
        ==========================
        TOP PRODUCTS
        ==========================
        */

        order.items.forEach(item => {

            if (!productMap[item.productName]) {

                productMap[item.productName] = 0;

            }

            productMap[item.productName] += item.quantity;

        });

    });

    /*
    ==========================
    TOP PRODUCTS
    ==========================
    */

    const topProducts = Object.entries(productMap)

        .map(([name, quantity]) => ({

            name,

            quantity

        }))

        .sort((a, b) => b.quantity - a.quantity)

        .slice(0, 5);

    /*
    ==========================
    RECENT ORDERS
    ==========================
    */

    const recentOrders = await Order.find()

        .sort({

            createdAt: -1

        })

        .limit(5)

        .populate(

            "userId",

            "fullName"

        )

        .populate(

            "warehouseId",

            "name"

        );

    return {

        totalOrders: orders.length,

        totalRevenue,

        placed,

        confirmed,

        packed,

        shipped,

        delivered,

        cancelled,

        recentOrders,

        topProducts

    };

};

/*
==================================
EXPORT SERVICES
==================================
*/

module.exports = {

    getOrdersByUser,

    getOrderById,

    getAllOrders,

    updateOrderStatus,

    getOrderAnalytics

};