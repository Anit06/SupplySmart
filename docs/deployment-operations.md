# Deployment and operations

This guide describes two distinct local workflows and the controls that still
need to be supplied by a production platform. Neither local workflow is a
production deployment.

## Local development with separate terminals

This workflow uses `backend-node\.env` for Node's MongoDB URI and non-secret
settings. It does not use the root Compose `.env`. Never overwrite an existing
file. If it is absent, create the ignored file from its placeholder-only
example, then configure `MONGO_URI` to your local development database:

```powershell
if (-not (Test-Path .\backend-node\.env)) {
    Copy-Item .\backend-node\.env.example .\backend-node\.env
}
```

Node reads `MONGO_URI`; Java's local launcher uses the same process variable
when present, otherwise reads it from `backend-node\.env`, and passes the value
as `MONGODB_URI`. Both therefore connect to the same configured database when
the same `MONGO_URI` is supplied to each process.

In the **Node terminal**, generate a different internal-service token and JWT
secret. The service token is copied to the clipboard for the Java terminal;
neither secret is printed:

```powershell
$serviceBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($serviceBytes) } finally { $rng.Dispose() }
$serviceToken = [Convert]::ToBase64String($serviceBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$env:JAVA_SERVICE_TOKEN = $serviceToken
Set-Clipboard -Value $serviceToken
$jwtBytes = New-Object byte[] 48
$jwtRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $jwtRng.GetBytes($jwtBytes) } finally { $jwtRng.Dispose() }
$env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes)
$serviceBytes = $null
$jwtBytes = $null
$serviceToken = $null
Set-Location .\backend-node
$env:JAVA_SERVICE_URL = "http://127.0.0.1:8080"
$env:PORT = "5000"
npm start
```

Run the Java service in a separate **Java terminal**:

```powershell
$env:JAVA_SERVICE_TOKEN = Get-Clipboard
Set-Location .\java-inventory-service
.\scripts\start-local.ps1
```

The launcher validates the unpadded Base64URL token and its decoded length,
maps that same `JAVA_SERVICE_TOKEN` to Java's `INVENTORY_SERVICE_TOKEN` in the
Maven process environment, reads `MONGO_URI` from `backend-node\.env` without
displaying it, and sets `MONGODB_URI`. Keep any process-level `MONGO_URI`
override identical between Node and Java. Keep the Java and Node terminals'
service-token values identical; the launcher fails before Maven if the token
is missing or invalid. Generate a new token rather than weakening validation.

Run Python in a third terminal, after installing `python-ai-service` requirements
in your local virtual environment:

```powershell
Set-Location .\python-ai-service
python app.py
```

Run React in a fourth terminal:

```powershell
Set-Location .\frontend-react
npm run dev
```

Vite forwards `/api` to Node at port 5000. `JAVA_SERVICE_URL` is the service
base URL, e.g. `http://127.0.0.1:8080`; Node appends `/api/inventory` and the
operation path exactly once. Java readiness is protected by the internal
service filter and requires the matching token header. A login with `JWT_SECRET`
set proceeds to normal database credential validation; successful login also
requires a real user in the development database.

## Local Docker Compose

Compose is a distinct workflow. Docker Compose does **not** load
`.env.compose.example` automatically. Copy it to the root `.env` only if that
file does not already exist:

```powershell
if (-not (Test-Path .\.env)) {
    Copy-Item .\.env.compose.example .\.env
} else {
    throw "Root .env already exists; preserve it and configure it manually."
}
```

Replace placeholders in the ignored root `.env` with unique local-only values.
Its `JAVA_SERVICE_TOKEN` is passed to Node and Java (as
`INVENTORY_SERVICE_TOKEN`); `JWT_SECRET` must be a different secret. Compose
configures both database URIs to the `supply_chain` database. This root file is
separate from `backend-node\.env`.

Docker publishes only the React/Nginx entry point, bound to `127.0.0.1`;
MongoDB, Node, Java, and Python ports are not published to the host. Validate
and start the stack:

```powershell
docker compose config
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:8088/health/live
Invoke-RestMethod http://127.0.0.1:8088/health/ready
docker compose logs --tail 100 backend-node java-inventory python-ai
```

To generate a Compose internal token without printing it, copy it to the
clipboard and paste it into `JAVA_SERVICE_TOKEN` in the ignored root `.env`:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
Set-Clipboard -Value $token
$token = $null
$bytes = $null
$rng.Dispose()
```

For production, use a platform secret manager. Do not copy real credentials into
examples or reuse production credentials locally.

## Local service safety

The MongoDB data volume is persistent. The one-shot `mongo-indexes` job applies
the indexes declared by the Node models before the application services start.
It is not a general-purpose schema migration framework. The Compose bridge uses
HTTP for internal calls; the Node service client rejects non-loopback HTTP in
deployed configurations, so this local stack must not be exposed as a production
network.

The root MongoDB account is initialized only when the data directory is first
created. Existing volumes from an earlier unauthenticated Compose setup will not
be converted automatically. Do not delete a volume to enable authentication;
back it up and plan a controlled local migration or start a separately named,
disposable test project/volume.

Compose sets `NODE_ENV=development` and explicitly opts into plain HTTP to the
Java container on the isolated Compose bridge so the local stack can run without
certificates. This exception is rejected when `NODE_ENV=production`; do not copy
`JAVA_SERVICE_ALLOW_PRIVATE_HTTP=true` into production. Production must use
HTTPS or a separately reviewed private-network transport design.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` | Compose | Local MongoDB root account; use a separate database application user in production. |
| `MONGO_URI` | Node | MongoDB URI for the Node API and recovery worker. |
| `MONGODB_URI` | Java | MongoDB URI for inventory reservation storage. |
| `MONGO_MAX_POOL_SIZE` | Node | Maximum MongoDB connection-pool size per Node process; defaults to 20. |
| `JWT_SECRET` | Node | Server-only JWT signing and verification secret. The service fails closed if missing. Rotating it invalidates currently issued tokens. |
| `JAVA_SERVICE_URL`, `JAVA_SERVICE_TOKEN`, `JAVA_SERVICE_TIMEOUT_MS` | Node | Internal inventory-service URL, shared credential, and bounded request timeout. Never use a frontend `VITE_*` or `REACT_APP_*` variable for the token. |
| `JAVA_SERVICE_ALLOW_PRIVATE_HTTP` | Node | Local Compose-only explicit opt-in; accepted only outside `NODE_ENV=production`. |
| `INVENTORY_SERVICE_TOKEN` | Java | Set by the local launcher from the same `JAVA_SERVICE_TOKEN`; must decode from unpadded Base64URL to at least 32 bytes. |
| `PYTHON_SERVICE_URL`, `PYTHON_SERVICE_TIMEOUT_MS` | Node | Internal AI endpoint and request timeout. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Node | Razorpay server-side API credentials. Use only Test Mode values outside production. |
| `RAZORPAY_WEBHOOK_SECRET` | Node | Secret used to verify the webhook raw-body signature. |
| `RAZORPAY_API_TIMEOUT_MS` | Node | Bounded provider request timeout. |
| `PUBLIC_API_BASE_URL` | Operator/provider dashboard | Reference URL for configuring the Razorpay webhook endpoint; the Node API does not consume it. Configure an HTTPS endpoint. |
| `CORS_ORIGINS` | Node | Comma-separated browser origins. Same-origin requests through the included proxy do not need a separate origin. |
| `CHECKOUT_RECOVERY_INTERVAL_MS`, `CHECKOUT_RECOVERY_LEASE_MS`, `CHECKOUT_RECOVERY_GRACE_MS` | Node | Recovery scan interval and persistent recovery lease/grace behavior. |
| `PORT` | Node | API listener port; defaults to 5000. |
| `APP_HTTP_PORT` | Compose | Host loopback port for the web proxy; defaults to 8088. |
| `LT_USER_PREFIX`, `LT_USER_DOMAIN`, `LT_USER_PASSWORD`, `LT_WAREHOUSE_ID`, `LT_PRODUCT_ID`, `LT_QUANTITY` | k6 only | Synthetic load-test fixture values. Use a dedicated test database and accounts. |

The React bundle uses same-origin `/api` requests by default. Never put a server
secret in a Vite build argument or frontend environment variable.

## Health, logs, and metrics

- Node `/health/live` is a process liveness check. `/health/ready` returns
  unavailable until MongoDB is connected; it deliberately does not depend on
  Java or Python so an optional downstream outage does not create cascading
  restarts.
- Java `/health/live` is process liveness; `/health/ready` checks MongoDB.
- Python `/health/live` is process liveness; `/health/ready` requires the model
  to be loaded.
- Node `/metrics` exposes Prometheus-format request counters, latency buckets,
  Mongo connection failures, inventory failures, payment verification failures,
  recovery failures, backlog, and manual-review counts. The included Nginx proxy
  blocks this path; expose it only through a private monitoring network.
- HTTP completion logs are JSON and contain request ID, method, status, and
  duration only. Do not add authorization headers, JWTs, MongoDB URIs, provider
  signatures, or full payment payloads to logs.
- Node metrics are process-local and reset on restart. Scrape every replica or
  replace them with a shared metrics backend before using them for fleet-wide
  alerting. Java and Python application metrics are not implemented here.

Initial alert candidates (tune against measured baseline and business SLOs):

| Signal | Candidate alert |
| --- | --- |
| HTTP errors | 5xx rate above 1% for 5 minutes. |
| API latency | p95 above 1 second or p99 above 2 seconds for 5 minutes. |
| MongoDB | Any sustained readiness failure or connection-failure increase. |
| Inventory/payment | Any sustained failure increase; investigate before retrying unsafe operations. |
| Checkout recovery | Any persistent manual-review increase, or nonzero backlog that grows over 10 minutes. |

These metrics do not currently implement alerts. Retain structured logs and
metrics in the production logging/monitoring platform according to the
organization's incident, privacy, and payment-data retention policies. Set
access controls and retention limits there; do not treat container-local logs
as durable storage.

## Razorpay order reconciliation

For `PAYMENT_ORDER_UNRESOLVED`, retry only with the same application order and
`attemptId`. The backend looks up Razorpay orders by the attempt's receipt and
binds a result only when exactly one order has `created` status and matches the
receipt, INR amount, and application-order/payment-attempt notes. It does not
open checkout for an already-paid provider order or create another provider
order when a request timed out or the lookup is empty or ambiguous.

An empty lookup does not prove that Razorpay never created an order. Keep the
order, payment attempt, and inventory reservation intact. Support should check
the Razorpay Dashboard account and mode configured for the service, using the
receipt, amount, application order ID, and attempt ID from the payment log. If
one matching order is visible, retry the same attempt so the backend can save
and return its real Razorpay order ID. If there is no unique match, escalate
for provider-side reconciliation; do not mark the payment failed, clear the
attempt lock, cancel the order, release inventory, or create a new attempt
based only on a timeout or an empty list response.

The payment logs include the request ID, application order ID, checkout ID,
payment ID, attempt ID, provider order ID when known, and sanitized provider
error code. Use the request ID as the support reference. Never include API
secrets, authorization data, or full provider payloads in logs. Configure
`RAZORPAY_WEBHOOK_SECRET` as well as the API credentials; without it, webhook
signatures cannot be verified.

If an authorized operator has conclusively checked the matching Razorpay
Dashboard account and mode and confirmed that no order exists, an administrator
may resolve the `UNKNOWN` attempt through
`POST /api/payment/admin/reconcile-attempt` with
`{ "orderId": "...", "attemptId": "...", "providerOutcome": "NO_ORDER_CONFIRMED", "evidenceReference": "..." }`.
The evidence reference must identify the Dashboard investigation. The operation
is conditional on the payment still being `Pending`/`UNKNOWN`, having no
provider order ID, and still owning the order's active attempt lock. It records
the admin and evidence reference, marks only that attempt failed, and releases
the payment-attempt lock so a new attempt can be started. It does not mark the
order paid/failed, cancel the order, or change inventory reservations. This
endpoint is an audited operator attestation, not an automated proof of
nonexistence; do not call it before Dashboard verification.

## Deployment, scaling, and security boundaries

For a production deployment:

1. Publish only a TLS-terminating ingress/reverse proxy. Restrict MongoDB,
   Java, and Python to private service networks. Do not make Java inventory or
   reservation routes internet-accessible.
2. Configure Node-to-Java with HTTPS or a private network protected by
   platform network policy and transport security. The shared token authenticates
   requests; it does not encrypt traffic.
3. Supply unique credentials from a secret manager. Current Node/Java shared
   token configuration accepts one active value, so rotate it in a coordinated
   maintenance window: provision the new secret, update both services, restart
   them, verify authenticated reservation operations, and revoke the old value.
   JWT secret rotation also invalidates existing sessions. Rotate Razorpay
   webhook credentials in the provider dashboard and service configuration as
   a coordinated operation.
4. Use a dedicated least-privilege MongoDB user for each service, TLS for
   database connections, network allow-lists, encrypted backups, and a tested
   restore process. The local Compose stack uses one root credential for
   simplicity and is not an example of production privilege separation.
5. Configure an upstream rate limiter for login, checkout, and other
   abuse-sensitive public endpoints, with suitable exceptions/limits for
   verified Razorpay webhooks. No global API rate limiter is configured in this
   repository.
6. Configure resource requests/limits, TLS certificate renewal, firewall rules,
   and external alert delivery in the deployment platform. Compose alone does
   not provide production TLS, centralized observability, or secret management.

Application state relevant to checkout and recovery is stored in MongoDB.
Multiple Node replicas may run recovery scans; MongoDB lease claims coordinate
the workers, and webhook/checkout idempotency is persisted. The Node Mongo pool
defaults to 20 per replica, so budget total connections as replica count times
pool size plus Java and operational clients. Recovery, Java, and Python should
not be autoscaled until database connection limits, model memory use, and
reservation latency have been measured.

For a local multi-Node smoke test, with synthetic data only:

```powershell
docker compose up --build -d --scale backend-node=2 backend-node web
docker compose ps
```

The included Nginx proxy resolves the Node service name dynamically. The
`uploads-data` volume is shared by Compose replicas. In production, store uploads
in shared object storage rather than node-local disk. Scrape `/metrics` on every
replica; the in-memory counters are not aggregated. Recovery workers coordinate
using database leases; do not substitute process-local locks or run an
independent destructive migration in each replica.

## Backup, restore, index changes, and rollback

Back up the application database before a production index or schema change.
For the local Compose database, an archive can be created and copied to the host:

```powershell
docker compose exec mongo mongodump --username supplychain_local --password "<local-password>" --authenticationDatabase admin --db supply_chain --archive=/tmp/supply-chain.archive
docker compose cp mongo:/tmp/supply-chain.archive .\supply-chain.archive
```

Store the archive in encrypted, access-controlled backup storage; the example
file is sensitive business data and must not be committed. Test a restore into
a separate database before changing any application connection string:

```powershell
docker compose cp .\supply-chain.archive mongo:/tmp/supply-chain.archive
docker compose exec mongo mongorestore --username supplychain_local --password "<local-password>" --authenticationDatabase admin --archive=/tmp/supply-chain.archive --nsFrom="supply_chain.*" --nsTo="supply_chain_restore.*"
```

The restore example writes a separate database and does not drop or overwrite
records. Do not add `--drop` or point a test restore at a production URI. For a
production restore, follow the database provider's recovery procedure, validate
the restored database, and only then perform a controlled application cutover.

Before adding a unique index, run the repository's read-only duplicate report,
review the output with data owners, and follow the documented manual remediation
plan. Never auto-delete or merge production records. Test new indexes and query
plans against a dedicated database. Deploy backward-compatible application
changes first; apply indexes as a controlled one-shot migration; verify query
plans and application health; then remove obsolete fields or indexes in a
separate release after rollback is no longer required. A rollback must use a
compatible application version and a validated backup; do not rely on automatic
data downgrades.

## Dependency advisory handling

The backend pins ExcelJS's transitive `uuid` dependency to patched 11.1.1 with a
scoped npm override. ExcelJS 4.4.0 is the available release and uses the
CommonJS `uuid.v4()` API; `tests/exceljsUuidCompatibility.test.js` covers that
call path. Verify the override with `npm test` and
`npm audit --omit=dev` before changing it. Do not use `npm audit fix --force`
here: npm proposes a breaking ExcelJS downgrade.

## Load testing

The opt-in k6 scenario is intended only for an isolated database, synthetic
users, synthetic inventory, and Razorpay Test Mode configuration. Do not point it
at production. Prepare users and warehouse/product fixtures before running it;
the script does not provision test data. `LT_USER_PREFIX`, `LT_USER_DOMAIN`,
`LT_USER_PASSWORD`, `LT_WAREHOUSE_ID`, and `LT_PRODUCT_ID` must refer only to
that fixture. Leave real payment credentials unset. The duplicate-webhook
scenario signs a no-op test event; it does not charge or capture a payment.

Provisional acceptance thresholds in `tests/load/k6.js` are error rate below
1%, p95 below 1 second, and p99 below 2 seconds. These are test gates, not
measured results or production SLOs. Run:

```powershell
docker compose --profile loadtest run --rm k6
```

Record k6 output, per-container CPU/memory, MongoDB connections/operations,
inventory invariants, order counts per idempotency key, payment state, recovery
backlog, and manual-review count. The recovery scenario only observes health and
metrics while an operator stages an interrupted test checkout and Java outage;
it does not itself create a stale checkout or stop Java. Run that scenario only
with a rehearsed, isolated fixture and verify recovery state directly afterward.

## Validation status and outstanding checks

The checked-in k6 scenarios and Compose configuration have not been executed
here because Docker and k6 are unavailable in the current environment. A live
MongoDB integration run, actual Node-to-Java deployment HTTP check, resource
measurements, outage/recovery load test, and Razorpay sandbox transaction also
remain unperformed. Use the commands above only after confirming the database
and provider credentials are dedicated test resources.
