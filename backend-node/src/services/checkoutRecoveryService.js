const CheckoutAttempt = require("../models/CheckoutAttempt");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const javaService = require("./javaService");
const { recordRecoveryBatch } = require("./observability");

const DEFAULT_RECOVERY_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_RECOVERY_LEASE_MS = 2 * 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 8;
const DEFAULT_BATCH_SIZE = 25;

const getRecoveryLeaseMs = () => {
    const configured = Number(process.env.CHECKOUT_RECOVERY_LEASE_MS);
    return Number.isFinite(configured) && configured >= 1_000 && configured <= 10 * 60 * 1000
        ? configured
        : DEFAULT_RECOVERY_LEASE_MS;
};

const getRecoveryGraceMs = () => {
    const configured = Number(process.env.CHECKOUT_RECOVERY_GRACE_MS);
    return Number.isFinite(configured) && configured >= 60_000
        ? configured
        : DEFAULT_RECOVERY_GRACE_MS;
};

const logRecovery = (level, event, attempt, details = {}) => {
    const entry = {
        event,
        checkoutId: attempt.checkoutId,
        state: attempt.status,
        ...details
    };
    const writer = console[level] || console.log;
    writer(JSON.stringify(entry));
};

const getOrderForAttempt = async (attempt) => {
    if (attempt.orderId) {
        const order = await Order.findById(attempt.orderId);
        if (order) {
            return order;
        }
    }
    return Order.findOne({
        userId: attempt.userId,
        checkoutId: attempt.checkoutId
    });
};

const getReservationItems = (attempt, order) => {
    const sourceItems = order?.items?.length
        ? order.items
        : attempt.reservationItems;
    if (!Array.isArray(sourceItems)) {
        return null;
    }
    const warehouseId = String(order?.warehouseId || attempt.warehouseId || "");
    if (!warehouseId || (order && sourceItems.length === 0) || sourceItems.some((item) =>
        item.productId == null
        || !String(item.productId).trim()
        || !Number.isInteger(Number(item.quantity))
        || Number(item.quantity) < 1
    )) {
        return null;
    }

    return sourceItems.map((item) => ({
        checkoutId: attempt.checkoutId,
        warehouseId,
        productId: String(item.productId),
        quantity: Number(item.quantity)
    }));
};

const setAttemptState = async (attempt, status, updates = {}) => {
    const result = await CheckoutAttempt.updateOne(
        {
            _id: attempt._id,
            status: "RECOVERING",
            recoveryLeaseUntil: attempt.recoveryLeaseUntil
        },
        {
            $set: {
                status,
                recoveryLeaseUntil: null,
                leaseExpiresAt: new Date(Date.now() + getRecoveryGraceMs()),
                ...updates
            }
        }
    );
    if (result.modifiedCount !== 1) {
        throw Object.assign(new Error("Recovery lease was lost"), {
            code: "RECOVERY_LEASE_LOST"
        });
    }
    Object.assign(attempt, {
        status,
        recoveryLeaseUntil: null,
        leaseExpiresAt: new Date(Date.now() + getRecoveryGraceMs()),
        ...updates
    });
};

const renewRecoveryLease = async (attempt) => {
    const nextLease = new Date(Date.now() + getRecoveryLeaseMs());
    const result = await CheckoutAttempt.updateOne(
        {
            _id: attempt._id,
            status: "RECOVERING",
            recoveryLeaseUntil: attempt.recoveryLeaseUntil
        },
        {
            $set: {
                recoveryLeaseUntil: nextLease,
                lastRecoveryAt: new Date()
            }
        }
    );
    if (result.modifiedCount !== 1) {
        throw Object.assign(new Error("Recovery lease was lost"), {
            code: "RECOVERY_LEASE_LOST"
        });
    }
    attempt.recoveryLeaseUntil = nextLease;
};

const commitReservations = async (attempt, reservations) => {
    for (const reservation of reservations) {
        await renewRecoveryLease(attempt);
        await javaService.commitInventoryReservation(reservation);
    }
    logRecovery("info", "checkout_recovery_reservations_committed", attempt, {
        reservationCount: reservations.length
    });
};

const releaseReservations = async (attempt, reservations) => {
    for (const reservation of reservations) {
        await renewRecoveryLease(attempt);
        await javaService.releaseInventoryReservation(reservation);
    }
    logRecovery("info", "checkout_recovery_reservations_released", attempt, {
        reservationCount: reservations.length
    });
};

const recoverAttempt = async (attempt) => {
    const order = await getOrderForAttempt(attempt);
    if (!order) {
        if (!["NOT_STARTED", "FAILED"].includes(attempt.paymentState)) {
            await setAttemptState(attempt, "MANUAL_REVIEW", {
                lastRecoveryErrorCode: "PAYMENT_STATE_UNRESOLVED"
            });
            logRecovery("error", "checkout_recovery_manual_review", attempt, {
                reasonCode: "PAYMENT_STATE_UNRESOLVED"
            });
            return "manual_review";
        }
        const reservations = getReservationItems(attempt, null);
        if (reservations === null) {
            await setAttemptState(attempt, "MANUAL_REVIEW", {
                lastRecoveryErrorCode: "LEGACY_RESERVATION_LIST_MISSING"
            });
            logRecovery("error", "checkout_recovery_manual_review", attempt, {
                reasonCode: "LEGACY_RESERVATION_LIST_MISSING"
            });
            return "manual_review";
        }

        await releaseReservations(attempt, reservations);
        await setAttemptState(attempt, "CANCELLED", {
            lastRecoveryErrorCode: ""
        });
        logRecovery("info", "checkout_recovery_orphan_cancelled", attempt, {
            reservationCount: reservations.length
        });
        return "cancelled";
    }

    const reservations = getReservationItems(attempt, order);
    if (!reservations) {
        await setAttemptState(attempt, "MANUAL_REVIEW", {
            orderId: order._id,
            lastRecoveryErrorCode: "ORDER_RESERVATION_LIST_MISSING"
        });
        logRecovery("error", "checkout_recovery_manual_review", attempt, {
            orderId: String(order._id),
            reasonCode: "ORDER_RESERVATION_LIST_MISSING"
        });
        return "manual_review";
    }

    const successfulPayment = await Payment.findOne({
        orderId: order._id,
        paymentStatus: { $in: ["Success", "Refunded"] },
        verifiedAt: { $ne: null }
    }).lean();
    const isPaid = order.paymentStatus === "Paid";
    if (isPaid) {
        await commitReservations(attempt, reservations);
        const cancelled = order.status === "Cancelled";
        await setAttemptState(attempt, cancelled ? "MANUAL_REVIEW" : "COMPLETED", {
            orderId: order._id,
            paymentState: "SUCCEEDED",
            lastRecoveryErrorCode: cancelled ? "PAID_ORDER_CANCELLED" : ""
        });
        logRecovery(cancelled ? "error" : "info", "checkout_recovery_paid_order_preserved", attempt, {
            orderId: String(order._id),
            manualReview: cancelled
        });
        return cancelled ? "manual_review" : "completed";
    }

    if (successfulPayment) {
        await commitReservations(attempt, reservations);
        const paymentVerified = Boolean(successfulPayment.verifiedAt);
        if (paymentVerified) {
            await Order.updateOne(
                { _id: order._id, userId: order.userId },
                { $set: { paymentStatus: "Paid" } }
            );
        }
        const cancelled = order.status === "Cancelled";
        await setAttemptState(attempt, "MANUAL_REVIEW", {
            orderId: order._id,
            paymentState: paymentVerified ? "SUCCEEDED" : "UNKNOWN",
            lastRecoveryErrorCode: !paymentVerified
                ? "PAYMENT_ORDER_BINDING_UNVERIFIED"
                : cancelled
                    ? "PAID_ORDER_CANCELLED"
                    : "VERIFIED_PAYMENT_REQUIRES_RECONCILIATION"
        });
        logRecovery(cancelled ? "error" : "warn", "checkout_recovery_verified_payment_reconciled", attempt, {
            orderId: String(order._id),
            reasonCode: !paymentVerified
                ? "PAYMENT_ORDER_BINDING_UNVERIFIED"
                : cancelled
                    ? "PAID_ORDER_CANCELLED"
                    : "VERIFIED_PAYMENT_REQUIRES_RECONCILIATION"
        });
        return "manual_review";
    }

    const isCodCancelled =
        order.paymentMethod === "Cash On Delivery" && order.status === "Cancelled";
    const paymentFailed = order.paymentStatus === "Failed";
    if (
        order.status === "Cancelled"
        && !paymentFailed
        && !isCodCancelled
    ) {
        await setAttemptState(attempt, "MANUAL_REVIEW", {
            orderId: order._id,
            lastRecoveryErrorCode: "CANCELLED_PAYMENT_UNRESOLVED"
        });
        logRecovery("error", "checkout_recovery_manual_review", attempt, {
            orderId: String(order._id),
            reasonCode: "CANCELLED_PAYMENT_UNRESOLVED"
        });
        return "manual_review";
    }
    if (paymentFailed || isCodCancelled) {
        await releaseReservations(attempt, reservations);
        await Order.updateOne(
            { _id: order._id },
            {
                $set: {
                    status: "Cancelled",
                    ...(paymentFailed ? { paymentStatus: "Failed" } : {}),
                    returnedStock: true
                }
            }
        );
        await setAttemptState(attempt, "CANCELLED", {
            orderId: order._id,
            ...(paymentFailed ? { paymentState: "FAILED" } : {}),
            lastRecoveryErrorCode: ""
        });
        logRecovery("info", "checkout_recovery_failed_order_released", attempt, {
            orderId: String(order._id),
            reservationCount: reservations.length
        });
        return "cancelled";
    }

    await commitReservations(attempt, reservations);
    await setAttemptState(
        attempt,
        order.paymentMethod === "Cash On Delivery" ? "COMPLETED" : "WAITING_PAYMENT",
        {
            orderId: order._id,
            ...(order.paymentMethod === "Cash On Delivery"
                ? {}
                : { paymentState: "PENDING" }),
            lastRecoveryErrorCode: ""
        }
    );
    logRecovery("info", "checkout_recovery_order_preserved", attempt, {
        orderId: String(order._id),
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod
    });
    return order.paymentMethod === "Cash On Delivery" ? "completed" : "waiting_payment";
};

const eligibleAttemptQuery = (now, staleBefore) => ({
    $or: [
        {
            status: { $in: ["PROCESSING", "RECOVERY_REQUIRED", "WAITING_PAYMENT"] },
            $or: [
                { leaseExpiresAt: { $lte: now } },
                {
                    leaseExpiresAt: { $exists: false },
                    updatedAt: { $lte: staleBefore }
                }
            ]
        },
        {
            status: "RECOVERING",
            recoveryLeaseUntil: { $lte: now }
        }
    ]
});

const claimAttempt = async (candidate, now, staleBefore) => {
    const claimFilter = {
        _id: candidate._id,
        status: candidate.status
    };
    if (candidate.status === "RECOVERING") {
        claimFilter.recoveryLeaseUntil = { $lte: now };
    } else {
        claimFilter.$or = [
            { leaseExpiresAt: { $lte: now } },
            {
                leaseExpiresAt: { $exists: false },
                updatedAt: { $lte: staleBefore }
            }
        ];
    }

    return CheckoutAttempt.findOneAndUpdate(
        claimFilter,
        {
            $set: {
                status: "RECOVERING",
                recoveryLeaseUntil: new Date(now.getTime() + getRecoveryLeaseMs()),
                lastRecoveryAt: now
            },
            $inc: { recoveryAttempts: 1 }
        },
        { new: true }
    ).lean();
};

const recoverAbandonedCheckouts = async ({
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE
} = {}) => {
    const staleBefore = new Date(now.getTime() - getRecoveryGraceMs());
    const candidates = await CheckoutAttempt.find(
        eligibleAttemptQuery(now, staleBefore)
    )
        .sort({ leaseExpiresAt: 1, updatedAt: 1 })
        .limit(batchSize)
        .lean();

    const results = {
        scanned: candidates.length,
        claimed: 0,
        completed: 0,
        cancelled: 0,
        waitingPayment: 0,
        manualReview: 0,
        failed: 0
    };

    for (const candidate of candidates) {
        const attempt = await claimAttempt(candidate, now, staleBefore);
        if (!attempt) {
            continue;
        }
        results.claimed += 1;

        try {
            const outcome = await recoverAttempt(attempt);
            if (outcome === "completed") results.completed += 1;
            else if (outcome === "cancelled") results.cancelled += 1;
            else if (outcome === "waiting_payment") results.waitingPayment += 1;
            else if (outcome === "manual_review") results.manualReview += 1;
        } catch (error) {
            results.failed += 1;
            const errorCode = String(error.code || error.name || "RECOVERY_ERROR").slice(0, 80);
            const retryDelayMs = Math.min(
                15 * 60 * 1000,
                5_000 * (2 ** Math.min(Math.max(attempt.recoveryAttempts - 1, 0), 8))
            );
            try {
                const exhausted = attempt.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS;
                await setAttemptState(
                    attempt,
                    exhausted ? "MANUAL_REVIEW" : "RECOVERY_REQUIRED",
                    {
                        lastRecoveryErrorCode: errorCode,
                        leaseExpiresAt: exhausted
                            ? new Date(Date.now() + getRecoveryGraceMs())
                            : new Date(Date.now() + retryDelayMs)
                    }
                );
                logRecovery(exhausted ? "error" : "warn", exhausted
                    ? "checkout_recovery_retry_limit_reached"
                    : "checkout_recovery_retry_scheduled", attempt, {
                    errorCode,
                    retryDelayMs: exhausted ? null : retryDelayMs,
                    recoveryAttempts: attempt.recoveryAttempts
                });
            } catch (persistError) {
                logRecovery("error", "checkout_recovery_state_persist_failed", attempt, {
                    errorCode: String(persistError.code || persistError.name || "DATABASE_ERROR").slice(0, 80)
                });
            }
            logRecovery("error", "checkout_recovery_failed", attempt, { errorCode });
        }
    }

    return results;
};

let workerTimer;
let recoveryInProgress = false;
let activeRecoveryRun = Promise.resolve();

const startCheckoutRecoveryWorker = () => {
    if (workerTimer) {
        return workerTimer;
    }

    const configuredInterval = Number(process.env.CHECKOUT_RECOVERY_INTERVAL_MS);
    const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 5_000
        ? configuredInterval
        : 60_000;
    const run = async () => {
        if (recoveryInProgress) {
            return;
        }
        recoveryInProgress = true;
        try {
            const result = await recoverAbandonedCheckouts();
            recordRecoveryBatch(result);
            if (result.claimed > 0) {
                console.info(JSON.stringify({
                    event: "checkout_recovery_batch_completed",
                    ...result
                }));
            }
        } catch (error) {
            console.error(JSON.stringify({
                event: "checkout_recovery_batch_failed",
                errorCode: String(error.code || error.name || "RECOVERY_ERROR").slice(0, 80)
            }));
        } finally {
            recoveryInProgress = false;
        }
    };

    const trackedRun = () => {
        activeRecoveryRun = run();
        return activeRecoveryRun;
    };
    workerTimer = setInterval(trackedRun, intervalMs);
    workerTimer.unref();
    void trackedRun();
    return workerTimer;
};

const stopCheckoutRecoveryWorker = async () => {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
    await activeRecoveryRun;
};

module.exports = {
    recoverAbandonedCheckouts,
    recoverAttempt,
    startCheckoutRecoveryWorker,
    stopCheckoutRecoveryWorker
};
