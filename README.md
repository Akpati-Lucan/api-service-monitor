# API Reliability & Incident Monitoring Service — Design Document

**Version:** 1.0
**Author:** [Your name]
**Status:** Draft for review
**Last updated:** 2026-08-13

---

## 1. Overview

### 1.1 Problem statement

Small teams running multiple internal or external APIs rarely have visibility into their health until a customer complains. They need a lightweight, self-hosted service that:

- Periodically checks whether registered endpoints are up
- Tracks response time and error rates over time
- Detects and records incidents (sustained outages) automatically
- Exposes this data through a simple REST API

### 1.2 Goals

- Register and manage a list of monitored services (URLs)
- Poll each service on a configurable interval
- Persist health check results with enough history to compute uptime and metrics
- Detect incidents (N consecutive failures → DOWN) and auto-resolve them on recovery
- Be resilient itself: retries, timeouts, graceful shutdown, structured logs
- Be trivially runnable via Docker Compose
- Be well-tested at the unit and integration level

### 1.3 Non-goals (v1)

- Multi-tenant auth / user accounts (single-operator tool for v1; see §10)
- Alerting integrations (Slack/PagerDuty/email) — stubbed as an interface, not required to ship
- Distributed/multi-node scheduling — single-process scheduler is sufficient at this scale
- A frontend UI — API-only for v1

---

## 2. High-Level Architecture

```
                        ┌─────────────────────────┐
                        │        HTTP API          │
                        │   (Express / Fastify)    │
                        └────────────┬─────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 │                   │                   │
        ┌────────▼───────┐ ┌─────────▼────────┐ ┌────────▼────────┐
        │  services.ts     │ │   health.ts       │ │  incidents.ts    │
        │  (CRUD routes)   │ │  (liveness route) │ │  (nested routes) │
        └────────┬─────────┘ └───────────────────┘ └────────┬─────────┘
                 │                                          │
                 │              ┌───────────────────────────┘
                 ▼              ▼
        ┌─────────────────────────────────┐
        │           monitor.ts             │   Scheduler: owns setInterval
        │  (orchestrates checks, owns      │   per service, applies backoff,
        │   scheduling & lifecycle)        │   feeds results to incident logic
        └────────────┬─────────────────────┘
                      │
             ┌────────▼────────┐
             │   checker.ts     │   Single responsibility: perform one
             │  (HTTP probe +   │   HTTP check with timeout + retry
             │   retry/timeout) │
             └────────┬────────┘
                      │
             ┌────────▼────────┐
             │   database.ts    │   SQLite (v1) via better-sqlite3 or
             │  (persistence)   │   Prisma; swappable for Postgres later
             └─────────────────┘
```

**Process model:** a single Node.js process runs both the HTTP API and the in-memory scheduler. This keeps deployment trivial (one container, no external queue) while still being architecturally honest about where the boundaries are, so it could be split into an API service + worker service later without a rewrite.

---

## 3. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Type safety across DB rows, API payloads, and internal events |
| HTTP framework | Express (or Fastify) | Minimal, well understood, easy to explain in an interview |
| Database | SQLite (`better-sqlite3`) | Zero external dependencies for local/demo use; synchronous API simplifies the scheduler code |
| ORM/Query layer | Raw SQL + a thin migration runner, or Prisma | Raw SQL keeps the "what's actually happening" story clear for a systems-focused interview |
| Validation | `zod` | Runtime validation of request bodies and env config from a single schema |
| HTTP client (for checks) | native `fetch` (Node 18+) with `AbortController` | No extra dependency needed for timeouts |
| Logging | `pino` (or a small custom JSON logger) | Structured JSON logs by default |
| Testing | `vitest` or `jest` + `supertest` | Fast unit tests, HTTP-level integration tests |
| Containerization | Docker + docker-compose | One-command run |

---

## 4. Data Model

### 4.1 Entities

**Service**
| Column | Type | Notes |
|---|---|---|
| id | TEXT (uuid) | PK |
| name | TEXT | required |
| url | TEXT | required, validated as URL |
| interval_seconds | INTEGER | default 60 |
| timeout_ms | INTEGER | default 5000 |
| failure_threshold | INTEGER | default 3 (consecutive failures → incident) |
| created_at | DATETIME | |
| is_active | BOOLEAN | soft-disable without deleting history |

**HealthCheck** (append-only log; one row per probe attempt's *final* outcome, after retries)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK, autoincrement |
| service_id | TEXT | FK → Service |
| status | TEXT | `UP` \| `DOWN` |
| http_status | INTEGER \| NULL | null on network error/timeout |
| response_time_ms | INTEGER \| NULL | |
| error | TEXT \| NULL | e.g. `"timeout"`, `"ECONNREFUSED"` |
| checked_at | DATETIME | |

**Incident**
| Column | Type | Notes |
|---|---|---|
| id | TEXT (uuid) | PK |
| service_id | TEXT | FK → Service |
| started_at | DATETIME | timestamp of the check that crossed the failure threshold |
| resolved_at | DATETIME \| NULL | null while ongoing |
| reason | TEXT | e.g. `"HTTP 503"`, `"timeout"` |
| duration_seconds | INTEGER \| NULL | computed on resolution |

### 4.2 Indexes

- `HealthCheck(service_id, checked_at)` — for time-range metric queries and uptime calculation
- `Incident(service_id, resolved_at)` — to quickly find the *open* incident for a service (`resolved_at IS NULL`)

### 4.3 Derived metrics (computed, not stored)

- **Uptime %** over a window = `UP checks / total checks` in that window (or duration-weighted, see §7.3)
- **Average response time** over a window
- **Current status** = status of the most recent HealthCheck row

---

## 5. API Design

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/services` | Register a new service |
| `GET` | `/services` | List all services with current status summary |
| `GET` | `/services/:id` | Get one service's detail |
| `DELETE` | `/services/:id` | Remove a service (and stop monitoring it) |
| `GET` | `/services/:id/incidents` | List incidents for a service |
| `GET` | `/services/:id/metrics` | Uptime %, avg response time, check count, over a time window |
| `GET` | `/health` | Liveness/readiness of the monitor service itself |

### 5.1 `POST /services`

Request:
```json
{
  "name": "Payment API",
  "url": "https://example.com/health",
  "intervalSeconds": 30,
  "timeoutMs": 5000,
  "failureThreshold": 3
}
```
Validation (via zod): `name` non-empty; `url` must parse as a valid absolute URL; numeric fields must be positive integers with sane bounds (e.g. `intervalSeconds >= 5`). Invalid input → `400` with a field-level error list.

Response `201`:
```json
{
  "id": "b1e3...",
  "name": "Payment API",
  "url": "https://example.com/health",
  "intervalSeconds": 30,
  "timeoutMs": 5000,
  "failureThreshold": 3,
  "isActive": true,
  "createdAt": "2026-08-13T13:40:00Z"
}
```
Side effect: the scheduler immediately registers a polling job for this service (see §7.1) and runs the first check right away rather than waiting a full interval.

### 5.2 `GET /services`

Response `200`:
```json
[
  {
    "id": "b1e3...",
    "name": "Payment API",
    "status": "UP",
    "lastCheckedAt": "2026-08-13T14:03:21Z",
    "responseTimeMs": 142,
    "uptime24h": 99.91
  }
]
```

### 5.3 `GET /services/:id`

Same shape as one list item, plus config fields (`url`, `intervalSeconds`, etc). `404` if not found.

### 5.4 `DELETE /services/:id`

Stops the scheduler job, marks the service inactive (soft delete keeps history queryable) or hard-deletes per a `?hard=true` flag. Returns `204`.

### 5.5 `GET /services/:id/incidents`

Query params: `?status=open|resolved`, `?limit=`, `?before=` (cursor pagination).

Response `200`:
```json
[
  {
    "id": "8f2a...",
    "startedAt": "2026-08-13T13:42:00Z",
    "resolvedAt": "2026-08-13T13:47:12Z",
    "durationSeconds": 312,
    "reason": "HTTP 503"
  }
]
```

### 5.6 `GET /services/:id/metrics`

Query params: `?window=1h|24h|7d` (default `24h`).

Response `200`:
```json
{
  "window": "24h",
  "uptimePercent": 99.91,
  "avgResponseTimeMs": 138,
  "totalChecks": 2880,
  "failedChecks": 2,
  "incidentCount": 1
}
```

### 5.7 `GET /health`

```json
{
  "status": "healthy",
  "database": "connected",
  "monitor": "running",
  "activeServices": 4
}
```
Returns `503` with `"status": "unhealthy"` if the DB ping fails or the scheduler has crashed. This is what a container orchestrator (or `docker-compose` healthcheck) would poll.

### 5.8 Error format

Consistent JSON error envelope for all non-2xx responses:
```json
{ "error": { "code": "NOT_FOUND", "message": "Service b1e3 does not exist" } }
```

---

## 6. Core Component Design

### 6.1 `checker.ts` — single probe execution

Responsibility: given a URL and timeout, perform **one** HTTP GET and return a normalized result. Knows nothing about retries, services, or the database.

```ts
interface CheckResult {
  ok: boolean;
  httpStatus?: number;
  responseTimeMs: number;
  error?: string; // "timeout" | "network_error" | undefined
}

async function performCheck(url: string, timeoutMs: number): Promise<CheckResult>
```

Implementation notes:
- Uses `AbortController` to enforce `timeoutMs` — this is the mechanism that prevents one hung API from blocking the worker (per the "timeouts" production requirement).
- Treats HTTP 2xx as `ok: true`; 3xx follows redirects by default (or configurable); 4xx/5xx as `ok: false` but still records `httpStatus`.
- Distinguishes a *reached-but-unhealthy* service (got a 500) from an *unreachable* service (DNS failure, connection refused, timeout) — both matter for incident `reason`.

### 6.2 `retry.ts` — retry wrapper

Responsibility: generic exponential-backoff retry, decoupled from HTTP specifics so it's independently unit-testable.

```ts
interface RetryOptions {
  retries: number;       // e.g. 2 (→ up to 3 total attempts)
  baseDelayMs: number;   // e.g. 1000
  factor: number;        // e.g. 2 → 1s, 2s, 4s...
}

async function withRetry<T>(fn: () => Promise<T>, isRetryable: (r: T) => boolean, opts: RetryOptions): Promise<T>
```

Used as:
```
attempt 1 (fails) → wait 1s → attempt 2 (fails) → wait 2s → attempt 3 (fails)
→ final result reported as DOWN
```
This matches the flow diagram in the brief: request fails → retry after 1s → fails → retry after 2s → fails → mark unhealthy. The **final, post-retry** result is what gets written to `HealthCheck` — intermediate retry attempts are not persisted as separate rows (kept as debug-level log lines instead), so uptime math isn't skewed by transient retries.

### 6.3 `monitor.ts` — scheduler & orchestration

Responsibility: own the mapping of `serviceId → interval timer`, call `checker` (wrapped in `retry`), persist the result, and feed it into incident detection.

Key behaviors:
- `start(service)`: registers a `setInterval` (or a self-rescheduling `setTimeout`, preferred — see below) for the service, and fires an immediate first check.
- `stop(serviceId)`: clears the timer; called on delete/deactivate.
- **Self-rescheduling `setTimeout` instead of `setInterval`** is preferred: schedule the *next* check only after the current one (including retries) finishes. This prevents overlapping checks from piling up if a service is slow to respond, which a naive `setInterval` would allow.
- On each result: write a `HealthCheck` row, then call `evaluateIncident(service, result)`.

### 6.4 Incident detection logic

State machine per service, driven by consecutive failure/success counts (kept in memory, reconstructible from the last N `HealthCheck` rows on startup):

```
UP  --(failure)-->  UP (count=1)
UP(count=1) --(failure)--> UP(count=2)
UP(count=2) --(failure, count reaches threshold)--> DOWN, create Incident{startedAt, reason}
DOWN --(failure)--> DOWN (incident stays open)
DOWN --(success)--> UP, close open Incident{resolvedAt, durationSeconds}
```

Notes:
- The threshold is per-service (`failure_threshold`, default 3) rather than global, since a flaky low-priority service and a critical payment API may warrant different sensitivity.
- Recovery is single-success-triggers-close in v1 (simple, matches the brief's diagram). A future enhancement is a symmetric "N consecutive successes to resolve" to avoid flapping — noted in §10.
- On process restart, the in-memory failure-count state is rebuilt by reading each active service's most recent `HealthCheck` rows and any already-open `Incident` row, so a restart doesn't lose incident continuity.

### 6.5 `alert.ts`

v1 ships this as an interface with a single console/log implementation, so the seam exists without committing to a specific provider:

```ts
interface AlertSink {
  notify(event: { service: Service; incident: Incident; kind: 'opened' | 'resolved' }): Promise<void>;
}
```
A `LoggingAlertSink` is the default. This is where a Slack/webhook/email sink would plug in later without touching `monitor.ts`.

### 6.6 `logger.ts` — structured logging

All logs are JSON objects, not strings, e.g.:
```json
{ "level": "error", "service": "payment-api", "statusCode": 503, "responseTimeMs": 812, "timestamp": "2026-08-13T14:03:21Z" }
```
Log levels: `debug` (individual retry attempts), `info` (check completed, service registered), `warn` (approaching failure threshold), `error` (incident opened), plus request logs for the HTTP layer.

---

## 7. Key Design Decisions & Trade-offs

### 7.1 Immediate first check on registration
When a service is registered, run a check right away instead of waiting a full `intervalSeconds`. Better UX (`GET /services` shows real data immediately) at negligible cost.

### 7.2 Self-scheduling timers vs. a cron-style poller
A single external "tick every N seconds, check everything due" loop is an alternative that scales better if this ever needs to run across many processes, but self-rescheduling per-service timers are simpler to reason about and sufficient at the scale implied by "a small company's several APIs." Documented as a known scaling limit (§9).

### 7.3 Simple ratio uptime vs. duration-weighted uptime
`UP checks / total checks` is easy to compute but is biased by check interval consistency. A more correct measure integrates *time* spent DOWN vs UP using incident start/end timestamps. v1 uses the simple ratio for `/metrics` and documents the limitation; duration-weighted uptime is a natural v1.1 improvement since the `Incident` table already has the data needed.

### 7.4 SQLite vs Postgres
SQLite removes an external dependency, which matters for a `docker compose up`-and-go demo and for keeping the interview conversation focused on the app's own logic. The `database.ts` module is written against a small internal interface (`getService`, `insertHealthCheck`, `openIncident`, ...) so swapping the backing store doesn't touch business logic elsewhere.

### 7.5 Retry budget vs. check interval
Retries must complete well within the check interval, or checks start backing up. With `retries=2, baseDelayMs=1000, factor=2`, worst case is ~1s + 2s = 3s of backoff plus request time — safe for the default 30–60s interval, but this constraint (`total retry time < interval`) is validated at service-creation time and documented, not just assumed.

---

## 8. Reliability & Operational Concerns

| Concern | Approach |
|---|---|
| **Retries** | Exponential backoff, capped attempts, implemented in `retry.ts` and unit tested in isolation |
| **Timeouts** | `AbortController`-based per-request timeout in `checker.ts`; a hung upstream API cannot hang the monitor |
| **Health endpoint** | `GET /health` checks DB connectivity and scheduler liveness, returns 200/503 accordingly |
| **Structured logging** | JSON logs via `pino`; every log line carries `service`, `timestamp`, and relevant status fields |
| **Graceful shutdown** | `SIGTERM`/`SIGINT` handlers: stop accepting new HTTP connections, clear all scheduler timers, let in-flight checks finish (bounded by their own timeout), close the DB handle, then exit |
| **Config** | All tunables (`PORT`, `DB_PATH`, default interval/timeout/threshold, retry settings) via environment variables, validated at boot with `zod`; documented in `.env.example` |
| **Containerization** | `Dockerfile` (multi-stage: build TS → slim runtime image) + `docker-compose.yml` exposing the API port and mounting a volume for the SQLite file |

---

## 9. Known Limitations (v1)

- Single-process scheduler: doesn't horizontally scale past what one Node process can poll on schedule; fine for "a handful of APIs," not for hundreds.
- No auth on the API — anyone who can reach the port can register/delete services. Acceptable for an internal tool behind a private network in v1; see §10.
- Uptime metric is check-ratio based, not duration-weighted (see §7.3).
- Incident recovery triggers on a single success, which can flap on marginal services.
- No historical data retention/rollup policy — `HealthCheck` grows unbounded; fine for a demo, needs a pruning or downsampling job for long-term production use.

---

## 10. Future Extensions

- **Auth**: API key or JWT-based auth on write endpoints
- **Alert sinks**: Slack webhook, email (via `AlertSink` interface already defined)
- **Duration-weighted uptime** using `Incident` intervals
- **Flap-resistant recovery**: require N consecutive successes to close an incident, mirroring the failure threshold
- **Data retention**: scheduled downsampling of old `HealthCheck` rows into hourly/daily rollups
- **Multi-node scheduling**: move scheduling into a lightweight job queue (e.g. BullMQ/Redis) so multiple worker instances can share the check load
- **Web3 variant**: as noted in the brief, an alternative track replaces `checker.ts`'s HTTP probe with blockchain RPC polling (watching a wallet address for transactions) — same architecture (scheduler → probe → persistence → REST API), different domain logic. Worth mentioning in an interview as evidence the architecture generalizes.

---

## 11. Testing Strategy

| Layer | What's tested | Tooling |
|---|---|---|
| `checker.test.ts` | Successful check, HTTP 500 response, timeout via a slow mock server, network error (bad host) | `vitest`/`jest` + a local mock HTTP server (`msw` or `http.createServer`) |
| `retry.test.ts` | Retries the correct number of times, backoff timing (using fake timers), stops retrying on success, exhausts retries and surfaces final failure | fake timers to avoid real sleeps in CI |
| `monitor.test.ts` | Incident opens at threshold, stays open on continued failure, closes on recovery, per-service thresholds respected, state correctly rebuilt from DB on "restart" | in-memory/temp SQLite DB per test |
| `services.test.ts` (route/integration) | `POST /services` validation (missing name, bad URL), `GET /services` shape, `DELETE` behavior, `404` handling | `supertest` against the Express app |
| Integration | Full flow: register a service pointed at a mock server, force it to fail 3x, assert an incident appears via `GET /services/:id/incidents`, force recovery, assert it's resolved | `vitest`/`jest` + `supertest` + mock server |

CI should run `npm test` on every push; the Dockerfile build should also be validated in CI to catch container-specific breakage early.

---

## 12. Project Structure (reference)

```
api-monitor/
├── src/
│   ├── server.ts          # Express app bootstrap, graceful shutdown wiring
│   ├── config.ts          # zod-validated env config
│   ├── routes/
│   │   ├── services.ts    # /services CRUD + /:id/incidents + /:id/metrics
│   │   └── health.ts      # /health
│   ├── services/
│   │   ├── monitor.ts     # scheduler + incident state machine
│   │   ├── checker.ts     # single HTTP probe
│   │   └── alert.ts       # AlertSink interface + logging implementation
│   ├── db/
│   │   ├── database.ts    # connection + typed query functions
│   │   └── migrations.ts  # schema creation/versioning
│   └── utils/
│       ├── logger.ts      # structured JSON logger
│       └── retry.ts       # generic retry-with-backoff
├── tests/
│   ├── checker.test.ts
│   ├── monitor.test.ts
│   └── services.test.ts
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── README.md
└── .env.example
```

---

## 13. Open Questions

1. Should `DELETE /services/:id` default to soft-delete (keep history, hide from active list) or hard-delete? Current proposal: soft by default, `?hard=true` opt-in.
2. Is a single-success recovery acceptable for v1, or should flap-resistance be pulled forward from "future extensions"?
3. Any requirement to check services concurrently in batches vs. fully independent timers — matters once the service count grows past a few dozen.