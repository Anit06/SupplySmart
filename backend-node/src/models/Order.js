const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({

    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
    },

    productName: String,

    category: String,

    image: String,

    sku: String,

    description: String,

    unit: String,

    quantity: Number,

    price: Number,

    subtotal: Number

});

const orderStatusSchema = new mongoose.Schema({

    status: {

        type: String,

        enum: [

            "Placed",

            "Confirmed",

            "Packed",

            "Shipped",

            "Delivered",

            "Cancelled"

        ],

        required: true

    },

    updatedAt: {

        type: Date,

        default: Date.now

    }

},
{

    _id: false

});

const orderSchema = new mongoose.Schema({
    
    orderNumber:{

        type:String,

        required:true,

        unique:true

    },

    shopkeeperName:{

        type:String,

        default:""

    },

    shopkeeperPhone:{

        type:String,

        default:""

    },

    deliveryAddress:{

        type:String,

        default:""

    },

    userId: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        required: true

    },

    checkoutId: {
        type: String,
        default: undefined
    },

    warehouseId: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "Warehouse",

        required: true

    },

    items: [orderItemSchema],

    subtotal: {

        type: Number,

        default: 0

    },

    taxAmount: {
        type: Number,
        default: 0
    },

    discountAmount: {

        type: Number,

        default: 0

    },

    couponCode: {

        type: String,

        default: ""

    },

    finalAmount: {

        type: Number,

        default: 0

    },

    totalAmount: {

        type: Number,

        default: 0

    },

    paymentMethod: {

        type: String,

        default: "Cash On Delivery"

    },

    paymentStatus: {

        type: String,

        enum: ["Pending", "Paid", "Failed"],

        default: "Pending"

    },

    activePaymentAttemptId: {

        type: String,

        default: null

    },

    capturedPaymentId: {

        type: String,

        default: null

    },

    addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ShopkeeperDetails"
    },

    status: {

        type: String,

        enum: [

            "Placed",

            "Confirmed",

            "Packed",

            "Shipped",

            "Delivered",

            "Cancelled"

        ],

        default: "Placed"

    },

    allocatedSupplier: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "Supplier",

        default: null

    },

    assignedWeight: {

        type: Number,

        default: 0

    },

    allocatedAt: {

        type: Date,

        default: null

    },

    statusHistory: {

        type: [orderStatusSchema],

        default: []

    },

    returnedStock: {

        type:Boolean,

        default:false

    }

}, {

    timestamps: true

});

orderSchema.index(
    { userId: 1, checkoutId: 1 },
    {
        unique: true,
        partialFilterExpression: { checkoutId: { $type: "string" } }
    }
);
orderSchema.index({ userId: 1, createdAt: -1 });

/*
==================================
ADD INITIAL STATUS AUTOMATICALLY
==================================
*/

orderSchema.pre("save", async function () {

    if (this.isNew && this.statusHistory.length === 0) {

        this.statusHistory.push({

            status: "Placed",

            updatedAt: new Date()

        });

    }

});

module.exports = mongoose.model("Order", orderSchema);