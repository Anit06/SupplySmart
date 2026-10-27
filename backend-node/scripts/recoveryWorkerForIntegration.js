const mongoose = require("mongoose");
const { getSafeMongoTestUri } = require("../src/config/testMongoUri");
const javaService = require("../src/services/javaService");
const Inventory = require("../src/models/Inventory");
const { recoverAbandonedCheckouts } = require("../src/services/checkoutRecoveryService");

const main = async () => {
    const uri = getSafeMongoTestUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

    const delayMs = Math.max(0, Number(process.env.RECOVERY_COMMIT_DELAY_MS) || 0);
    javaService.commitInventoryReservation = async (reservation) => {
        if (process.env.RECOVERY_CRASH_AFTER_CLAIM === "1") {
            process.exit(86);
        }
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const result = await Inventory.collection.updateOne(
            {
                warehouse: new mongoose.Types.ObjectId(reservation.warehouseId),
                product: new mongoose.Types.ObjectId(reservation.productId),
                reservations: {
                    $elemMatch: {
                        checkoutId: reservation.checkoutId,
                        quantity: reservation.quantity,
                        status: "RESERVED"
                    }
                }
            },
            { $set: { "reservations.$.status": "COMMITTED" } }
        );
        if (result.matchedCount === 0) {
            const current = await Inventory.collection.findOne({
                warehouse: new mongoose.Types.ObjectId(reservation.warehouseId),
                product: new mongoose.Types.ObjectId(reservation.productId),
                reservations: {
                    $elemMatch: {
                        checkoutId: reservation.checkoutId,
                        quantity: reservation.quantity,
                        status: "COMMITTED"
                    }
                }
            });
            if (!current) {
                throw Object.assign(new Error("Mongo inventory reservation was not committed"), {
                    code: "INVENTORY_RESERVATION_NOT_COMMITTED"
                });
            }
        }
    };
    javaService.releaseInventoryReservation = async (reservation) => {
        const result = await Inventory.collection.updateOne(
            {
                warehouse: new mongoose.Types.ObjectId(reservation.warehouseId),
                product: new mongoose.Types.ObjectId(reservation.productId),
                reservations: {
                    $elemMatch: {
                        checkoutId: reservation.checkoutId,
                        quantity: reservation.quantity,
                        status: { $in: ["RESERVED", "COMMITTED"] }
                    }
                }
            },
            {
                $inc: { stock: reservation.quantity },
                $set: { "reservations.$.status": "RELEASED" }
            }
        );
        if (result.matchedCount === 0) {
            const current = await Inventory.collection.findOne({
                warehouse: new mongoose.Types.ObjectId(reservation.warehouseId),
                product: new mongoose.Types.ObjectId(reservation.productId),
                reservations: {
                    $elemMatch: {
                        checkoutId: reservation.checkoutId,
                        quantity: reservation.quantity,
                        status: "RELEASED"
                    }
                }
            });
            if (!current) {
                throw Object.assign(new Error("Mongo inventory reservation was not released"), {
                    code: "INVENTORY_RESERVATION_NOT_RELEASED"
                });
            }
        }
    };

    const result = await recoverAbandonedCheckouts({ batchSize: 1 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error(JSON.stringify({
        event: "integration_recovery_worker_failed",
        errorCode: String(error.code || error.name || "WORKER_ERROR").slice(0, 80)
    }));
    await mongoose.disconnect();
    process.exitCode = 1;
});
