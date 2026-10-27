const { randomUUID } = require("crypto");

const requestCounts = new Map();
const latencyBuckets = [0.01, 0.05, 0.1, 0.3, 1, 3, 10];
const latencyCounts = latencyBuckets.map(() => 0);
let requestTotal = 0;
let latencySum = 0;
let inventoryFailures = 0;
let paymentVerificationFailures = 0;
let recoveryFailed = 0;
let recoveryManualReview = 0;
let recoveryBacklog = 0;
let databaseFailures = 0;

const requestObservability = (req, res, next) => {
    const suppliedId = req.get("x-request-id");
    const requestId = suppliedId && /^[A-Za-z0-9._-]{1,100}$/.test(suppliedId)
        ? suppliedId
        : randomUUID();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.once("finish", () => {
        const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const method = req.method.replace(/[^A-Z]/g, "").slice(0, 12) || "UNKNOWN";
        const status = res.statusCode;
        const key = `${method}:${status}`;
        requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
        requestTotal += 1;
        latencySum += elapsedSeconds;
        latencyBuckets.forEach((bucket, index) => {
            if (elapsedSeconds <= bucket) {
                for (let cumulativeIndex = index; cumulativeIndex < latencyCounts.length; cumulativeIndex += 1) {
                    latencyCounts[cumulativeIndex] += 1;
                }
            }
        });
        console.info(JSON.stringify({
            event: "http_request_completed",
            requestId,
            method,
            statusCode: status,
            durationMs: Math.round(elapsedSeconds * 1000)
        }));
    });
    next();
};

const renderMetrics = () => {
    const lines = [
        "# HELP http_requests_total Completed HTTP requests by method and status.",
        "# TYPE http_requests_total counter"
    ];
    for (const [key, count] of requestCounts) {
        const [method, status] = key.split(":");
        lines.push(`http_requests_total{method="${method}",status="${status}"} ${count}`);
    }
    lines.push(
        "# HELP http_request_duration_seconds Request duration histogram.",
        "# TYPE http_request_duration_seconds histogram"
    );
    latencyBuckets.forEach((bucket, index) => {
        lines.push(`http_request_duration_seconds_bucket{le="${bucket}"} ${latencyCounts[index]}`);
    });
    lines.push(`http_request_duration_seconds_bucket{le="+Inf"} ${requestTotal}`);
    lines.push(`http_request_duration_seconds_sum ${latencySum}`);
    lines.push(`http_request_duration_seconds_count ${requestTotal}`);
    lines.push("# TYPE mongo_connection_failures_total counter");
    lines.push(`mongo_connection_failures_total ${databaseFailures}`);
    lines.push("# TYPE inventory_service_failures_total counter");
    lines.push(`inventory_service_failures_total ${inventoryFailures}`);
    lines.push("# TYPE payment_verification_failures_total counter");
    lines.push(`payment_verification_failures_total ${paymentVerificationFailures}`);
    lines.push("# TYPE checkout_recovery_failures_total counter");
    lines.push(`checkout_recovery_failures_total ${recoveryFailed}`);
    lines.push("# TYPE checkout_recovery_manual_review_total counter");
    lines.push(`checkout_recovery_manual_review_total ${recoveryManualReview}`);
    lines.push("# TYPE checkout_recovery_backlog gauge");
    lines.push(`checkout_recovery_backlog ${recoveryBacklog}`);
    return `${lines.join("\n")}\n`;
};

module.exports = {
    requestObservability,
    renderMetrics,
    recordDatabaseFailure: () => { databaseFailures += 1; },
    recordInventoryFailure: () => { inventoryFailures += 1; },
    recordPaymentVerificationFailure: () => { paymentVerificationFailures += 1; },
    recordRecoveryBatch: (result) => {
        recoveryFailed += Number(result.failed || 0);
        recoveryManualReview += Number(result.manualReview || 0);
        recoveryBacklog = Math.max(
            0,
            Number(result.scanned || 0)
            - Number(result.completed || 0)
            - Number(result.cancelled || 0)
            - Number(result.manualReview || 0)
        );
    }
};
