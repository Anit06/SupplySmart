const mongoose = require("mongoose");

const models = [
    require("../src/models/Cart"),
    require("../src/models/CheckoutAttempt"),
    require("../src/models/DemandHistory"),
    require("../src/models/Inventory"),
    require("../src/models/Order"),
    require("../src/models/Payment"),
    require("../src/models/PaymentWebhookEvent"),
    require("../src/models/Prediction"),
    require("../src/models/Product"),
    require("../src/models/ProductHolding"),
    require("../src/models/ProductPrice"),
    require("../src/models/ShopkeeperDetails"),
    require("../src/models/Supplier"),
    require("../src/models/User"),
    require("../src/models/Warehouse")
];

const main = async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error("MONGO_URI is required for index provisioning");
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    for (const model of models) {
        await model.createIndexes();
        console.info(JSON.stringify({
            event: "mongo_indexes_provisioned",
            collection: model.collection.collectionName
        }));
    }
    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error(JSON.stringify({
        event: "mongo_index_provisioning_failed",
        errorCode: String(error.code || error.name || "INDEX_PROVISIONING_ERROR").slice(0, 80)
    }));
    await mongoose.disconnect();
    process.exitCode = 1;
});
