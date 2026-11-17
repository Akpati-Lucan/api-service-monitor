# Build plan: modular monitor, MCP, and service catalog

This is the implementation plan for turning the current API monitor into a modular product. An agent, a REST client, a status page, and a later phone view all read the same checks and incidents. A new database, queue, or Kubernetes watch is a probe module. It is not a new application.

Build in the phase order in section 18. Later phases assume the contracts in sections 4 through 8 already exist. Do not start Oracle, Kafka, or a phone client before phase 1 is done.

Rankings used while choosing the first engines:

- Databases: DB-Engines overall ranking, October 2026. Top five are Oracle, MySQL, Microsoft SQL Server, PostgreSQL, MongoDB. SQLite is 11th and is already this app’s own store.
- Key-value: DB-Engines key-value ranking, July 2026 (the latest category table retrieved). Top five are Redis, Amazon DynamoDB, Azure Cosmos DB, Memcached, etcd.
- Enterprise search: Stack Overflow Developer Survey 2026, technologies used for work. Elasticsearch 36.7%, Microsoft Search 22.3%, OpenSearch 17.4%, Google Cloud Search 16.5%, Azure AI Search 11.5%.
- Brokers and object storage are an integration set, not a scored ranking. They are included because each has a read-only health signal.

## 1. What already exists

Use these files. Do not rewrite them without a reason tied to a contract below.

| Piece | Where | State |
|---|---|---|
| HTTP server, security headers, JSON errors | `src/app.ts`, `src/utils/errors.ts` | Working. Error codes today: `NOT_FOUND`, `VALIDATION_ERROR`, `DATABASE_ERROR`, `INTERNAL_ERROR`. |
| Config | `src/config.ts`, `.env.example` | Working. Zod-parsed env. |
| SQLite store | `src/db/database.ts`, `src/db/migrations.ts` | Working for services, health checks, and incidents. Schema SQL is duplicated in both files. There is no migration version. |
| HTTP probe | `src/services/checker.ts` | Working for one GET. Timeout uses `AbortController`. HTTP errors become a `CheckResult` and are not thrown. |
| Retry | `src/utils/retry.ts` | Working only when the operation throws. It is not called by the checker. A failed HTTP check therefore never retries. |
| Alert seam | `src/services/alert.ts` | `AlertSink` plus `LoggingAlertSink` only. |
| Scheduler | `src/services/monitor.ts` | Stub. `registerService` stores a timer that does nothing. Nothing calls `registerService` from the routes. |
| Service routes | `src/routes/services.ts` | Create, list, get, soft-delete, list incidents, and a metrics placeholder. `GET /services` always returns `status: "UP"`. Metrics always return `uptimePercent: 100` and ignore the real window. |
| Process health | `src/routes/health.ts` | Pings SQLite and returns 200 or 503. `monitor` is hardcoded to `"running"`. `activeServices` counts rows, not scheduled jobs. |
| Boot and shutdown | `src/server.ts` | Opens SQLite, starts the stub monitor, listens, and on `SIGINT` or `SIGTERM` closes the HTTP server, stops the monitor, and closes the database. The force-exit timer is 5 seconds. In-flight checks are not tracked. |
| Container | `Dockerfile`, `docker-compose.yml` | Multi-stage image, port 3000, `./data` volume, HTTP healthcheck. |
| Tests | `tests/*.test.ts` | Config, database, API, checker, retry. No monitor or incident tests yet. |

`DELETE /services/:id` already soft-deactivates. Keep that as the default. A hard delete is a later, explicit flag, and it must be refused while an incident is open.

## 2. Product surfaces

These are all in scope. The phase column says when to build them. A surface that is “later” still has its data fields reserved in phase 0 so a migration is not required when it arrives.

| Surface | What it is | Phase |
|---|---|---|
| REST API | Operator and automation interface. Already started. | 0–1, then grows |
| MCP server | Agent interface. Same application functions as REST. Stateless HTTP, so any replica can answer. | 1 |
| Probe modules | One kind per engine or watch. Return one `CheckResult`. | 0 for the interface, 5–6 for engines |
| Scheduler and incidents | The pipeline that makes checks real. | 1 |
| Alert sinks | Log, webhook, Slack, email. Fire on incident open and resolve only. | 1 for the fan-out, 3 for Slack and email |
| Groups | A product or a client. Monitors, status pages, and keys hang off a group. | 2 |
| Auth and scopes | Bearer API keys. Scopes `read`, `write`, `admin`. | 2 |
| Status page | Public or private page rendered from checks and incidents. | 3 |
| Status JSON, SVG badge, Atom feed | Machine-readable and embeddable status. | 3 |
| Human incident updates | Investigating, identified, monitoring, resolved. Separate from the automatic incident row. | 3 |
| Subscribers | Email on incident open and resolve for one status page. | 6 |
| Maintenance windows | Record checks, suppress new incidents and alerts. | 3 |
| Metrics | Check-ratio and duration-weighted uptime, average latency, incident count. | 1 for real numbers, 3 for the monthly summary |
| Heartbeats | Inbound ping for cron, backups, billing, imports. Silence opens an incident. | 4 |
| TLS certificate watch | Days remaining on a certificate. | 4 |
| DNS watch | A name resolves, and optionally matches an expected value. | 6 |
| Domain expiry | RDAP expiry date for a registered domain. | 6 |
| TCP port watch | A port accepts a connection. Used for engines that have no query yet, and for mail or database ports as a coarse signal. | 4 |
| HTTP assertions | Expected status, body text, JSON value, latency budget, request headers. | 4 |
| On-demand check | One probe now, for CI after a deploy. | 4 |
| Kubernetes run | One monitor replica plus a stateless MCP deployment. | 3 |
| Kubernetes watch | Deployment, StatefulSet, CronJob, EndpointSlice, Ingress certificate. | 4 |
| Acknowledgement | An operator note that the page was seen. Does not close the incident. | 7 |
| Write MCP tools | Create, pause, resume, run a check, open a maintenance window. | 7 |
| Retention rollup | Downsample old `health_checks` so the file does not grow forever. | 6 |
| Flap resistance | `successThreshold` greater than 1. The column exists in phase 0. Default stays 1. | 6 |
| Multi-step HTTP | Login, carry a token, call a second URL, assert the body. | 6 |
| Operator web UI | Services, incidents, groups, alert routes, status-page editor. | 6 |
| Phone companion | Open incidents, last latency, acknowledge. Push on open and resolve. | 7 |
| Customer phone | The status page in a mobile browser. No native app. | 3, with the status page |
| Desktop app | Not a separate codebase. The web UI can be installed as a browser app. | No phase |
| Multi-region checks | More than one network confirming an outage. | Out of scope until the scheduler is no longer one process |
| Microsoft Search | Second in the search survey. No cluster health endpoint. Do not build a probe. | Never |

## 3. Target layout

Add files beside the current tree. Keep `src/server.ts` as the process entry.

```text
src/
  application/           # use cases. REST and MCP both call these
    monitors.ts
    checks.ts
    incidents.ts
    metrics.ts
    groups.ts
    statusPages.ts
    maintenance.ts
    heartbeats.ts
    acknowledgements.ts
  probes/
    types.ts             # Probe, ProbeTarget, CheckResult extensions
    registry.ts          # kind -> probe, loaded from the allowlist
    secrets.ts           # resolve secretRef to a value, then drop it
    http.ts              # move performCheck here; checker.ts re-exports
    tcp.ts
    tls.ts
    heartbeat.ts         # no outbound call; evaluates last ping time
    postgres.ts
    mysql.ts             # MySQL and MariaDB
    mssql.ts
    oracle.ts            # optional image only
    mongodb.ts
    redis.ts             # Redis and Valkey
    dynamodb.ts
    cosmos.ts
    memcached.ts
    etcd.ts
    elastic.ts           # Elasticsearch and OpenSearch
    azureSearch.ts
    googleSearch.ts
    kafka.ts
    rabbitmq.ts
    sqs.ts
    pubsub.ts
    serviceBus.ts
    s3.ts                # S3, MinIO, R2, and any S3-compatible endpoint
    azureBlob.ts
    gcs.ts
    k8s/
      client.ts
      deployment.ts
      statefulSet.ts
      cronJob.ts
      endpointSlice.ts
      ingressCert.ts
  incidents/
    evaluate.ts          # pure state machine, no I/O
  alerts/
    fanout.ts
    logging.ts           # move LoggingAlertSink here
    webhook.ts
    slack.ts
    email.ts
  auth/
    apiKeys.ts
    middleware.ts
  mcp/
    http.ts              # POST /mcp
    registry.ts
    errors.ts
    tools/
      health.ts
      monitors.ts
      incidents.ts
      checks.ts
      metrics.ts
      groups.ts
      workloads.ts       # registered only when a k8s probe is enabled
    resources.ts
    prompts.ts
  status/
    pageData.ts
    render.ts
    badge.ts
    feed.ts
  jobs/
    retention.ts
  db/
    database.ts          # keep DatabaseApi, extend it
    migrations.ts        # versioned steps, single copy of SQL
deploy/
  k8s/
    namespace.yaml
    monitor.yaml
    mcp.yaml
    rbac-watch.yaml
    network-policy.yaml
```

Optional engines ship as extra npm workspaces or as extra Docker targets, not as imports from the default server:

```text
packages/
  probe-oracle/
  probe-mssql/
  probe-kafka/
```

The default image imports only `http`. Everything else is behind `ENABLED_PROBES`.

## 4. Shared contracts

### 4.1 Check result

Replace the current `CheckResult` in `src/types/index.ts`. Keep `ok` so existing checker tests still compile, and derive it from `status`.

```ts
type CheckStatus = "UP" | "DEGRADED" | "DOWN";

type ErrorClass =
  | "timeout"
  | "network"
  | "dns"
  | "tls"
  | "http_status"
  | "auth"
  | "query"
  | "assertion"
  | "not_ready"
  | "missed_heartbeat"
  | "expired_certificate"
  | "expired_domain"
  | "unknown";

interface CheckResult {
  ok: boolean;                 // true only when status === "UP"
  status: CheckStatus;
  responseTimeMs: number;
  httpStatus?: number;
  errorClass?: ErrorClass;
  error?: string;              // safe to store and to show an agent
  evidence?: Record<string, string | number | boolean>;
}
```

`evidence` is a small bag: HTTP status, ready replica count, cluster health color, certificate days left. Never put a password, a connection string, a response body, or a secret header in `evidence` or `error`.

Status rules, used by every probe:

- `UP`: the health signal succeeded and the latency budget, if set, was met.
- `DEGRADED`: the target answered, but the signal is partial. Examples: Elasticsearch yellow, a Deployment with some but not all replicas ready, latency over budget while the body is correct, Cosmos DB HTTP 429.
- `DOWN`: no useful answer. Timeout, connection refused, auth failure, wrong body, red cluster, zero ready replicas, missed heartbeat, expired certificate.

`DEGRADED` is stored as a health check. It does not increment the failure streak. It does not count as a success. It does not open or resolve an incident. A later alert sink may send a warning; the default sinks do not.

### 4.2 Probe

```ts
interface ProbeContext {
  timeoutMs: number;
  signal: AbortSignal;
  secret?: string;             // present only inside the probe call
  log: Logger;
}

interface Probe {
  kind: string;
  check(target: ProbeTarget, ctx: ProbeContext): Promise<CheckResult>;
}

interface ProbeTarget {
  kind: string;
  address: string;             // URL, host:port, bucket, or Kubernetes name
  config: Record<string, unknown>;
}
```

Rules for every probe:

- Honor `ctx.signal`. A hung Oracle call must not outlive `timeoutMs`.
- Run a fixed health statement. Do not accept user SQL, a user shell command, or a user filter expression.
- Do not write to the target. No `INSERT`, no Kafka produce, no SQS receive, no Redis `KEYS`, no `kubectl exec`, no certificate renewal.
- Map driver errors into `ErrorClass` before returning. The incident machine never imports a driver.
- If the secret is missing, return `DOWN` / `auth` with `error: "secret not available"`. Do not throw a stack trace that contains the env var value.

### 4.3 Secret references

A service stores `secretRef`, which is the name of an environment variable, or null. Kubernetes mounts a Secret into that variable. The process never calls the Kubernetes Secrets API, so the monitor’s service account does not need secret read permission.

`resolveSecret(secretRef)` reads `process.env[secretRef]`. If `secretRef` contains anything other than `[A-Z0-9_]`, reject it at create time. Log the name, never the value. Scrub the value if a driver error message echoes it back.

SQLite, MCP tool results, status pages, and logs must not contain the resolved secret.

### 4.4 Retry

The current `retry()` only retries thrown errors. The checker swallows errors into a `CheckResult`. Change the pipeline, not every probe:

1. The probe returns a `CheckResult`.
2. The pipeline retries when `errorClass` is `timeout`, `network`, or `dns`.
3. The pipeline does not retry `auth`, `assertion`, `http_status` for 4xx, `query`, `not_ready`, `missed_heartbeat`, or `expired_certificate`.
4. HTTP 5xx is retryable and uses `errorClass: "http_status"`.
5. Only the final result is inserted into `health_checks`. Intermediate attempts are `debug` logs with the service id, attempt number, and error class.
6. Backoff stays exponential: `baseDelayMs * factor^attempt`, using `RETRY_COUNT`, `RETRY_BASE_DELAY_MS`, and `RETRY_FACTOR`.

At create time, reject a service when the worst case does not fit in the interval:

```text
(timeoutMs * (RETRY_COUNT + 1)) + (RETRY_BASE_DELAY_MS * (factor^RETRY_COUNT - 1) / (factor - 1))
  < intervalSeconds * 1000
```

When `RETRY_FACTOR` is 1, the delay term is `RETRY_BASE_DELAY_MS * RETRY_COUNT`.

### 4.5 Application layer

REST handlers and MCP tool handlers must not talk to probes or to SQLite directly. They call `src/application/*`. That is what keeps the two doors from drifting.

Each application function returns plain objects or throws `AppError`. MCP translates `AppError` into a tool error. REST translates it in the existing error middleware.

Add these error codes next to the current ones:

| Code | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or unknown API key, once auth is on. |
| `FORBIDDEN` | 403 | Key scope is too small, or the key’s group does not own the row. |
| `CONFLICT` | 409 | Hard delete of a service with an open incident, or a duplicate heartbeat token. |
| `NOT_IMPLEMENTED` | 501 | A kind that is not in `ENABLED_PROBES`. |

## 5. Data model

`migrations.ts` becomes the only schema owner. `database.ts` runs pending versions and records them. Add the version table in the first new migration, and record the current `CREATE TABLE IF NOT EXISTS` script as version 1 so existing files adopt it without being rebuilt.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### 5.1 Version 2: kinds, groups, and incident fields

`services` gains columns. `url` stays and remains the address for `kind = 'http'`.

| Column | Type | Default for existing rows | Meaning |
|---|---|---|---|
| `kind` | TEXT | `'http'` | Probe name. |
| `role` | TEXT | `'owned'` | `owned` or `dependency`. A dependency incident is labeled with the vendor, not as “our API”. |
| `group_id` | TEXT NULL | NULL | FK to `groups`. Null means the default group created in this migration. |
| `secret_ref` | TEXT NULL | NULL | Env var name. |
| `config_json` | TEXT | `'{}'` | Probe-specific JSON validated by that kind’s Zod schema. |
| `latency_budget_ms` | INTEGER NULL | NULL | Over budget with an otherwise successful check is `DEGRADED`. |
| `success_threshold` | INTEGER | `1` | Consecutive `UP` results required to resolve. |
| `paused` | INTEGER | `0` | Paused services are not scheduled. Distinct from `is_active = 0`, which is soft-delete. |

`health_checks` gains:

| Column | Type | Meaning |
|---|---|---|
| `error_class` | TEXT NULL | `ErrorClass`. |
| `evidence_json` | TEXT NULL | The evidence bag. |
| `region` | TEXT NULL | Reserved. Stays null until multi-region exists. |

`incidents` gains:

| Column | Type | Meaning |
|---|---|---|
| `error_class` | TEXT NULL | Class from the check that opened it. |
| `update_state` | TEXT | `investigating` by default when opened. Then `identified`, `monitoring`, `resolved`. |

New tables:

```text
groups
  id TEXT PK
  name TEXT
  slug TEXT UNIQUE
  created_at TEXT

maintenance_windows
  id TEXT PK
  group_id TEXT NULL
  service_id TEXT NULL
  starts_at TEXT
  ends_at TEXT
  note TEXT

api_keys
  id TEXT PK
  name TEXT
  prefix TEXT            # first 8 chars, stored for display
  hash TEXT              # sha256 of the secret, not the secret
  scope TEXT             # read | write | admin
  group_id TEXT NULL     # null means all groups, admin only
  created_at TEXT
  revoked_at TEXT NULL

alert_routes
  id TEXT PK
  group_id TEXT NULL
  kind TEXT              # log | webhook | slack | email
  config_json TEXT       # URLs and addresses, never inbound secrets of targets
  secret_ref TEXT NULL
  enabled INTEGER

alert_deliveries
  id INTEGER PK
  route_id TEXT
  incident_id TEXT
  kind TEXT              # opened | resolved
  status TEXT            # sent | failed
  error TEXT NULL
  created_at TEXT

status_pages
  id TEXT PK
  group_id TEXT
  slug TEXT UNIQUE
  title TEXT
  visibility TEXT        # public | private
  created_at TEXT

status_components
  id TEXT PK
  status_page_id TEXT
  service_id TEXT
  display_name TEXT
  sort_order INTEGER

incident_updates
  id TEXT PK
  incident_id TEXT
  state TEXT             # investigating | identified | monitoring | resolved
  message TEXT
  created_at TEXT

subscribers
  id TEXT PK
  status_page_id TEXT
  email TEXT
  token_hash TEXT
  verified_at TEXT NULL
  created_at TEXT

acknowledgements
  id TEXT PK
  incident_id TEXT
  note TEXT
  actor TEXT             # api key name or "heartbeat"
  created_at TEXT

heartbeats
  id TEXT PK
  service_id TEXT UNIQUE
  token_hash TEXT
  grace_seconds INTEGER
  last_ping_at TEXT NULL

check_rollups
  hour TEXT              # ISO hour
  service_id TEXT
  checks INTEGER
  up_checks INTEGER
  degraded_checks INTEGER
  down_checks INTEGER
  avg_response_time_ms INTEGER
  PRIMARY KEY (service_id, hour)
```

Create one default group named `Default` and attach existing services to it.

`config_json` schemas are defined per kind in section 12. Validate on write. Store the JSON only after validation. On read, a config that fails validation is a `DOWN` / `unknown` check with `error: "invalid probe config"`, and the scheduler logs the service id.

### 5.2 Indexes

Add indexes as the queries appear, not in advance of them:

- `incidents(resolved_at)` for open incidents (`resolved_at IS NULL`).
- `services(group_id, is_active)`.
- `alert_deliveries(incident_id, created_at)`.
- `incident_updates(incident_id, created_at)`.

The existing `(service_id, checked_at)` index on `health_checks` stays.

## 6. Scheduler and incident machine

This is the gate. MCP and new engines are not useful until a registered service produces rows and incidents.

### 6.1 Scheduler

Replace the body of `InMemoryMonitor` without changing the `Monitor` interface callers already use. Add `runOnce(serviceId)` for tests and for the on-demand API.

Behavior:

- `start()` loads active, unpaused services and calls `registerService` for each.
- `registerService` runs one check immediately, then schedules the next run.
- The next run is a `setTimeout` armed only after the current check, including retries, finishes. Do not use `setInterval`. Overlapping runs for the same service are forbidden.
- `unregisterService` clears the timer. Soft-delete and pause both call it.
- `activeServiceCount()` returns scheduled jobs, not table rows.
- `GET /health` reads `monitor.isRunning()`. If the monitor is stopped or the database ping fails, status is `unhealthy` and HTTP is 503. `activeServices` is `monitor.activeServiceCount()`.

Track in-flight checks with a counter. Shutdown stops the HTTP server, clears timers, waits until the counter is 0 or the longest configured timeout elapses, then closes the database. Replace the fixed 5 second force-exit with that bound, and keep a final hard cap of the max timeout plus 1 second.

### 6.2 One check cycle

`application/checks.run(service)`:

1. If a maintenance window covers `now` for this service or its group, still probe and still insert the row, but skip steps 4 and 5.
2. Resolve the probe from the registry. Unknown kind: insert `DOWN` / `unknown` and skip retries.
3. Run the probe through the retry policy in section 4.4.
4. Insert one `health_checks` row.
5. Call `evaluateIncident`.
6. Schedule the next timeout.

Heartbeat services skip the outbound probe. Step 3 compares `now` with `last_ping_at + grace_seconds`. A missing ping is `DOWN` / `missed_heartbeat`. A recent ping is `UP`.

### 6.3 Incident state machine

Keep this function pure. Give it the previous streak, whether an incident is open, the new result, and the thresholds. It returns the next streak and an effect: `none`, `open`, or `resolve`.

```text
streak is a signed integer
  positive N  means N consecutive UP since the last DOWN
  negative N  means N consecutive DOWN since the last UP
  0           means no completed streak (startup, or last result was DEGRADED only)

DEGRADED
  streak unchanged, effect none

UP, no open incident
  streak = max(streak, 0) + 1
  effect none

UP, open incident
  streak = max(streak, 0) + 1
  effect resolve when streak >= successThreshold
  on resolve, streak stays positive

DOWN, no open incident
  streak = min(streak, 0) - 1
  effect open when abs(streak) >= failureThreshold

DOWN, open incident
  streak = min(streak, 0) - 1
  effect none
```

On `open`, insert an incident with `reason` taken from `error`, `error_class` from the check, and the first `incident_updates` row: state `investigating`, message generated as `"Automatic: <reason>"`. Then notify sinks with `kind: "opened"`.

On `resolve`, set `resolved_at` and `duration_seconds`, append an update with state `resolved`, and notify with `kind: "resolved"`.

Opening is idempotent: if an open incident already exists, do not insert another. The pure function encodes that, and `openIncident` in the store must also refuse a second open row for the same service.

### 6.4 Rebuild on startup

Before arming timers, for each active service:

- Load the newest open incident, if any.
- Walk recent health checks from newest to oldest, skipping `DEGRADED`, until the streak is long enough to know whether the threshold is already met.
- Seed the in-memory streak from that walk.
- Do not re-notify for an incident that is already open.

A process restart must not close an incident and must not open a duplicate.

### 6.5 Failure and success thresholds

`failureThreshold` already exists on the service and defaults from `DEFAULT_FAILURE_THRESHOLD` (3). `successThreshold` defaults to 1, which matches the current design: one success resolves. Raising it is the flap control. Do not change the default when the column is added.

## 7. Alerts

`AlertSink` stays the interface in `src/services/alert.ts`. `fanout.ts` loads enabled `alert_routes` and calls each sink. One sink throwing must not block the others. Record each attempt in `alert_deliveries`.

| Kind | Config | Behavior |
|---|---|---|
| `log` | none | Today’s logger. Always available so a route-less install still records a line. |
| `webhook` | `{ "url": "https://..." }` | POST JSON `{ service, incident, kind, group }`. `secret_ref` is sent as a bearer token if set. Timeout 5 seconds. No retry loop inside the request; one attempt per notification. |
| `slack` | `{ "channel": "#ops" }` optional | POST to a Slack incoming webhook URL held in `secret_ref`. Text includes service name, group, kind, reason, and the status page URL when one exists. |
| `email` | `{ "to": ["ops@example.com"] }` | SMTP settings from env: `SMTP_URL`, `SMTP_FROM`. Send on open and resolve only. |

Notifications fire on the open and resolve effects only. They do not fire for a single failed probe, a `DEGRADED` result, or a repeated `DOWN` while the incident stays open.

During a maintenance window, skip notification. The check row is still written.

Add `POST /alert-routes` and `DELETE /alert-routes/:id` behind the `write` scope, phase 3. Phase 1 can ship the log sink wired to the incident effect with no route table yet, then persist routes in phase 3.

## 8. Auth

Phase 0 and phase 1 may run with `AUTH_MODE=disabled`, which is the current behavior, so existing tests keep working. Phase 2 turns on keys.

- `POST /api-keys` requires `admin`. The response includes the plaintext token once. The store keeps `prefix` and `hash`.
- Clients send `Authorization: Bearer <token>` on REST and on MCP.
- `read` can call every GET and every read MCP tool.
- `write` includes `read`, plus create and pause monitors, maintenance windows, alert routes, acknowledgements, and on-demand checks.
- `admin` includes `write`, plus keys, groups, and hard delete.
- A key with a `group_id` can only see and change rows in that group. Status pages for other groups are hidden.
- Public status pages, the SVG badge, the status JSON, the Atom feed, and `POST /heartbeats/:token` do not use an API key. The heartbeat token is the credential.
- Compare hashes in constant time. Store sha256 of the token.

`GET /health` stays unauthenticated so the container probe works. It returns only process status, never the service list.

## 9. MCP server

### 9.1 Transport

Mount `POST /mcp` on the same Express app in phase 1. A later Kubernetes deployment can run a second process with `MCP_ONLY=true` that proxies tool calls to the monitor’s REST API. That second process does not open SQLite. Do not build the proxy until phase 3. Phase 1 runs in-process so one `npm run dev` is enough.

Stateless request, matching the July 2026 MCP revision. There is no session id and no initialize handshake required:

```http
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Authorization: Bearer <token>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "incidents.list_open",
    "arguments": {},
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "example", "version": "0" }
    }
  }
}
```

Support these methods:

| Method | Response |
|---|---|
| `tools/list` | Every registered tool’s name, description, and JSON schema. |
| `tools/call` | Run one tool. |
| `resources/list` | The resource templates in section 9.4. |
| `resources/read` | One resource body. |
| `prompts/list` | The prompts in section 9.5. |
| `prompts/get` | One prompt’s messages. |

Unknown methods return JSON-RPC `-32601`. Invalid params return `-32602`. Application failures return a successful JSON-RPC envelope with `isError: true` and a `structuredContent.error` of `{ code, message }`, using the same codes as REST. Do not put stack traces in the payload.

When `AUTH_MODE=disabled`, MCP accepts calls without a bearer token and treats them as admin. Log a warning at startup.

### 9.2 Tool result shape

Every tool returns both:

- `content`: one text block, a short sentence a person can read.
- `structuredContent`: the same object REST would return.

Agents should use `structuredContent`. The text is a summary, not a second source of truth.

### 9.3 Tools

Names are permanent. Adding a field is allowed. Renaming a field or changing a type is not. A new capability is a new tool name.

Read tools, phase 1 unless noted:

| Tool | Arguments | Returns |
|---|---|---|
| `health.get` | none | The `/health` payload. |
| `monitors.list` | `groupId?`, `kind?`, `status?` (`UP`, `DEGRADED`, `DOWN`) | Id, name, kind, role, group, status from the latest check, last checked time, last latency. No `config_json`, no `secret_ref`. |
| `monitors.get` | `id` | The list fields plus interval, timeout, thresholds, paused, active, and a redacted config (secret keys removed). |
| `incidents.list_open` | `groupId?` | Open incidents with service name, group, reason, error class, started at, age seconds, latest human update state. |
| `incidents.get` | `id` | One incident, its updates, and acknowledgements. |
| `incidents.list_for_monitor` | `serviceId`, `limit?` (default 20, max 100) | Newest incidents, open or resolved. |
| `checks.latest` | `serviceId` | The newest health check, or null. |
| `checks.recent` | `serviceId`, `limit?` | Newest checks, default 20, max 100. |
| `metrics.get` | `serviceId`, `window` (`1h`, `24h`, `7d`, `30d`) | Section 11. |
| `groups.list` | none | Id, name, slug. Phase 2. |
| `groups.get` | `id` | Group plus monitor counts by status. Phase 2. |
| `status.get` | `slug` | The public status document. Phase 3. Works without auth when the page is public. |
| `workloads.list` | `namespace?` | Registered Kubernetes watches and their last status. Registered only when a `k8s.*` kind is enabled. |

Write tools, phase 7. A `read` key receives `FORBIDDEN`.

| Tool | Arguments | Effect |
|---|---|---|
| `monitors.create` | Same body as `POST /services` | Creates and runs the first check. |
| `monitors.pause` | `id` | Stops the timer. `paused = 1`. |
| `monitors.resume` | `id` | Arms the timer and runs a check now. |
| `checks.run` | `serviceId` | On-demand cycle. Returns the final `CheckResult` and any incident effect. |
| `incidents.acknowledge` | `id`, `note` (1–500 chars) | Inserts an acknowledgement. Does not resolve. |
| `maintenance.create` | `serviceId?`, `groupId?`, `startsAt`, `endsAt`, `note` | One of service or group is required. |

`monitors.create` must not be a way to pass a raw secret. The client passes `secretRef`, the name of an env var that already exists in the monitor’s environment.

### 9.4 Resources

| URI | Body |
|---|---|
| `monitor://health` | Same as `health.get`. |
| `monitor://summary` | Counts of UP, DEGRADED, DOWN, and open incidents. |
| `monitor://services/{id}` | Same as `monitors.get`. |
| `monitor://incidents/open` | Same as `incidents.list_open`. |
| `monitor://status/{slug}` | Same as `status.get`. |

Resources are read-only mirrors of tools so a client that prefers resources still sees one model.

### 9.5 Prompts

| Name | Argument | What the messages say |
|---|---|---|
| `explain-open-incidents` | none | Instruct the client to call `incidents.list_open`, then `checks.latest` for each affected service, and to answer with service, reason, error class, age, and whether the role is `dependency`. |
| `explain-incident` | `incidentId` | Instruct the client to call `incidents.get` and `checks.recent`, and to describe the streak without inventing a cause that is not in the evidence. |

Prompts do not fetch data themselves. They tell the client which tools to call. That keeps the prompt layer from growing a second query path.

### 9.6 Module registration

```ts
interface McpModule {
  id: string;
  tools?: McpTool[];
  resources?: McpResource[];
}

interface McpTool {
  name: string;
  scope: "read" | "write";
  description: string;
  inputSchema: object;        # JSON Schema
  handler: (args: unknown, ctx: AuthContext) => Promise<unknown>;
}
```

`src/mcp/registry.ts` always registers the core read tools. A probe package may register extra tools. The Kubernetes package registers `workloads.list`. Disabled packages are not imported, so their tools do not appear in `tools/list`.

Startup fails if two modules register the same tool name.

## 10. REST API

Existing routes stay. New routes are added beside them. Response objects match MCP `structuredContent` for the same use case.

Already present:

- `GET /health`
- `POST /services`
- `GET /services`
- `GET /services/:id`
- `DELETE /services/:id` soft-deactivates and unregisters the timer
- `GET /services/:id/incidents`
- `GET /services/:id/metrics`

Change `POST /services` so `intervalSeconds`, `timeoutMs`, and `failureThreshold` fall back to config defaults. Today the Zod schema requires all three even though the config has defaults.

Extend `POST /services` and the stored row:

```json
{
  "name": "Payments API",
  "kind": "http",
  "url": "https://example.com/health",
  "role": "owned",
  "groupId": "optional",
  "secretRef": "PAYMENTS_TOKEN",
  "intervalSeconds": 60,
  "timeoutMs": 5000,
  "failureThreshold": 3,
  "successThreshold": 1,
  "latencyBudgetMs": 800,
  "config": {}
}
```

`url` is required for `http` and is stored in the existing column. Other kinds use `config` plus an `address` field inside `config`, and `url` may be an empty placeholder only if the column is made nullable in version 2. Prefer a real `address` column over overloading `url` for a Kafka broker list. Version 2 adds `address TEXT`. For `http`, `address` is copied from `url`.

`GET /services` returns the latest real status: `UP`, `DEGRADED`, or `DOWN`. No checks yet is `DOWN` only after the first check has been attempted and failed. Before the first check finishes, return `status: "UNKNOWN"`. Add `UNKNOWN` to the API enum. It is not a `CheckStatus` and it is not stored in `health_checks`.

New routes, by phase:

| Phase | Route | Scope |
|---|---|---|
| 1 | `POST /services/:id/pause` and `POST /services/:id/resume` | open until phase 2, then `write` |
| 2 | `GET /groups`, `POST /groups` | read / admin |
| 2 | `POST /api-keys`, `DELETE /api-keys/:id` | admin |
| 3 | `GET /status/:slug`, `GET /status/:slug.json`, `GET /status/:slug/badge.svg`, `GET /status/:slug/feed.xml` | public, or `read` if the page is private |
| 3 | `POST /status-pages`, `POST /status-pages/:id/components` | admin |
| 3 | `POST /incidents/:id/updates` | write |
| 3 | `POST /alert-routes`, `GET /alert-routes`, `DELETE /alert-routes/:id` | write / read / write |
| 3 | `POST /maintenance-windows`, `GET /maintenance-windows` | write / read |
| 4 | `POST /services/:id/check` | write |
| 4 | `POST /heartbeats/:token` | heartbeat token |
| 6 | `POST /status/:slug/subscribers` | public, then confirm via token |
| 7 | `POST /incidents/:id/acknowledgements` | write |

`DELETE /services/:id?hard=true` is `admin` only, phase 6, and returns 409 when an incident is open or health checks exist. The default delete remains soft.

## 11. Metrics and the monthly summary

`GET /services/:id/metrics?window=24h` replaces the placeholder.

For the window, compute:

- `totalChecks`, `upChecks`, `degradedChecks`, `downChecks` from `health_checks`, and from `check_rollups` for hours that have been compacted.
- `uptimePercentCheckRatio` = `upChecks / totalChecks`. `DEGRADED` counts in the denominator and not in the numerator.
- `uptimePercentDuration` from incident overlap with the window. Time covered by an open or resolved incident is down time. The rest of the window, after the service’s `created_at`, is up time. This is the SLA number.
- `avgResponseTimeMs` from stored latencies.
- `incidentCount` and `openIncidentCount`.
- `mttrSeconds`: mean of `duration_seconds` for incidents that both started and resolved inside the window. Omit the field when there are none.

`GET /groups/:id/report?month=YYYY-MM` returns, per service, the duration uptime, incident list (start, resolve, reason, duration), and mean latency. Phase 3 can return JSON. A PDF is not required.

The check-ratio number stays in the payload because the README already promised it. Clients that need a contract figure use `uptimePercentDuration`.

## 12. Probe catalog

Each subsection is a module. The health signal is the entire query. Config fields are the `config` object. Common service fields from section 10 are not repeated.

Shared test for every module: a contract test that points at a disposable server, asserts `UP` for the healthy signal, asserts `DOWN` with the right `errorClass` for a refused port, and asserts the timeout fires when the server does not answer. Use Testcontainers or a local stub. Do not mock the driver so thoroughly that the query is never sent.

### 12.1 HTTP, kind `http`

This is `performCheck`, moved under `src/probes/http.ts`.

Config:

| Field | Default | Effect |
|---|---|---|
| `method` | `GET` | `GET` or `POST` only. |
| `headers` | `{}` | Non-secret headers. |
| `secretHeader` | null | Header name whose value is the resolved secret. |
| `expectedStatus` | `200-299` | A status outside the set is `DOWN` / `http_status`. |
| `bodyIncludes` | null | Missing substring is `DOWN` / `assertion`. Read at most 64 KB. |
| `jsonPath` | null | Dot path with numeric indexes, such as `data.status`. No code evaluation. |
| `jsonEquals` | null | Compared as a string to the value at `jsonPath`. |
| `followRedirects` | true | Current behavior. |
| `tlsSkipVerify` | false | Leave false. A true value is rejected unless `NODE_ENV=development`. |

Latency over `latencyBudgetMs` with a passing body is `DEGRADED`, not `DOWN`.

Multi-step, phase 6, kind `http.flow`. Config is an ordered list of up to five steps. Each step is an HTTP config plus `saveJsonPath` and `headerTemplate`. The template may insert a value saved by an earlier step, for example a token. Steps share one timeout budget. Persist only the final step’s result. The saved token is memory-only and must not be logged.

### 12.2 TCP, kind `tcp`

Config: `host`, `port` (1–65535). Connect and close. Success is `UP`. Refusal is `DOWN` / `network`. Timeout is `timeout`. Use this for a coarse signal before a native driver exists, and for SMTP or other ports that have no module of their own.

### 12.3 TLS certificate, kind `tls`

Config: `host`, `port` default 443, `warnDays` default 21, `downDays` default 3. Open a TLS socket, read the peer certificate’s `notAfter`. More than `warnDays` left is `UP`. Between `downDays` and `warnDays` is `DEGRADED`. Less than `downDays`, or already expired, is `DOWN` / `expired_certificate`. Evidence includes `daysRemaining`. Do not send application data.

### 12.4 Heartbeat, kind `heartbeat`

No outbound socket. Config: `graceSeconds`, required, at least the interval. Creating the service returns the plaintext heartbeat token once. Store only the hash.

`POST /heartbeats/:token` with an empty body sets `last_ping_at`. Unknown token is 404. The scheduler marks the service `DOWN` / `missed_heartbeat` when `now > last_ping_at + graceSeconds`, or when no ping has ever arrived and the service is older than the grace period.

Use this for cron, backups, billing runs, imports, newsletters, and Kubernetes CronJobs that can curl from the job. The cluster CronJob watch in section 14 is the alternative when the job cannot send a ping.

### 12.5 DNS and domain expiry

Phase 6. These fail on a calendar or a record change, often while HTTP still looks healthy.

| Kind | Signal | Config | Result |
|---|---|---|---|
| `dns` | Resolve `name` with the system resolver | `name`, `type` (`A`, `AAAA`, `CNAME`, `MX`, or `TXT`), optional `expected` string | Resolves, and matches `expected` when set, is `UP`. NXDOMAIN or a mismatch is `DOWN` / `query`. Timeout is `timeout`. |
| `domain` | RDAP expiry for a domain | `domain`, `warnDays` default 30, `downDays` default 7 | Same date windows as the TLS probe. Use `errorClass` `expired_domain`. |

Do not transfer or update the domain. Read the expiry date and stop.

### 12.6 Databases

Health account: permission to connect and run the one statement below. No table access beyond that.

SQLite is not a remote probe. It remains the monitor’s store on a local file or a Kubernetes volume. A `SELECT 1` against some other SQLite file is allowed only as kind `sqlite` when `address` is a path inside `SQLITE_PROBE_ROOT`, phase 6, and only for tests or a sidecar file. Refuse paths that escape that root.

| Kind | Engine | Signal | Config | Error mapping |
|---|---|---|---|---|
| `postgres` | PostgreSQL | `SELECT 1` | `host`, `port` default 5432, `database`, `user`. Password from `secretRef`. `ssl` default `require` outside development. | Auth failure `auth`. Query error `query`. Refused port `network`. |
| `mysql` | MySQL and MariaDB | `SELECT 1` | `host`, `port` default 3306, `user`, `database` optional. Password from `secretRef`. | Same classes. One module, `config.variant` optional label `mysql` or `mariadb` for the incident text only. |
| `mssql` | SQL Server and Azure SQL | `SELECT 1` | `host`, `port` default 1433, `user`, `database`, `encrypt` default true. Password from `secretRef`. | Same classes. Ship in the `probe-mssql` image, not the default image. |
| `oracle` | Oracle | `SELECT 1 FROM DUAL` | `connectString`, `user`. Password from `secretRef`. Thin mode only. | Same classes. Ship in the `probe-oracle` image. |
| `mongodb` | MongoDB | `{ ping: 1 }` on the `admin` database | `uri` without the password. Password from `secretRef`, inserted by the probe into the driver options, not by string-replacing logs. | Auth `auth`. Topology timeout `timeout`. |

PostgreSQL is the first external database to implement. It is also the store to move the monitor onto if a second scheduler replica is ever required. That move is a `DatabaseApi` implementation behind the same interface, not a change to probes. Do not start it in the default path. One replica and SQLite remain the supported run mode until a later design explicitly replaces them.

### 12.7 Key-value

| Kind | Engine | Signal | Config | Notes |
|---|---|---|---|---|
| `redis` | Redis and Valkey | `PING` | `host`, `port` default 6379, `tls` boolean. Password from `secretRef` as `AUTH`. | Do not call `KEYS`, `SCAN`, or `FLUSH`. Valkey uses this kind unchanged. |
| `dynamodb` | Amazon DynamoDB | `DescribeTable` for one table | `region`, `table`. On EKS the pod role supplies credentials and `secretRef` is null. Outside EKS, `secretRef` holds an access key pair JSON `{ "accessKeyId", "secretAccessKey" }` parsed in memory. | A missing table is `DOWN` / `query`. A throttled call is `DEGRADED`. |
| `cosmos` | Azure Cosmos DB | Read database account metadata | `endpoint`, `database`. Key from `secretRef`. | HTTP 429 is `DEGRADED`. HTTP 401 is `auth`. |
| `memcached` | Memcached | `version` | `host`, `port` default 11211. | No auth in the protocol this module speaks. Reach it only through a network policy. |
| `etcd` | etcd | `GET /health` on the client URL | `url`. Optional bearer token in `secretRef`. | Record the incident. This module must not restart etcd or write a key. On a Kubernetes control plane, point it at the client URL the operator already exposes, not at a loopback address inside an etcd pod. |

### 12.8 Search

| Kind | Product | Signal | Config | Notes |
|---|---|---|---|---|
| `elastic` | Elasticsearch and OpenSearch | `GET {address}/_cluster/health` | `address`, `variant` `elasticsearch` or `opensearch`. API key or basic password from `secretRef`. | Green is `UP`. Yellow is `DEGRADED`. Red is `DOWN` / `query`. This is the HTTP probe plus a status map, not a second HTTP stack. |
| `azureSearch` | Azure AI Search | `GET {endpoint}/servicestats?api-version=2023-11-01` | `endpoint`. Admin or query key in `secretRef`, sent as `api-key`. | HTTP 200 is `UP`. |
| `googleSearch` | Google Cloud Search / Vertex AI Search | One authenticated GET the chosen API documents as a metadata read | `endpoint`, `project`. Workload identity when `secretRef` is null. | Confirms the API and the credential. It does not score search quality. |

Microsoft Search has no cluster health endpoint. Do not add a kind for it.

Apache Solr is not in the survey top five. If it is added later, the signal is `GET /solr/admin/info/health` and the kind is `solr`. Leave it out of the allowlist until someone asks.

### 12.9 Brokers

Probes must not publish, consume, peek, or acknowledge.

| Kind | Broker | Signal | Config |
|---|---|---|---|
| `kafka` | Apache Kafka | Metadata request to the bootstrap brokers | `brokers` array of `host:port`, `clientId` default `api-monitor`. Optional SASL password from `secretRef`. The client needs Describe on the cluster, nothing else. Ship in `probe-kafka`. |
| `rabbitmq` | RabbitMQ | `GET {managementUrl}/api/health/checks/alarms` | `managementUrl`, `user`. Password from `secretRef`. If `managementUrl` is omitted, open a TCP connection to `host` and `port` (default 5672) and close it; that result is a weaker `UP`. |
| `sqs` | Amazon SQS | `GetQueueUrl` for one queue name | `region`, `queueName`. Credentials the same way as DynamoDB. Do not read `ApproximateNumberOfMessages` for up/down. Depth can be a later metric. |
| `pubsub` | Google Cloud Pub/Sub | `topics.get` for one topic | `project`, `topic`. Workload identity or `secretRef`. A missing topic is `DOWN` / `query`. An unreachable API is `network` or `timeout`. |
| `servicebus` | Azure Service Bus | Management read of one queue | `namespace`, `queue`. Key or connection secret from `secretRef`. Do not peek and do not receive. |

### 12.10 Object storage

Kind `s3` covers Amazon S3, MinIO, Cloudflare R2, and any other S3-compatible endpoint. Kind `azureblob` and kind `gcs` are the only separate modules.

| Kind | Signal | Config |
|---|---|---|
| `s3` | `HeadBucket` on one bucket | `endpoint` null for AWS, or the MinIO or R2 endpoint. `region`, `bucket`. Credentials like DynamoDB, or static keys from `secretRef`. Force path-style when `endpoint` is set. |
| `azureblob` | Get Blob Service Properties | `accountUrl`. Key from `secretRef`, or workload identity. |
| `gcs` | `buckets.get` | `bucket`. Workload identity, or a JSON key in `secretRef` parsed in memory. |

HTTP 403 is `auth`. HTTP 404 is `query`. Timeout is `timeout`. A successful head is `UP` even if the bucket is empty.

### 12.11 What the default image loads

`ENABLED_PROBES=http` is the default. Document every kind in `.env.example` as a comment. The core image may also enable, without extra native dependencies:

`http`, `tcp`, `tls`, `heartbeat`, `elastic`, `postgres`, `mysql`, `mongodb`, `redis`, `memcached`, `etcd`, `s3`.

These need extra packages or cloud SDKs and stay off unless listed:

`mssql`, `oracle`, `kafka`, `dynamodb`, `cosmos`, `sqs`, `pubsub`, `servicebus`, `azureblob`, `gcs`, `azureSearch`, `googleSearch`, `rabbitmq`, `k8s.deployment`, `k8s.statefulset`, `k8s.cronjob`, `k8s.endpoints`, `k8s.ingressCert`.

RabbitMQ’s HTTP health check can use `fetch` and therefore may live in the core image. The AMQP fallback is the optional part. Prefer the HTTP check in the core image and skip the AMQP client.

## 13. Run on Kubernetes

Phase 3. One namespace `api-monitor`.

### 13.1 Workloads

`deploy/k8s/monitor.yaml`:

- Deployment `api-monitor`, replicas 1. Do not raise this while the store is SQLite.
- Container command is the current image. Env from a ConfigMap: `PORT`, `DB_PATH=/data/api-monitor.db`, `NODE_ENV=production`, `AUTH_MODE`, `ENABLED_PROBES`, `MCP_ENABLED=true`.
- Secrets for probe passwords and API key pepper mounted as env from a Secret. The manifest references the Secret name. It does not contain values.
- Volume `data` from a PersistentVolumeClaim, ReadWriteOnce, mounted at `/data`.
- `securityContext`: run as non-root, which the Dockerfile already does with `USER node`. Read-only root filesystem once the data dir is the only write. Drop all capabilities.
- Resources: request 100m CPU and 128Mi memory, limit 500m and 512Mi, then adjust from real checks.
- Probes: HTTP `GET /health` on port 3000. Liveness and readiness both use it. `failureThreshold` 3, `periodSeconds` 10.
- `strategy: Recreate`, so two pods never mount the same SQLite volume.

`deploy/k8s/mcp.yaml`, still phase 3 but only after the in-process MCP works:

- Deployment `api-monitor-mcp`, replicas 2.
- `MCP_ONLY=true`. `MONITOR_BASE_URL=http://api-monitor:3000`. No volume. No `DB_PATH`.
- The MCP process forwards tool calls to the monitor API with a `read` token from a Secret.
- Readiness: HTTP `GET /health` on the MCP process, which checks that the monitor base URL answers.
- PodDisruptionBudget `minAvailable: 1`.
- A HorizontalPodAutoscaler may target this deployment. It must not target the monitor deployment.

Service `api-monitor` port 3000, cluster IP. Service `api-monitor-mcp` port 3000, cluster IP. No public LoadBalancer in the default manifests. An Ingress is an operator choice and is not required for in-cluster agents.

### 13.2 Network policy

- Monitor pods accept TCP 3000 only from the MCP pods and from pods in the same namespace labeled `role=operator`.
- MCP pods accept TCP 3000 from namespaces labeled `mcp-client=allowed`.
- Monitor pods may egress to probe targets. Start with egress allowed, then tighten per prefix when the target set is known. DNS egress to kube-dns is required.
- MCP pods egress only to the monitor Service and to DNS.

### 13.3 Store limits

SQLite on a ReadWriteOnce volume and a single monitor replica is the supported Kubernetes mode. Do not run two schedulers. Do not put SQLite on a shared filesystem.

A second replica requires all of the following, which are out of the phase 3 contract:

- A PostgreSQL `DatabaseApi`.
- A leader lease so only one pod schedules.
- MCP already stateless, which it is.

### 13.4 Optional operator

The Kubernetes MCP Lifecycle Operator can wrap the MCP deployment in an `MCPServer` resource. That is a packaging choice after `mcp.yaml` is already healthy. It does not replace probe modules, and it is not required to ship phase 3.

## 14. Watch Kubernetes

Phase 4. Kinds:

| Kind | API | UP | DEGRADED | DOWN |
|---|---|---|---|---|
| `k8s.deployment` | `apps/v1` Deployments | `readyReplicas == spec.replicas` and spec is at least 1 | `readyReplicas > 0` but less than spec | `readyReplicas == 0`, or the object is missing |
| `k8s.statefulset` | `apps/v1` StatefulSets | same replica rule | same | same |
| `k8s.cronjob` | `batch/v1` CronJobs | last successful time is within `config.maxAgeSeconds` | last success is inside the age, but the last run failed and a success exists inside the age | no success inside the age, or the job was never successful and the CronJob is older than the age |
| `k8s.endpoints` | `discovery.k8s.io/v1` EndpointSlices | at least one ready address for the Service | none | the Service exists and every address is not ready, or there are no slices |
| `k8s.ingressCert` | Ingress plus the named TLS Secret | `notAfter` beyond `warnDays` | inside the warning window | inside `downDays`, expired, or the Secret is missing |

Config for the workload kinds: `namespace`, `name`. Config for the certificate kind: `namespace`, `ingressName`, `warnDays`, `downDays`. The probe reads the Secret named by `spec.tls[].secretName`. It compares dates. It does not log the certificate body or the private key.

RBAC in `deploy/k8s/rbac-watch.yaml`:

- ServiceAccount `api-monitor`.
- ClusterRole `api-monitor-watch` with `get` and `list` on `deployments`, `statefulsets`, `cronjobs`, `services`, `endpointslices`, `ingresses`, and `secrets`.
- `secrets` `get` is required for certificate dates. Restrict it with a namespace Role instead of a ClusterRole when every watch is in one namespace. Prefer a Role per namespace over a cluster-wide secret read.
- No `create`, `update`, `patch`, `delete`, `pods/exec`, or `pods/portforward`.

The client uses in-cluster config. Requests use the probe timeout. A 403 from the API is `DOWN` / `auth` with `error: "kubernetes rbac denied"`.

`workloads.list` returns these monitors. It does not list arbitrary cluster objects. An agent that needs `kubectl get pods` uses a separate Kubernetes MCP with its own view role. This server’s answer is the incident: which named workload failed its signal, since when, and the replica counts in `evidence`.

## 15. Status page

Phase 3. One page belongs to one group. Components are the services shown on it, in `sort_order`.

`GET /status/:slug` returns HTML. `GET /status/:slug.json` returns:

```json
{
  "title": "Acme",
  "status": "down",
  "updatedAt": "2026-10-26T18:00:00Z",
  "components": [
    {
      "name": "Payments API",
      "status": "down",
      "role": "owned",
      "uptime90d": 99.9
    }
  ],
  "incidents": [
    {
      "id": "…",
      "service": "Payments API",
      "state": "investigating",
      "startedAt": "…",
      "updates": [{ "state": "investigating", "message": "Automatic: timeout", "at": "…" }]
    }
  ]
}
```

Page `status` is the worst component: `down`, else `degraded`, else `operational`. `UNKNOWN` components are omitted from the worst-of rollup and shown as `unknown`.

`uptime90d` uses duration-weighted uptime.

The SVG badge is a single rectangle and the word operational, degraded, or down. No external assets.

The Atom feed lists incident updates for that page.

Human updates: `POST /incidents/:id/updates` with `state` and `message`. The automatic open and resolve rows are also updates, so the page has a timeline even when nobody types. A human `resolved` update does not by itself close the incident. The check streak closes it. The page shows the latest human state alongside the automatic open or resolved flag.

Private pages require a `read` key and are not linked from public indexes.

Subscribers, phase 6: `POST /status/:slug/subscribers` with an email. Send a confirm link. On open and resolve, email verified subscribers of that page. Include the incident title and a link to the page. Honor a one-click unsubscribe token.

## 16. Operator web UI and the phone

Phase 6 builds a small web UI served by Express from `public/` or a `web/` package. It is an operator surface, not a second backend. It calls the REST API.

Pages:

- Monitor list with status, kind, group, last latency, last check time.
- Create and edit a monitor. The form changes fields based on `kind`. It never asks the operator to paste a password into a field that would be stored in SQLite. It asks for a `secretRef` name.
- Incident detail: checks, updates, acknowledgements.
- Group and status-page editor.
- Alert route editor.
- Maintenance window editor.

The UI can be installed as a browser app (a manifest and a service worker that caches the shell only). That is the desktop window. There is no Electron app and no separate desktop repository.

Phase 7 phone client, only after acknowledgements and alert delivery exist:

- Shows the count of `DOWN` services.
- Lists open incidents: service name, reason, error class, age.
- Shows the last response time for that service.
- Sends an acknowledgement note.
- Receives a push when an incident opens or resolves, and not for any other check.
- Cannot create monitors, change thresholds, edit alert routes, or open charts beyond the last check.

The phone calls `GET /summary` and `POST /incidents/:id/acknowledgements`. `GET /summary` returns `{ downCount, degradedCount, openIncidents }`. Add that route in phase 7 even if the native app is built by someone else.

Customers do not get a native app. They use the status page.

## 17. Retention, on-demand checks, and dependencies

Retention, phase 6. A daily timer inside the monitor process:

- For health checks older than `RETENTION_RAW_DAYS` (default 14), fold each service-hour into `check_rollups` and delete the raw rows.
- Never delete incidents, incident updates, acknowledgements, or alert deliveries in this job.
- Run only on the single monitor replica.

On-demand check, phase 4. `POST /services/:id/check` and `checks.run` call the same cycle as the scheduler, including retries and incident evaluation. The scheduler’s next timeout is measured from the end of that run so two cycles do not overlap. CI uses this after a deploy. A failing result is just a `DOWN` check. The HTTP status of this route is 200 with the `CheckResult` in the body, including when the target is down. Reserve HTTP 4xx and 5xx for the monitor’s own failures.

Dependencies. `role: "dependency"` does not change the state machine. It changes presentation. Incident reason shown to people is prefixed with the service name, and the status page groups dependencies under a heading so a Stripe outage is not drawn as an outage of the checkout component unless checkout’s own check is also down. Register the vendor endpoint as its own monitor.

## 18. Build phases

Each phase ends when its tests pass and the previous phase still passes. `npm test` stays the bar. Add an integration test that registers a service against a local HTTP server, forces the failure threshold, reads the incident, then returns the server to health and reads the resolution.

### Phase 0. Contracts

- Versioned migrations and the columns in section 5. Existing rows become `kind=http` in the default group.
- `Probe` type and registry. HTTP moved under it. `performCheck` remains as a wrapper so current tests import it.
- `CheckResult` gains `status` and `errorClass`.
- Secret reference validator.
- Retry policy that understands a `CheckResult`.
- Create-time check that retries fit in the interval.

Done when: current HTTP tests pass, a migration test upgrades a database created by today’s schema, and a fake probe kind can be registered in a unit test.

### Phase 1. Pipeline and read-only MCP

- Scheduler behavior in section 6, including immediate first check, restart rebuild, and shutdown waiting for in-flight checks.
- Incident machine and alert fan-out to the log sink.
- `GET /services` and `GET /health` stop returning hardcoded status.
- Real metrics from section 11.
- In-process MCP with the phase 1 read tools, resources, and prompts.
- Tests: incident opens at the threshold, stays open on further failures, resolves on one success, a second service with a different threshold is independent, restart does not duplicate an open incident, MCP `incidents.list_open` matches `GET` of the open incidents.

Done when: those tests pass against a temporary SQLite file and a local HTTP server.

### Phase 2. Groups and auth

- Group CRUD and default group.
- API keys, hashes, scopes, group restriction.
- `AUTH_MODE=disabled` remains the test default. One test boots with auth enabled and checks 401, 403, and a group-scoped key.

### Phase 3. Status, alerts, maintenance, Kubernetes run

- Status HTML, JSON, badge, and Atom feed.
- Incident updates.
- Webhook, Slack, and email sinks, plus delivery rows.
- Maintenance windows suppress incidents and alerts and still store checks.
- Manifests in `deploy/k8s/` for the monitor, the MCP proxy, the policy, and the volume.
- MCP proxy process: `MCP_ONLY=true`, no SQLite.

Done when: a status JSON document flips from operational to down in an integration test, a webhook sink receives one POST on open and one on resolve, and `kubectl apply -f deploy/k8s` is described in the file header with the required Secret names. Do not require a cluster in CI.

### Phase 4. Assertions, heartbeats, TLS, TCP, on-demand, Kubernetes watches

- HTTP assertion fields and latency budget.
- Heartbeat create and ping.
- TLS and TCP probes.
- On-demand check.
- Kubernetes probe kinds and RBAC manifest.
- `workloads.list`.

Done when: a body assertion fails closed, a missed heartbeat opens an incident, a certificate inside `downDays` is `DOWN`, and a fake Kubernetes client reporting zero ready replicas opens an incident. The fake client implements the same interface as the real client.

### Phase 5. First data engines

Enable, in this order, each with the contract test from section 12:

1. `postgres`
2. `mysql` (cover MariaDB with the same test against a MariaDB container if CI can run it; otherwise one MySQL test and a note)
3. `mongodb`
4. `redis`

They stay out of `ENABLED_PROBES` in the default env. A dedicated test script enables them.

### Phase 6. Catalog, retention, multi-step, UI, subscribers

- `dns` and `domain`.
- `s3` covering AWS, MinIO, and R2 by config.
- `elastic` covering Elasticsearch and OpenSearch.
- `rabbitmq` HTTP health.
- Optional images and tests for `mssql`, `oracle`, `kafka`, and the cloud SDKs: DynamoDB, Cosmos, SQS, Pub/Sub, Service Bus, Azure Blob, GCS, Azure AI Search, Google search. Each can land as its own pull request. The plan is not done until each row in section 12 has either a module or an explicit comment in `registry.ts` saying it is not loaded.
- Retention job.
- `successThreshold` honored, covered by a test with threshold 2.
- `http.flow` up to five steps.
- Hard delete flag.
- Operator web UI pages from section 16.
- Subscriber confirm and notify.

### Phase 7. Writes, acknowledgement, phone API

- Write MCP tools.
- Acknowledgements.
- `GET /summary`.
- Push sink interface next to `AlertSink`, with one implementation that logs the push payload. A real provider waits on device registration, which is a separate client project. The payload is `{ incidentId, serviceName, kind, reason }`.

## 19. Test map

| File | Covers |
|---|---|
| `tests/checker.test.ts` | Keep. HTTP success, HTTP 500, timeout, refused port. |
| `tests/retry.test.ts` | Keep the throw path. Add the `CheckResult` path: retries `timeout`, does not retry `auth`, persists nothing by itself. |
| `tests/incidents.test.ts` | The pure machine: thresholds, degraded neutrality, maintenance skip, success threshold. |
| `tests/monitor.test.ts` | Open, stay open, resolve, per-service threshold, rebuild after a simulated restart. |
| `tests/mcp.test.ts` | `tools/list` and `tools/call` for `incidents.list_open` against the same fixture as the REST test. |
| `tests/auth.test.ts` | Scopes and group isolation. |
| `tests/probes/*.test.ts` | One contract file per kind. |
| `tests/status.test.ts` | Worst-of rollup and duration uptime. |
| `tests/api.test.ts` | Extend for pause, validation of retry budget, and `UNKNOWN` before the first check. |

CI runs `npm test` and `npm run build`. Probe tests that need Docker are a second script, `npm run test:probes`, so a laptop without Docker can still run the core suite.

## 20. Configuration to add

Add these to `config.ts` and `.env.example` when the phase that reads them starts.

| Variable | Default | Phase |
|---|---|---|
| `AUTH_MODE` | `disabled` | 2 |
| `ENABLED_PROBES` | `http` | 0 |
| `MCP_ENABLED` | `true` | 1 |
| `MCP_ONLY` | `false` | 3 |
| `MONITOR_BASE_URL` | empty | 3 |
| `RETENTION_RAW_DAYS` | `14` | 6 |
| `SQLITE_PROBE_ROOT` | empty | 6 |
| `SMTP_URL` | empty | 3 |
| `SMTP_FROM` | empty | 3 |
| `STATUS_BASE_URL` | `http://localhost:3000` | 3 |

Do not add a variable for a probe password. Passwords arrive through `secretRef`.

## 21. Component checklist

Use this as the completion list. An item is done only when its phase’s test exists and passes.

Process and store

- [ ] Versioned migrations, version 1 marked on current databases
- [ ] Groups, probe columns, evidence, incident error class, update state
- [ ] Alert routes and deliveries
- [ ] API keys stored as hashes
- [ ] Status pages, components, subscribers
- [ ] Maintenance windows
- [ ] Acknowledgements
- [ ] Heartbeat token hashes
- [ ] Hourly rollups and retention
- [ ] `region` column present and unused

Pipeline

- [ ] Probe registry and allowlist
- [ ] HTTP probe moved behind the registry
- [ ] Retry on `CheckResult`, final attempt only persisted
- [ ] Retry budget enforced at create time
- [ ] Self-rescheduling scheduler and immediate first check
- [ ] In-flight shutdown
- [ ] Pure incident machine
- [ ] Startup rebuild without duplicate incidents
- [ ] `DEGRADED` does not open or resolve
- [ ] Maintenance suppresses incidents and alerts
- [ ] `GET /health` reports the real monitor flag
- [ ] `GET /services` reports the latest status or `UNKNOWN`

Doors

- [ ] Application functions shared by REST and MCP
- [ ] MCP `tools/list`, `tools/call`, resources, prompts
- [ ] Phase 1 read tools
- [ ] Phase 7 write tools
- [ ] Auth scopes and group restriction
- [ ] Redaction of secrets in tool output and logs

Notifications and status

- [ ] Log, webhook, Slack, and email sinks
- [ ] Notify on open and resolve only
- [ ] Status HTML, JSON, SVG, Atom
- [ ] Human incident updates
- [ ] Subscriber confirm and send
- [ ] Duration-weighted metrics and monthly group report
- [ ] Operator web UI
- [ ] `GET /summary` and acknowledgement
- [ ] Push payload sink, log implementation

Probes

- [ ] `http` assertions, latency budget, secret header
- [ ] `http.flow`
- [ ] `tcp`
- [ ] `tls`
- [ ] `dns` and `domain`
- [ ] `heartbeat`
- [ ] `postgres`, `mysql`, `mongodb`, `redis`
- [ ] `mssql`, `oracle` optional images
- [ ] `dynamodb`, `cosmos`, `memcached`, `etcd`
- [ ] `elastic` for Elasticsearch and OpenSearch
- [ ] `azureSearch`, `googleSearch`
- [ ] `kafka`, `rabbitmq`, `sqs`, `pubsub`, `servicebus`
- [ ] `s3`, `azureblob`, `gcs`
- [ ] `k8s.deployment`, `k8s.statefulset`, `k8s.cronjob`, `k8s.endpoints`, `k8s.ingressCert`
- [ ] SQLite remains the monitor store, not a remote probe

Kubernetes packaging

- [ ] One monitor replica, PVC, Recreate strategy
- [ ] Stateless MCP deployment, PDB, no SQLite
- [ ] NetworkPolicy
- [ ] Watch RBAC with get and list only
- [ ] No second scheduler while the store is SQLite

Explicitly not in this build

- [ ] Native desktop application
- [ ] Customer native mobile application
- [ ] Multi-region confirmation
- [ ] On-call schedules and escalation policies. Alert routes in section 7 deliver the notification. Who is on call is a later layer.
- [ ] Microsoft Search probe
- [ ] MCP tools that exec into pods or apply manifests
- [ ] Probe queries other than the fixed health signal for that kind

---

# Post-MVP product roadmap: Vision API

Everything below this heading is post-MVP. It must not delay the monitoring MVP described above. Do not begin marketplace implementation until the MVP release gate in section 22 is signed off and the released monitor has been operated successfully.

## 22. Product direction and release gate

### 22.1 Product name and promise

**Vision API** is the proposed product and marketplace name. It begins as a curated directory that helps developers discover APIs and plugins, understand how to evaluate them, and follow reliable setup guides. Over time it can support purchases and subscriptions through the platform, then add integrations that connect the customer's account to an external API.

Keep the responsibilities of the product clear:

- The existing API service monitor monitors endpoints and dependencies selected by a customer.
- Vision API helps a customer discover API products, plugins, and learning material.
- In the first release, Vision API links to the provider's own sign-up, pricing, documentation, or checkout pages. Vision API does not collect money for those providers, claim a subscription exists, or proxy API traffic.
- In a later commerce release, Vision API may sell a provider's subscription as a platform marketplace. This requires provider onboarding, payment processing, subscription lifecycle handling, refunds, disputes, and payout reconciliation.
- In a still later integration release, Vision API may provision or broker API access. This is a separate security-sensitive product layer with customer authorization, credential isolation, usage controls, and provider-specific adapters.

Use one product identity across the web interface, docs, and marketplace. Keep the existing monitor REST API stable. Implement marketplace features as modules and separate tables/routes so the monitor remains useful if marketplace functionality is disabled.

### 22.2 MVP must ship first

The post-MVP roadmap starts only after all of the following are true:

- The MVP scope is written down and frozen for the release. The release owner identifies which earlier plan phases form that scope; do not infer that every future probe engine is an MVP blocker.
- The selected MVP scope is implemented, its acceptance tests pass, `npm test` and `npm run build` pass, and the documented install and upgrade path works from a clean environment.
- A user can install the monitor, create a monitor, see current status, have an incident open and resolve correctly, and receive the promised MVP notifications/status output.
- The release has been deployed and observed in a real environment long enough to exercise restart, database backup/restore, and graceful shutdown procedures.
- There are no known release-blocking data-loss, secret-exposure, or cross-account authorization defects.
- The project has a tagged release and an operator-facing upgrade/rollback note.

If the MVP is limited to phases 0–3, later probe catalog and phone work in phases 4–7 remain separate roadmap work. The Vision API roadmap still waits for the declared MVP release gate, not for every optional integration in the original long-term plan.

### 22.3 Product principles

- Launch discovery before commerce. Validate that users find useful services before accepting money or promising access.
- Keep a listing distinct from a connected integration. A listing can be published with a link; an integration needs a tested adapter and explicit permissions.
- Clearly identify the provider. Show who operates the API, where data is processed, the provider's terms/privacy policy, pricing source, and support route.
- Never claim a provider is vetted, secure, available, or compatible unless the product has a defined review process and evidence.
- Use provider-hosted checkout and onboarding where possible. Vision API must not store card data.
- Keep the billing provider behind an adapter so the app's subscription state does not depend on provider-specific payload shapes.
- Do not put API credentials, payment secrets, or full webhook payloads in public listings, SQLite rows, logs, analytics, or MCP results.
- Marketplace access is opt-in and feature-flagged. Existing monitor-only users can continue without creating a marketplace account.

## 23. Product roles and user journeys

### 23.1 Roles

| Role | Capabilities |
|---|---|
| Visitor | Browse published listings and public guides; follow provider links. |
| Customer | Save listings, manage Vision API account, view any Vision API purchases/subscriptions, and later authorize integrations. |
| Developer/publisher | Create a publisher profile, submit API/plugin listings, manage listing links and documentation, and later connect a billing account or integration. |
| Reviewer/editor | Review, request changes, publish, suspend, and retire listings; edit or approve learning content. |
| Platform administrator | Manage marketplace configuration, reports, moderation, disputes/escalations, and provider integrations. Access is audited. |

The MVP's existing API-key roles are not automatically marketplace user roles. Add user authentication and organization membership explicitly in the post-MVP identity phase. Do not treat an API key as a browser login session.

### 23.2 Customer journey: discovery first

1. Browse by category, use case, provider, supported platform, pricing model, and maturity.
2. Open a listing that explains what it does, what it costs according to the provider's source, what the customer needs before setup, and the exact external links.
3. Read an installation or use guide, with tested steps, code examples, required permissions, and troubleshooting.
4. Click the provider link. Record a privacy-safe outbound click event with listing id and destination id; do not append customer email or monitor credentials to the URL.
5. Optionally save the listing to a personal or team collection.
6. Return to Vision API to mark the service as adopted or add a monitor manually. In this stage, do not imply automatic provisioning or subscription status.

### 23.3 Publisher journey

1. Create a publisher account and verify email.
2. Submit organization identity, support/contact links, ownership evidence for the API domain, and requested categories.
3. Create a draft listing with API name, summary, use cases, capabilities, pricing model, supported regions/platforms, prerequisites, uptime/status links, documentation, terms, privacy policy, and external signup/pricing links.
4. Preview the listing and submit it for review.
5. Reviewer checks link ownership and behavior, required disclosures, guide accuracy, prohibited content, and duplicate/impersonation risk.
6. Reviewer publishes, requests changes, rejects with a reason, or suspends the listing. Every state change is audited.
7. Publisher updates pricing/source URLs and documentation. Material changes re-enter review.
8. In the later commerce stage, complete payment-provider onboarding before a paid offer can be activated.

## 24. Release sequence after the MVP

These become new roadmap phases after section 21, not amendments to the monitor MVP phases. Each phase has a feature flag and an independent rollback path.

### Phase 8. Discovery foundation and Vision API branding

Goal: ship a useful directory of curated external API/plugin links without taking payment or connecting provider credentials.

Scope:

- Establish Vision API naming, navigation, categories, typography/color tokens, and URLs. Keep monitoring screens recognizable and do not rename stable API routes.
- Add a public directory page with search, category filters, paging, empty state, and an explicit "external provider" label.
- Add listing detail pages and provider actions: documentation, pricing, signup, status page, terms, and privacy links.
- Add a minimal editorial workflow: draft, submitted, changes requested, approved, published, suspended, archived.
- Begin with curated listings maintained by an administrator. Publisher self-service is not required in this phase.
- Add listing feedback/report link and a moderation queue. Do not add public star ratings until there is a useful abuse/moderation policy.
- Add privacy-safe outbound click counting and aggregate listing analytics. Do not build individual user tracking profiles.
- Add accessibility, mobile responsive layout, metadata/SEO, and a clear notice that external links leave Vision API.
- Add categories by customer task, such as payments, identity, messaging, storage, observability, AI, data, and developer tooling.
- Listing statuses are visible and truthful: `published`, `temporarily_unavailable`, `under_review`, `retired`.

Data model, introduced through versioned migrations:

```text
marketplace_listings
  id TEXT PRIMARY KEY
  slug TEXT UNIQUE NOT NULL
  publisher_id TEXT NULL             # null for platform-curated seed listings
  name TEXT NOT NULL
  summary TEXT NOT NULL
  description_md TEXT NOT NULL
  category TEXT NOT NULL
  tags_json TEXT NOT NULL
  listing_type TEXT NOT NULL          # api | plugin | service
  status TEXT NOT NULL                # draft | submitted | changes_requested | published | suspended | archived
  pricing_model TEXT NOT NULL         # free | freemium | subscription | usage_based | quote | external
  currency TEXT NULL
  price_summary TEXT NULL             # human-readable; not a billing source of truth
  provider_name TEXT NOT NULL
  provider_domain TEXT NOT NULL
  docs_url TEXT NOT NULL
  signup_url TEXT NULL
  pricing_url TEXT NULL
  status_url TEXT NULL
  terms_url TEXT NOT NULL
  privacy_url TEXT NOT NULL
  regions_json TEXT NOT NULL
  capabilities_json TEXT NOT NULL
  requirements_json TEXT NOT NULL
  review_note TEXT NULL               # internal; never public
  reviewed_by TEXT NULL
  published_at TEXT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

listing_links
  id TEXT PRIMARY KEY
  listing_id TEXT NOT NULL
  label TEXT NOT NULL
  url TEXT NOT NULL
  kind TEXT NOT NULL                  # docs | pricing | signup | status | terms | privacy | support
  sort_order INTEGER NOT NULL
  enabled INTEGER NOT NULL

listing_events
  id INTEGER PRIMARY KEY
  listing_id TEXT NOT NULL
  event_type TEXT NOT NULL            # view | outbound_click | save
  occurred_at TEXT NOT NULL
  coarse_referrer TEXT NULL           # allowlisted host only; no full URL/query string
  visitor_key_hash TEXT NULL          # optional rotating, salted aggregate key; omit if not essential

listing_guides
  id TEXT PRIMARY KEY
  listing_id TEXT NULL                # null for general guides
  slug TEXT UNIQUE NOT NULL
  title TEXT NOT NULL
  summary TEXT NOT NULL
  body_md TEXT NOT NULL
  difficulty TEXT NOT NULL            # beginner | intermediate | advanced
  published INTEGER NOT NULL
  verified_at TEXT NULL
  verified_by TEXT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

listing_reviews
  id TEXT PRIMARY KEY
  listing_id TEXT NOT NULL
  reviewer_id TEXT NOT NULL
  decision TEXT NOT NULL              # approve | changes | reject | suspend
  note TEXT NOT NULL
  created_at TEXT NOT NULL
```

Constraints and operations:

- Validate HTTP(S), reject localhost/private-network URLs, credentials in URLs, unsupported protocols, and redirect chains that end at private addresses. Revalidate destinations when opening redirects to reduce link abuse.
- Use a controlled redirect route such as `/go/:listingId/:linkId`; allow only a stored, reviewed destination. Do not accept an arbitrary `?url=` parameter.
- Sanitize Markdown. No raw scripts, iframes, or untrusted HTML in descriptions or guides.
- Seed listings via a reviewed seed file or migration with source URLs and a last-checked date. Never scrape provider pages without permission.
- Do not promise API quality from a directory listing. Link provider status and terms and show when Vision API last reviewed the listing.
- Keep this module disabled or read-only until authentication and admin review permissions are ready.

Acceptance criteria:

- A visitor can find a listing and open a verified provider destination on desktop and mobile.
- A malformed or private-network destination cannot be published or used as a redirect.
- An editor can preview, publish, suspend, and retire a listing; the public directory reflects the status immediately.
- A published guide has attribution, last verified date, tested prerequisites, and safe copyable code blocks.
- Monitor APIs and the monitor scheduler continue to work with marketplace routes disabled.

### Phase 9. Learning center and adoption workflow

Goal: teach users how to evaluate, install, and use services while clearly separating educational instructions from automated integrations.

Scope:

- Build a learning center with beginner-to-advanced tutorials, glossary, quickstarts, provider-specific setup, and troubleshooting.
- Every provider guide includes: purpose, prerequisites, account setup link, minimum permissions, where credentials are created, local test instructions, production configuration, security notes, cost caveats, common errors, cleanup/disable steps, and links to official docs.
- Show tested version/provider date, test environment, author/reviewer, and compatibility notes. Flag guides that have not been verified recently.
- Use placeholders such as `YOUR_API_KEY`; never paste working credentials into screenshots, examples, test fixtures, or analytics.
- Offer copy buttons and downloadable examples only after secret scanning and linting. Keep examples in a versioned repository/package where possible.
- For monitor adoption, provide a generated example that creates the matching monitor manually through the current REST API or UI. Keep the operation read-only by default and require the user's own API key locally.
- Add tutorials for how to monitor the provider endpoint and distinguish provider failure from an owned service failure.
- Add report-an-error and stale-guide workflow. Reviewer verifies material changes before marking the guide current.
- Support content version history, localization-ready strings, and accessible code snippets.

Acceptance criteria:

- A new user can follow one guide using a provider sandbox/test account and reach a verified success state.
- Every guide has a review date, source links, no real credentials, and a rollback/cleanup section.
- Guide examples do not post user secrets to Vision API.

### Phase 10. Accounts, organizations, and publisher portal

Goal: let customers and API developers manage their own data with access boundaries.

Identity and authorization:

- Add browser user sessions with secure, HTTP-only, SameSite cookies; CSRF protection for state-changing browser requests; password reset and email verification, or a selected OIDC provider.
- Add `users`, `organizations`, `organization_members`, `publisher_profiles`, and invitations with roles `owner`, `admin`, `editor`, `billing`, and `viewer`.
- Make tenant ownership explicit in every customer-owned row and every query. Add tests proving organization A cannot read, update, or infer organization B records.
- Keep platform staff access separate, audited, and minimal.
- Add account export/deletion and retention rules before collecting broad profile information.

Publisher portal:

- Listing CRUD and preview, submission, review feedback, status history, link validation, guide attachment, and change notifications.
- Publisher ownership verification: verify a domain via DNS TXT or a file/token endpoint, plus a manual review fallback. Do not grant a listing ownership based only on an email address.
- Profile includes legal/business name, support URL, privacy/terms, regions served, and payment contact details only when commerce is enabled.
- Moderation tools support reports, duplicate detection, suspension reason, appeal state, and audit history.
- No provider credentials are requested in this phase.

Database additions: users, sessions/identity references, organizations, organization_members, invitations, publisher_profiles, listing ownership/audit records, and an append-only administrative audit log. Add foreign keys and unique constraints; never reuse `group_id` as marketplace organization identity.

Acceptance criteria:

- Publisher can submit and edit only owned listings.
- Reviewer can process submissions but cannot read customer secrets.
- Tenant isolation tests cover all listing, guide, and billing-related query functions as they are introduced.
- Role changes and moderation decisions are auditable.

### Phase 11. Billing visibility for Vision API subscriptions

Goal: show the customer's Vision API marketplace subscriptions and billing state. This is distinct from monitoring external APIs and from any subscription the customer has directly with an external provider.

Clarify the two billing domains in all UI and schema names:

1. **Vision API marketplace purchase:** a subscription purchased through Vision API. This is authoritative in the platform's payment provider and mirrored locally from signed events.
2. **External provider subscription:** a subscription the customer has with a third-party API outside Vision API. Initially show only a user-entered link/note or a provider link; never report its status as verified unless a supported provider integration checks it.

Scope:

- Add a billing page with current subscriptions, provider/listing, plan label, amount/currency, next renewal if known, lifecycle state, invoice/receipt links, cancellation/manage link, and payment issue help.
- Show clear states: `trialing`, `active`, `past_due`, `canceling`, `canceled`, `incomplete`, `unknown`. The local state is a projection; verify against the provider event stream and periodic reconciliation.
- Add a billing adapter interface (`createCheckout`, `createPortalSession`, `verifyWebhook`, `fetchSubscription`, `refund` only when approved). Keep provider identifiers in a provider mapping table and never leak them publicly.
- For a first processor, evaluate Stripe Connect for marketplace transactions. Provider onboarding and funds flow must be selected before coding. A plain hosted pricing table is not sufficient for a platform fee/marketplace flow; Stripe documents subscription Connect fees and transfers separately. See [Stripe subscription Connect fields](https://docs.stripe.com/api/subscriptions/update) and [Stripe subscription management](https://docs.stripe.com/api/subscriptions).
- Keep a standalone billing adapter, normalize webhook events, verify signatures, store provider event IDs under a unique constraint, make event handlers idempotent, and recover from out-of-order delivery with fetch/reconciliation.
- Use provider-hosted checkout and customer portal where supported. The platform must not see or store card numbers or security codes.
- Store money as integer minor units plus ISO currency. Do not use floating-point arithmetic.
- Show the source and timestamp for next renewal; if the provider does not supply it, omit it rather than calculate a misleading value.
- Do not mirror card details, bank account data, full invoices, or raw payment webhook bodies into app logs.
- Build admin reconciliation view for subscription count/status mismatches and failed webhook processing.
- Add billing emails/notifications only with customer preferences and verified addresses.

Suggested schema:

```text
marketplace_offers
  id TEXT PRIMARY KEY
  listing_id TEXT NOT NULL
  publisher_id TEXT NOT NULL
  plan_name TEXT NOT NULL
  billing_interval TEXT NOT NULL        # month | year | usage (only when supported)
  amount_minor INTEGER NOT NULL
  currency TEXT NOT NULL
  provider_price_ref TEXT NULL
  status TEXT NOT NULL                  # draft | active | retired
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

payment_accounts
  id TEXT PRIMARY KEY
  publisher_id TEXT NOT NULL
  processor TEXT NOT NULL
  processor_account_ref TEXT NOT NULL
  onboarding_state TEXT NOT NULL
  charges_enabled INTEGER NOT NULL
  payouts_enabled INTEGER NOT NULL
  requirements_state TEXT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

marketplace_subscriptions
  id TEXT PRIMARY KEY
  organization_id TEXT NOT NULL
  offer_id TEXT NOT NULL
  processor TEXT NOT NULL
  processor_customer_ref TEXT NOT NULL
  processor_subscription_ref TEXT NOT NULL UNIQUE
  state TEXT NOT NULL
  period_start TEXT NULL
  period_end TEXT NULL
  cancel_at_period_end INTEGER NOT NULL
  canceled_at TEXT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

payment_events
  id TEXT PRIMARY KEY
  processor TEXT NOT NULL
  processor_event_ref TEXT NOT NULL
  event_type TEXT NOT NULL
  received_at TEXT NOT NULL
  processed_at TEXT NULL
  processing_state TEXT NOT NULL
  safe_error_code TEXT NULL
  UNIQUE(processor, processor_event_ref)

marketplace_invoices
  id TEXT PRIMARY KEY
  subscription_id TEXT NOT NULL
  processor_invoice_ref TEXT NOT NULL UNIQUE
  amount_due_minor INTEGER NOT NULL
  amount_paid_minor INTEGER NOT NULL
  currency TEXT NOT NULL
  state TEXT NOT NULL
  hosted_invoice_url TEXT NULL
  period_start TEXT NULL
  period_end TEXT NULL
  created_at TEXT NOT NULL
```

The exact processor data model, payment responsibility, tax handling, merchant-of-record status, refund/dispute responsibility, and permitted countries require a documented business decision before Phase 11 implementation. Payment provider capabilities and terms change; verify against current official documentation during implementation.

Acceptance criteria:

- Billing page shows only the signed-in user's organization subscriptions.
- A verified provider webhook can create, update, and cancel a local subscription projection exactly once, even if delivered repeatedly.
- A bad signature is rejected; an unknown event is retained safely and does not change entitlement.
- A simulated missed/out-of-order event is repaired by reconciliation.
- Cancellation clearly states whether access ends immediately or at period end.
- Customer can reach a provider-hosted management page without the app handling payment details.

### Phase 12. Paid marketplace launch and revenue sharing

Goal: allow approved publishers to sell an API/plugin subscription through Vision API and let customers manage it in the billing page.

Before opening checkout:

- Pick countries/currencies, supported customer and publisher types, merchant-of-record/payment responsibility, fee model, payout timing, refund and cancellation policy, dispute handling, tax treatment, sanctions/fraud review, and support escalation.
- Complete a provider sandbox launch checklist and reconcile test payments, renewals, failed payments, cancellation, refund, chargeback, publisher onboarding, and payout reports.
- Confirm the selected processor supports the desired subscription flow and platform fee model in every launch country. Stripe Connect provides connected-account and application-fee concepts, but the appropriate charge model changes which party handles payment fees and losses; make this decision from current official docs before build.
- Publish marketplace terms for customers and publishers, acceptable-use rules, prohibited API categories, IP/license expectations, privacy disclosures, refund policy, and how external providers are responsible for their service.
- Create operational procedures and dashboards for unhandled webhooks, failed payouts, pending onboarding, disputes, refunds, and publisher suspensions.

Implementation:

- Create an offer associated with a published listing. Keep public marketing price copy separate from authoritative offer amount and provider price reference.
- Enable checkout only if listing is published, offer active, publisher onboarding requirements are satisfied, and the region/currency is allowed.
- Prefer hosted checkout. Bind checkout to the authenticated customer and organization on the server; never trust customer or offer IDs supplied by a browser without reauthorization.
- Use idempotency keys for checkout creation and all payment mutations.
- Activate entitlement only after a verified provider event or authoritative provider read. A browser success redirect is not proof of payment.
- Handle renewal, payment failure, grace period, cancellation, refund, dispute, and publisher account restriction as explicit state transitions.
- Apply platform fees only from server-side approved configuration. Record gross, fees, tax values from provider, net amounts, currency, and transfer references in a reconciliation ledger.
- Admin refund and suspension actions require role checks, reason, audit entry, and a confirmation UX.
- Provide exportable customer/publisher transaction statements and internal monthly reconciliation.

Acceptance criteria:

- Sandbox end-to-end: publisher onboards, offer is approved, customer subscribes, webhooks activate entitlement, invoice appears, customer cancels, and the state matches provider records.
- Duplicate checkout requests do not create duplicate paid subscriptions.
- A failed or delayed payment does not appear as active access unless policy explicitly grants a documented grace period.
- A publisher who loses eligibility cannot receive new checkouts; existing customers receive a clear continuity/refund/support path.
- Financial totals reconcile by provider, currency, period, and payout status.

### Phase 13. Service connections and API access brokering

Goal: move from links and instructions toward user-authorized service connections, one provider at a time.

#### Stage 13A: customer-side connections

- Add an `IntegrationProvider` contract with `authorize`, `validate`, `healthCheck`, `disconnect`, and optional `syncMetadata` operations.
- Add a provider manifest: id/version, capabilities, auth type, OAuth scopes, callback URLs, required configuration fields, region support, rate limits, data retention, and documentation link.
- Start with one low-risk provider and sandbox. Choose from actual usage data rather than implementing the whole directory.
- Prefer OAuth authorization code with PKCE and narrowly scoped provider grants. For static API keys, accept them through a one-time secure form, encrypt at rest with a managed key, support rotation, and never reveal the value again.
- Keep credential encryption keys outside SQLite and outside source control. Add key versioning and rotation; include backups and restore tests for encrypted credentials.
- Store integration state per organization and provider. Isolate credentials by tenant and provider; a probe gets a short-lived secret only for its check.
- Add explicit connect, reauthorize, rotate, disconnect, revoke, and delete actions, with audit entries and status display.
- Before declaring a connection available, verify credential scopes and run a non-mutating health signal. Never test by creating a real resource or sending a message.
- Add tests for missing scope, expired grant, revoked token, provider throttling, and cross-tenant access.

#### Stage 13B: managed API gateway/proxy (separate decision)

This is required only if “we become a middleman” means customer application traffic passes through Vision API, or Vision API issues managed API credentials. A listing directory and a billing page do not require a proxy.

Required design before implementation:

- Define exactly what traffic is proxied, supported protocols, body/file limits, streaming, timeouts, retries, idempotency, and regions.
- Define whether Vision API or the external provider is the service provider to the end customer, and who is responsible for provider terms, data handling, abuse, uptime, refunds, and customer support.
- Create per-tenant credentials with one-time display, hashing for verification, revocation, rotation, scopes, allowed products, and rate limits.
- Store provider credentials in a managed secret store or encrypted vault. The gateway retrieves them server-side and never forwards them to browsers, MCP results, logs, traces, or error pages.
- Implement usage metering at the gateway with a durable append-only event/outbox, request id, tenant id, provider, units, status, and timestamp. Exclude bodies, authorization headers, and sensitive query parameters by default.
- Define a billing meter and reconciliation source of truth. A request is not billable until the provider/pricing contract defines its unit and dispute rules.
- Add per-customer quotas, burst limits, spend caps, provider circuit breakers, abuse detection, and a kill switch by tenant/provider.
- Add SSRF protection, destination allowlists, DNS rebinding protections, TLS verification, egress policy, request/response size limits, safe header allowlists, and protection against proxying arbitrary URLs.
- Add data retention/deletion, DPA/security review, incident response, and provider contract review before production traffic.
- Keep gateway deployment isolated from the monitoring scheduler and public directory. It must not share the SQLite volume or secrets with the probe process.
- Load test and conduct security review before public release.

Acceptance criteria:

- A customer explicitly grants and can revoke access; no provider credential is visible after save.
- A tenant cannot use another tenant's integration or consume its quota.
- Every proxied request has a correlatable usage record without capturing secrets or payloads.
- Rate limit and kill switch take effect promptly and fail closed.
- Provider outage and Vision API gateway outage can be distinguished in status and support tooling.

### Phase 14. Marketplace catalog expansion and ecosystem

Only after discovery and one paid provider have stable operations:

- Add developer SDKs, command-line helper, templates, and plugin packages as demand supports them.
- Add team collections, bookmarks, comparison pages, and private curated catalogs.
- Add publisher analytics: aggregate views, outbound clicks, conversion events supplied by checkout, active subscriptions, churn, and refund totals. Show only the publisher's own listings and aggregate data.
- Add verified compatibility badges tied to a defined test harness and review date.
- Add integrations to monitoring: create a monitor from a listing with a reviewed endpoint template, then let the customer enter their own credentials/secret reference. Do not silently create connections or monitors from a directory click.
- Add API version/change notices and guide update alerts.
- Consider ratings/reviews only with verified-purchase/verified-use rules, moderation, appeals, and anti-manipulation controls.
- Expand to more processors/providers only through adapters and repeatable certification tests.

## 25. Post-MVP architecture and code layout

Keep the current monitor application layer as the core. Add separate modules with explicit dependency direction:

```text
src/
  marketplace/
    listings/              # public catalog, filtering, link redirect
    guides/                # educational content and publishing status
    publishers/            # profiles, ownership verification, reviews
    billing/
      contracts.ts         # provider-neutral checkout/subscription interfaces
      stateMachine.ts      # local normalized subscription transitions
      webhooks.ts          # signature validation, idempotency, event queue
      reconciliation.ts
      providers/           # processor-specific adapter, initially one
    integrations/
      contracts.ts
      registry.ts
      credentials.ts       # encryption boundary / secret-store adapter
      providers/           # one API integration per module
    gateway/               # only if Phase 13B is approved
  auth/
    webSessions.ts
    organizations.ts
    permissions.ts
  audit/
    writer.ts
```

REST route handlers and browser pages call application functions. Provider SDKs are imported only by provider adapters. Payment webhooks call the normalized billing application service. Publisher listing state must not be used as proof of entitlement. A payment subscription must not be used as proof that a provider API credential is valid.

New process boundaries when scale requires them:

- `monitor-api`: REST, monitoring, probes; retains the one-scheduler rule while SQLite is used.
- `mcp`: stateless agent surface calling monitor application/API.
- `web`: operator and Vision API pages, potentially same deployment initially.
- `billing-worker`: asynchronous webhook processing and reconciliation; may share process at low volume, but it must have durable event state and idempotent handlers.
- `gateway`: only if managed API traffic is implemented; isolated network, secrets, compute, and scaling.

Do not create microservices before deployment/operational needs justify them. Modules and interfaces come first; process separation can follow.

## 26. Post-MVP API and permission outline

Public endpoints, unauthenticated but rate-limited:

- `GET /marketplace/listings?query=&category=&type=&page=`
- `GET /marketplace/listings/:slug`
- `GET /marketplace/listings/:listingId/guides`
- `GET /learn/:slug`
- `GET /go/:listingId/:linkId` (only for stored, enabled, reviewed destinations)

Authenticated customer endpoints:

- `GET /me/subscriptions`
- `GET /me/subscriptions/:id`
- `POST /marketplace/offers/:id/checkout` (Phase 12 only; server resolves user/org and offer)
- `POST /me/billing-portal` (Phase 11+)
- `POST /me/listings/:id/save`
- `GET /me/integrations` and connect/disconnect routes (Phase 13A only)

Publisher endpoints:

- `POST /publisher/listings`, `PATCH /publisher/listings/:id`, `POST /publisher/listings/:id/submit`
- `GET /publisher/listings/:id/metrics`
- Offer management routes only after commerce approval.

Staff-only endpoints:

- Review queue, approve/request changes/reject/suspend, audit search, webhook retry, reconciliation, refund actions. Every mutation requires staff scope, CSRF protection for browser actions, and audit record.

Payment provider webhook:

- `POST /webhooks/billing/:provider`; raw request body is used only for provider signature verification, then event is normalized, deduplicated, and queued/processed. Do not protect it with a browser session, but do enforce provider signature, payload limit, and replay/idempotency checks.

Authorization rules:

- Public read can see published listings and published guides only.
- Publisher access is constrained by verified listing ownership.
- Customer billing visibility is constrained to organization membership and billing role where appropriate.
- Marketplace staff mutations are separately authorized and audited.
- `read/write/admin` monitor API keys do not grant marketplace staff or publisher privileges.

## 27. Operating, privacy, and security requirements

- Feature flags: `VISION_MARKETPLACE_ENABLED`, `VISION_PUBLISHER_PORTAL_ENABLED`, `VISION_BILLING_ENABLED`, `VISION_INTEGRATIONS_ENABLED`, `VISION_GATEWAY_ENABLED`. Default all off until each phase is ready. Never use a feature flag as an authorization check.
- Add rate limits for public search, redirect, account creation, login, publisher submission, checkout creation, webhook endpoints, and integration callbacks.
- Audit publisher approval, listing ownership changes, plan/price changes, subscription state changes, refunds, staff access, integration grants/revokes, and gateway credential actions.
- Encrypt session tokens and provider credentials appropriately. Hash passwords with a modern password hash if password auth is selected. Hash API tokens; never store their clear text.
- Define data inventory, collection purpose, retention, deletion, user export, subprocessors, and incident response before billing or gateway launch.
- Avoid third-party analytics that receive provider credentials, billing details, full referrers, or customer API traffic.
- Use CSP, CSRF defense, output escaping, secure cookies, webhook signature verification, request-size caps, dependency scanning, and secret scanning.
- Add backups and restore drills for all new state. Payment and integration state must not rely on an unbacked local SQLite volume in a multi-replica production setup.
- Add alerts for failed billing event processing, reconciliation drift, expired publisher onboarding, high checkout failure, abnormal outbound redirect, and gateway quota/error spikes.
- Keep external-provider uptime data separate from Vision API platform uptime. The monitor can monitor Vision API itself, but marketplace providers are customer dependencies.

## 28. Success measures and launch gates

Discovery phase measures:

- Search-to-listing open rate and outbound click rate by category.
- Guide starts and completion feedback, with no collection of secrets or code contents.
- Percentage of listings with working docs/pricing/status links and current review dates.
- User-reported stale, misleading, or unsafe listing rate.

Publisher phase measures:

- Submission-to-review time, approval/change-request rates, listing link health, and active publishers.

Commerce phase measures:

- Checkout completion, payment failure/recovery, cancellation, refund, dispute, payout failures, reconciliation drift, and support response time.
- Gross volume, platform fee, processor fees, taxes, refunds, and net payout are separate values; do not report gross volume as revenue.

Integration phase measures:

- Successful connection, authorization expiry/revocation, health check success, provider rate limits, credential rotation, and tenant-isolation incidents.

Do not use growth metrics to override security, accuracy, or provider transparency gates. Each phase launches only when its acceptance criteria pass, support ownership is assigned, and rollback/disable instructions are tested.

## 29. Post-MVP implementation checklist

Vision API directory and learning:

- [ ] MVP release gate signed off before starting this roadmap
- [ ] Vision API product identity and feature flags
- [ ] Curated API/plugin listing model, search, categories, detail pages
- [ ] Verified external links and safe redirect service
- [ ] Editorial review, moderation, suspension, archive, audit trail
- [ ] Privacy-safe aggregate outbound metrics
- [ ] Learning center, source attribution, tested dates, cleanup instructions
- [ ] No real secrets in docs, screenshots, examples, or analytics
- [ ] Listing feedback and stale-content reports

Publisher and customer identity:

- [ ] Browser identity and organization membership
- [ ] Publisher ownership/domain verification
- [ ] Tenant isolation and role tests
- [ ] Publisher listing portal and review queue
- [ ] Account export/deletion and retention policy

Billing and subscriptions:

- [ ] Distinguish Vision API subscriptions from external provider subscriptions
- [ ] Processor/provider decision and documented funds/responsibility model
- [ ] Billing adapter and normalized subscription state machine
- [ ] Hosted checkout and billing portal
- [ ] Signed, idempotent webhook processing and reconciliation
- [ ] Billing page, invoices/receipts, renewal/cancel states
- [ ] Refund, dispute, tax, payout, and support operating procedures
- [ ] End-to-end sandbox and financial reconciliation

Connections and brokerage:

- [ ] Provider integration contract and registry
- [ ] Customer consent, least-privilege OAuth or protected credential entry
- [ ] Encryption, rotation, revoke, delete, and audit lifecycle
- [ ] Health check and provider sandbox test per adapter
- [ ] Gateway business/security decision before any traffic proxying
- [ ] Tenant quotas, metering, spend controls, abuse response, kill switch
- [ ] Gateway isolation and load/security review

## 30. Recommended build order

1. Ship and operate the monitoring MVP.
2. Build a curated, link-only Vision API directory with tested guides.
3. Measure discovery and maintain a real editorial review process.
4. Add customer accounts and publisher submissions with ownership verification.
5. Add billing visibility and a hosted billing portal for Vision API subscriptions.
6. Pilot paid marketplace subscriptions with a small number of approved publishers and a sandbox-to-production checklist.
7. Add one customer-authorized integration based on measured demand.
8. Decide separately whether API traffic brokering is necessary; if it is, build and operate the isolated gateway as its own major product phase.

This order supports the initial plan to start with links, while creating a controlled path toward paid subscriptions and connected services. It does not assume that all APIs can be connected through one generic adapter: each provider needs its own contract, authorization model, test suite, and support path.
