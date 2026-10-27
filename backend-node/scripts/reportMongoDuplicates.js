const mongoose = require("mongoose");

const duplicateChecks = [
    ["inventory", ["warehouse", "product"]],
    ["carts", ["userId", "warehouseId"]],
    ["checkoutattempts", ["userId", "checkoutId"]],
    ["orders", ["userId", "checkoutId"]],
    ["orders", ["orderNumber"]],
    ["payments", ["orderId", "attemptId"], { attemptId: { $type: "string" } }],
    ["payments", ["razorpayOrderId"], { razorpayOrderId: { $type: "string", $gt: "" } }],
    ["payments", ["razorpayPaymentId"], { razorpayPaymentId: { $type: "string", $gt: "" } }],
    ["paymentwebhookevents", ["eventId"]],
    ["predictions", ["warehouseName", "productName", "targetMonth", "targetYear"]],
    ["users", ["email"]],
    ["products", ["sku"]],
    ["warehouses", ["code"]],
    ["suppliers", ["supplierCode"]],
    ["shopkeeperdetails", ["userId"]],
    ["productprices", ["productId"]],
    ["productholdings", ["productId"]]
];

const getAuditUri = () => {
    const uri = process.env.MONGO_AUDIT_URI;
    if (!uri) {
        throw new Error("Set MONGO_AUDIT_URI to the MongoDB database to inspect");
    }
    const parsed = new URL(uri);
    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) {
        throw new Error("MONGO_AUDIT_URI must use the MongoDB URI scheme");
    }
    if (parsed.pathname.replace(/^\/+/, "") === "") {
        throw new Error("MONGO_AUDIT_URI must name one database");
    }
    return uri;
};

const findDuplicates = async (database, collectionName, fields, match = {}) => {
    const key = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
    return database.collection(collectionName).aggregate([
        { $match: match },
        { $group: { _id: key, documentIds: { $push: "$_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $project: { _id: 1, count: 1, documentIds: 1 } },
        { $limit: 1000 }
    ]).toArray();
};

const main = async () => {
    await mongoose.connect(getAuditUri(), { serverSelectionTimeoutMS: 10_000 });
    const database = mongoose.connection.db;
    const report = {
        database: database.databaseName,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        duplicateGroups: []
    };

    for (const [collectionName, fields, match] of duplicateChecks) {
        const duplicates = await findDuplicates(database, collectionName, fields, match);
        if (duplicates.length) {
            report.duplicateGroups.push({
                collection: collectionName,
                fields,
                groups: duplicates
            });
        }
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    await mongoose.disconnect();
    if (report.duplicateGroups.length) {
        process.exitCode = 2;
    }
};

main().catch(async (error) => {
    console.error(JSON.stringify({
        event: "mongo_duplicate_report_failed",
        errorCode: String(error.code || error.name || "MONGO_AUDIT_ERROR").slice(0, 80)
    }));
    await mongoose.disconnect();
    process.exitCode = 1;
});
