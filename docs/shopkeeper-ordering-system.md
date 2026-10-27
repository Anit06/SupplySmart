# Shopkeeper Ordering System

## Backend
- Added cart and order data models in backend-node/src/models/Cart.js and backend-node/src/models/Order.js.
- Added cart APIs in backend-node/src/controllers/cartController.js and backend-node/src/routes/cartRoutes.js.
- Added order history APIs in backend-node/src/controllers/orderController.js and backend-node/src/routes/orderRoutes.js.
- Order placement reduces inventory stock and clears the active cart.

## Frontend
- Reworked the shopkeeper product catalog in frontend-react/src/components/shopkeeper/Products/ProductCatalog.jsx.
- Added reusable shopkeeper components for cards, quantity selection, warehouse selection, cart, and checkout.
- Added shopkeeper order history and place-order flows.

## Notes
- The existing architecture and folder structure were preserved.
- Cart and order access are scoped to the logged-in user.

## Inventory consistency
- Checkout now re-reads product details and prices on the Node.js server; client-supplied prices and totals are not used.
- Stock is reserved in the Java inventory service using a single conditional MongoDB update (`stock >= quantity` and decrement in the same operation). The inventory document stores the checkout reservation key, making reservation retries idempotent.
- Multi-product checkout uses compensating releases rather than MongoDB transactions. If order persistence fails, Node.js releases every reservation made for the checkout. If the inventory service is unavailable during release, the checkout attempt is marked `RECOVERY_REQUIRED` and must be reconciled before retrying.
- The frontend persists one checkout ID per warehouse in session storage and reuses it after request failures. The backend also has a unique per-user checkout key on attempts and orders.
- Ensure MongoDB has the unique `{ userId, checkoutId }` indexes declared by `CheckoutAttempt` and `Order` before relying on idempotency in a deployment where automatic index creation is disabled.
- The Java inventory model now declares a unique `{ warehouse, product }` index so there is one stock document per warehouse/product pair. Before rollout, inspect and resolve any existing duplicate pairs, then verify that the index built successfully; no configured database was modified during this work.
- Razorpay payment creation derives INR paise from the persisted order total. Payment attempts are persisted before contacting Razorpay, and an uncertain provider-order creation is not repeated automatically.
- Checkout signatures and provider payment details are verified server-side before an order becomes paid. The payment-failure webhook records the failed attempt but does not release stock: a failed attempt is not proof that an order can never later be paid.
- Razorpay webhooks are verified against the exact raw body and deduplicated by the provider event ID. Captured payments mark checkout attempts successful before inventory finalization; inventory-service failures remain in recovery and never trigger a release.
- Reservation entries are retained in each inventory document to make duplicate reserve/release requests safe. A cleanup/archival policy is needed before this collection is used at high volume.
- MongoDB transactions were not assumed or enabled. The Java service uses the MongoDB URI configured in `application.properties`; the deployment's replica-set/topology and transaction capability were not verified.
- Java inventory endpoints do not currently authenticate internal callers. Keep this service on a private network and do not expose its reservation/release or stock mutation routes publicly; service-to-service authentication remains follow-up work.

## Checkout recovery rules
- Each new checkout persists its planned warehouse/product/quantity reservations before calling Java. Recovery claims stale attempts using an atomic MongoDB state update and a short recovery lease; multiple Node instances therefore cannot process the same attempt at once.
- `CHECKOUT_RECOVERY_GRACE_MS` controls the stale checkout lease and defaults to 900000 ms (15 minutes). `CHECKOUT_RECOVERY_INTERVAL_MS` controls the worker cadence and defaults to 60000 ms; values below 5000 ms are ignored.
- An orderless attempt is released only when its persisted payment state is `NOT_STARTED` or `FAILED`. Missing, pending, successful, or unknown payment state is sent to `MANUAL_REVIEW`, never released automatically.
- A paid order is preserved and its reservation is committed. A non-COD pending order remains reserved in `WAITING_PAYMENT` and is periodically rechecked; elapsed time alone never releases its units. COD cancellation or an explicit server-persisted failed payment is released idempotently.
- A success row in the legacy `Payment` collection is not enough to mark an order paid because the current endpoint does not securely bind provider order, amount, and currency to the application order. Such a case is preserved and moved to `MANUAL_REVIEW` until Phase 2 adds that binding.
- If an old attempt predates the reservation list or payment-state fields, it is marked `MANUAL_REVIEW`; operators must compare the attempt with the matching order and Java inventory reservation records before taking action.
- Every recovery state transition is persisted. Failures retain the attempt as `RECOVERY_REQUIRED`, record only a safe error code, and retry after the grace lease.
- `CheckoutAttempt` has a compound status/lease index for recovery scans in addition to the unique per-user idempotency index.

## Recovery deployment and manual verification
1. Configure `CHECKOUT_RECOVERY_GRACE_MS` to at least the maximum expected checkout request duration and configure `CHECKOUT_RECOVERY_INTERVAL_MS` to an operationally reasonable cadence. Do not lower the grace period to match HTTP client timeouts.
2. Deploy Node and Java together so the Java service supports reservation commit/release and the Node recovery worker is enabled after MongoDB connects.
3. In a dedicated non-production database, terminate a Node process after a reservation succeeds but before order creation; after the grace period, confirm the attempt becomes `CANCELLED` and the Java reservation is `RELEASED`.
4. Terminate a Node process after order creation but before reservation commitment; confirm recovery locates the order by checkout ID, commits each reservation, and does not create a second order.
5. Leave a non-COD payment pending past the grace period; confirm the attempt stays `WAITING_PAYMENT` and inventory is not restored. Send a verified captured payment event and confirm recovery commits the reservation. A `payment.failed` event alone must not release stock.
6. Inspect structured logs by `checkoutId`; logs include state/outcome and safe error codes, not payment credentials or signatures.

## Razorpay sandbox configuration

Set these variables in the Node backend environment only; never put the key secret or webhook secret in a React `REACT_APP_*` variable:

- `RAZORPAY_KEY_ID`: Razorpay Test Mode key ID. The public key ID is returned to the authenticated frontend at payment-order creation.
- `RAZORPAY_KEY_SECRET`: matching Test Mode key secret; used only by the backend for provider API calls and checkout-signature verification.
- `RAZORPAY_WEBHOOK_SECRET`: secret configured for the Razorpay Test Mode webhook endpoint.
- `RAZORPAY_API_TIMEOUT_MS`: provider request timeout in milliseconds; defaults to 10000.
- `PUBLIC_API_BASE_URL`: deployment's public HTTPS Node API base URL, used when registering `PUBLIC_API_BASE_URL/api/payment/webhook` in the Razorpay Dashboard.
- `VITE_API_URL`: Vite frontend API base URL, including `/api`; defaults to `http://localhost:5000/api`.

Copy [backend-node/.env.example](../backend-node/.env.example) to a private environment file and replace the placeholders with Test Mode credentials obtained from the Razorpay Dashboard. Do not commit that private file. Configure the webhook in Test Mode for `payment.captured`, `payment.failed`, and `refund.processed`; use the same webhook secret in the Dashboard and backend. The webhook endpoint must be publicly reachable over HTTPS, and should not be pointed at production payment credentials during testing.

Before deployment, allow MongoDB to create or manually provision the schema indexes for checkout attempts, orders, payments, and webhook event IDs. The payment model adds unique partial indexes for `(orderId, attemptId)`, non-empty `razorpayOrderId`, and non-empty `razorpayPaymentId`; the order model stores the active payment-attempt lock and captured payment ID. Inspect existing data for conflicting values before manually creating indexes if automatic index creation is disabled. Do not delete or rewrite existing payment records as part of deployment.

## Razorpay sandbox verification

1. Start MongoDB, Java inventory, Node backend, and React frontend with isolated development/test databases and the matching sandbox key values. Ensure the required MongoDB unique indexes can be created before accepting test payments.
2. Set `VITE_API_URL` to the Node API and start the frontend. Sign in as a shopkeeper, add stocked products, and proceed through checkout with Razorpay.
3. In Razorpay Checkout, use only test-mode payment methods and complete a sandbox payment. Confirm the browser callback reaches `/api/payment/verify`, the server verifies provider payment details, and the order history shows a paid order.
4. Configure the Test Mode webhook URL and secret. Deliver a captured event and verify it is processed once; redeliver the same event ID and verify the endpoint acknowledges the duplicate without applying a second state transition.
5. Test a failed payment and a delayed captured event. Confirm failed events retain reserved stock, a later captured event makes the payment successful, and no timeout by itself releases stock.
6. Stop the Java inventory service during verified payment finalization. Confirm the payment remains recorded as verified, the checkout attempt moves to `RECOVERY_REQUIRED`, stock is not released, and the recovery worker retries commitment after Java returns.
7. Confirm invalid checkout/webhook signatures are rejected, the browser cannot set the payable amount, another user's order ID is rejected, and backend/frontend logs contain no key secrets, webhook secrets, signatures, or full provider payloads.

The integration records refund events as `Refunded` but does not issue refunds or restore inventory. Refund initiation and inventory handling after refunds require an explicit business policy and are not implemented here.

## MongoDB Phase 3 test and index operations

### Isolated local test database

The MongoDB integration suite is opt-in and uses only `MONGO_TEST_URI`. It rejects authenticated, remote, SRV, and non-`supply_chain_test` URIs; it never falls back to `MONGO_URI` or `MONGODB_URI`. The Compose service is pinned to MongoDB 8.0.12 and binds to `127.0.0.1:27018`, separate from the application's default MongoDB port.

From the repository root in PowerShell:

```powershell
docker compose -f .\docker-compose.mongo-test.yml up -d
docker compose -f .\docker-compose.mongo-test.yml ps
docker compose -f .\docker-compose.mongo-test.yml exec mongo-test mongosh --quiet --eval "db.version()"
Set-Location .\backend-node
$env:MONGO_TEST_URI = "mongodb://127.0.0.1:27018/supply_chain_test"
npm run test:integration
Remove-Item Env:\MONGO_TEST_URI
```

The normal `npm test` command runs the Node unit/service tests and does not connect to MongoDB. `npm run test:integration` skips the live suite when `MONGO_TEST_URI` is unset; when set, an unsafe value causes an error before a connection is attempted. The integration suite creates declared indexes and cleans up only documents whose generated IDs or webhook IDs it recorded. It does not drop a database or collection. Keep the Compose volume dedicated to test data; do not point this URI at a production or shared development instance.

No Docker or local `mongod` executable was available in the implementation environment, so live MongoDB tests and the MongoDB version query could not be executed there. Passing the integration suite is required before treating the concurrency checks below as verified against MongoDB.

### Index inventory and query alignment

The schemas declare unique constraints for inventory `(warehouse, product)`, cart `(userId, warehouseId)`, checkout attempt `(userId, checkoutId)`, order `(userId, checkoutId)` and `orderNumber`, payment `(orderId, attemptId)` and non-empty provider order/payment IDs, webhook `eventId`, user email, product SKU, warehouse code, supplier code, shopkeeper profile `userId`, product price/holding `productId`, and prediction `(warehouseName, productName, targetMonth, targetYear)`. The Java `Inventory` model and Node `Inventory` model share the `inventory` collection and the same named `(warehouse, product)` unique index. The integration suite invokes Mongoose index creation and checks every declared unique index against the test database.

Supporting indexes include checkout recovery scans by `(status, leaseExpiresAt, recoveryLeaseUntil)`, webhook lease scans by `(status, leaseExpiresAt)`, order history by `(userId, createdAt)`, and payment lookup/history by `(orderId, paymentStatus, verifiedAt)` and `(userId, createdAt)`. These correspond to the recovery, event-claim, shopkeeper history, and payment-history query patterns. The integration suite also checks the checkout idempotency query plan for use of its compound index. No index is removed based on assumptions; review production query plans and workload before further index changes.

Index declarations do not prove that a deployment has built the indexes. Deployments with automatic index creation disabled must explicitly create and verify the indexes during a maintenance rollout. First run the duplicate report against the intended database, then inspect `getIndexes()` for each collection after index creation. Build indexes on an appropriately sized replica set/cluster using a deployment-approved maintenance procedure.

### Read-only duplicate report and manual remediation

The duplicate reporter runs aggregation reads only. Point `MONGO_AUDIT_URI` at the specific database to audit; it is deliberately separate from `MONGO_TEST_URI`:

```powershell
Set-Location .\backend-node
$env:MONGO_AUDIT_URI = "<read-only MongoDB URI for the database to inspect>"
npm run mongo:duplicates
Remove-Item Env:\MONGO_AUDIT_URI
```

The URI is not printed. The report lists up to 1,000 duplicate groups per key, with record IDs, and exits with code 2 when duplicates exist. It covers the unique-key groups declared by the application models, including the Java-shared inventory collection. Treat the report as sensitive operational output because it contains database record identifiers. The tool never updates or deletes records.

For any reported duplicate, an operator must:

1. Stop or gate writes that could create more duplicates, and take a verified backup/snapshot.
2. Export the conflicting documents and identify the authoritative record with the business/data owner. Compare references from carts, orders, payments, predictions, and inventory reservations before selecting any canonical record.
3. Prepare a separately reviewed migration that explicitly reconciles references and quantities, preserving an auditable before/after record. Never choose a winner or merge inventory/payment records solely by timestamp.
4. Run the migration first on a restored non-production copy, verify application queries and totals, and obtain approval before a production change.
5. Rerun the read-only report; only then create/verify the unique index. Retain the backup and migration report per the organization's retention policy.

No automatic duplicate repair or production data modification is included.

### Concurrency coverage and boundaries

The live MongoDB suite verifies conditional stock decrement under concurrent requests, repeated reservation/release idempotency, unique checkout/payment/webhook keys, duplicate webhook handling, atomic recovery claims from separate Node processes, crash recovery after a lease expires, a paid checkout interrupted before inventory commitment, and fencing of an expired recovery worker. Recovery worker test processes use a test adapter that performs MongoDB reservation state updates with the same conditional predicates as Java; they do not start or call the Java HTTP service. Java's focused unit tests separately assert its conditional Mongo update query. These checks are not an end-to-end test of Node-to-Java communication, payment-provider event ordering, a multi-process Mongo replica set, or replica-set failover.

`npm test` remains a mocked Node suite. It covers delayed success after failure, payment state handling, and mocked reservation failures; it is distinct from the opt-in Mongo suite. Do not report those mocked cases as real-Mongo or real-Razorpay tests. A real Java-to-Mongo integration environment and provider sandbox credentials are still needed for full cross-service verification.

### Recovery retries, event retention, and archival

Checkout recovery renews its lease before each inventory operation, fences state changes with the lease value, retries with exponential backoff capped at 15 minutes, and moves attempts to `MANUAL_REVIEW` after eight unsuccessful recoveries. Inspect structured `checkout_recovery_retry_scheduled`, `checkout_recovery_retry_limit_reached`, and `checkout_recovery_state_persist_failed` logs and alert on sustained failures/manual-review growth. The webhook event collection claims expired `PROCESSING` records with a fresh processing token and bounded lease; a stale processor cannot mark a newer claim processed.

There is no TTL index on checkout attempts, inventory reservation history, payment records, or webhook events. Do not add TTL deletion to unresolved, pending, or manual-review records. The safe default is to retain these records until an approved legal/accounting retention schedule exists. Before any archival or purge policy is enabled, obtain legal/business approval, archive terminal records with their linked order/payment/reservation identifiers to encrypted storage, verify restore and auditability, and only then consider bounded deletion of archived terminal data. Configure retention based on applicable obligations rather than assuming a generic period.

## Node-to-Java inventory service authentication

Every route under Java `/api/inventory` (including reads, administrative stock mutations, reservations, commit/release, and the warehouse test route) now requires exactly one `X-Internal-Service-Token` header. The Java filter rejects missing, repeated, malformed, or incorrect credentials with HTTP 401 before the controller runs. Java startup fails closed if `INVENTORY_SERVICE_TOKEN` is missing or is not a 32-byte-or-stronger base64url secret. Wildcard browser CORS has been removed from the inventory controller; browsers must call the authenticated Node API, not Java directly.

Configure these server-side variables:

- Node `JAVA_SERVICE_URL`: Java inventory service base URL. Local development may use `http://127.0.0.1:8080`; deployed environments must use `https://` and a private service DNS name. `/api/inventory` is appended if omitted.
- Node `JAVA_SERVICE_TOKEN`: the shared base64url secret.
- Node `JAVA_SERVICE_TIMEOUT_MS`: request timeout in milliseconds; accepted values are 1000-30000, with a 10000 ms default.
- Java `INVENTORY_SERVICE_TOKEN`: the same secret, injected into Spring as `inventory.internal.token`.
- Java `MONGODB_URI`: the inventory database connection string, maintained separately from this service credential.

Generate a fresh local-development credential without writing it to the repository:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url') + '\n')"
```

Set the generated value in the private Node environment and Java process environment; do not put it in React configuration, a committed `.env`, a URL, source code, or logs. The placeholder in `backend-node/.env.example` is intentionally unusable until replaced.

Local setup:

1. Configure `JAVA_SERVICE_URL=http://127.0.0.1:8080` and set `JAVA_SERVICE_TOKEN` for Node.
2. Set `INVENTORY_SERVICE_TOKEN` to that exact same value for the Java process, along with its required `MONGODB_URI`.
3. Start Java on port 8080 and Node using its normal development command. Confirm authenticated catalog and checkout operations work; direct browser requests to Java without the header should receive 401.
4. Do not use the development HTTP exception for a non-loopback host.

Production deployment requirements:

- Put Java and Node on a private service network. Firewall/security-group rules must allow Java inventory ingress only from Node service instances and administrative paths explicitly approved by operators; do not publish Java's port to the public internet or expose it through a browser-facing load balancer.
- Configure Node with an HTTPS Java URL and valid internal TLS certificates. Terminate TLS only at a trusted private ingress/proxy; protect the backend hop as well, and do not rely on the shared token over public plaintext HTTP. Restrict and monitor the ingress source addresses independently of application authentication.
- Store both copies of the token in the deployment secret manager, never in images or build arguments. The filter and Node client do not log token values.
- Rotate with a coordinated maintenance window: generate a new token, stop or drain Node inventory traffic, update the secret in both services, restart/redeploy both, verify an authenticated read and a rejected unauthenticated request, then resume traffic. The implementation accepts one active token at a time; coordinate rotation to avoid a mixed-secret outage.

Node inventory calls have a bounded timeout. Only reads and the Java reservation, commit, and release operations are retried, at most once, after network failures/timeouts or 5xx responses. Reservation calls reuse the same checkout key and quantity; commit and release are idempotent in Java. Other inventory mutations are not automatically retried. HTTP 401/other 4xx responses are not retried. This preserves the existing atomic stock decrement and checkout recovery semantics while surfacing service errors to callers.
