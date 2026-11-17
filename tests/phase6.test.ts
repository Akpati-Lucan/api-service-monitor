import { createServer, type Server } from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { requestSubscription } from "../src/application/subscribers.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { dnsProbe } from "../src/probes/dns.js";
import { domainProbe } from "../src/probes/domain.js";
import { elasticProbe } from "../src/probes/elastic.js";
import { etcdProbe } from "../src/probes/etcd.js";
import { httpFlowProbe } from "../src/probes/flow.js";
import { memcachedProbe } from "../src/probes/memcached.js";
import { rabbitmqProbe } from "../src/probes/rabbitmq.js";
import { createDefaultProbeRegistry } from "../src/probes/registry.js";
import { s3Probe } from "../src/probes/s3.js";
import { sqliteProbe } from "../src/probes/sqlite.js";
import type { ProbeContext } from "../src/probes/types.js";
import type { AppConfig } from "../src/types/index.js";
import { createNoopLogger } from "../src/utils/logger.js";

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("phase 6", () => {
  it("keeps optional catalog kinds unloaded", () => {
    const registry = createDefaultProbeRegistry(["http", "dns", "mssql", "oracle", "kafka"]);
    expect(registry.kinds()).toEqual(["http", "dns"]);
    expect(registry.get("mssql")).toBeUndefined();
  });

  it("resolves dns, rejects a mismatch, and times out when aborted", async () => {
    const up = await dnsProbe.check(target("dns", { name: "localhost", type: "A" }), context(2000));
    expect(up.status).toBe("UP");
    const missed = await dnsProbe.check(target("dns", { name: "localhost", type: "A", expected: "not-this-address" }), context(2000));
    expect(missed).toMatchObject({ status: "DOWN", errorClass: "query" });
    const aborted = new AbortController();
    aborted.abort();
    const timed = await dnsProbe.check(target("dns", { name: "localhost", type: "A" }), context(200, undefined, aborted.signal));
    expect(timed.errorClass).toBe("timeout");
  });

  it("reads a domain expiry from RDAP", async () => {
    const url = await listen((req, res) => {
      const days = req.url?.includes("soon") ? 3 : 40;
      const date = new Date(Date.now() + days * 86_400_000).toISOString();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ events: [{ eventAction: "expiration", eventDate: date }] }));
    });
    const healthy = await domainProbe.check(target("domain", { domain: "example.com", warnDays: 30, downDays: 7, rdapBase: url }), context(2000));
    expect(healthy.status).toBe("UP");
    const expiring = await domainProbe.check(target("domain", { domain: "soon.example", warnDays: 30, downDays: 7, rdapBase: url }), context(2000));
    expect(expiring).toMatchObject({ status: "DOWN", errorClass: "expired_domain" });
  });

  it("runs an http flow without keeping the saved token", async () => {
    const secret = "flow-token-value";
    const url = await listen((req, res) => {
      if (req.url === "/login") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ token: secret }));
        return;
      }
      const header = req.headers.authorization ?? "";
      res.statusCode = header === `Bearer ${secret}` ? 200 : 401;
      res.end(header === `Bearer ${secret}` ? "ok" : "no");
    });
    const result = await httpFlowProbe.check(target("http.flow", {
      steps: [
        { url: `${url}/login`, saveJsonPath: "token" },
        { url: `${url}/private`, headerTemplate: { Authorization: "Bearer {{token}}" }, bodyIncludes: "ok" },
      ],
    }), context(2000));
    expect(result).toMatchObject({ ok: true, status: "UP" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("maps elasticsearch health and rabbitmq alarms", async () => {
    const elastic = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "yellow" }));
    });
    expect((await elasticProbe.check(target("elastic", { address: elastic, variant: "opensearch" }), context(2000))).status).toBe("DEGRADED");

    const rabbit = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
    });
    expect((await rabbitmqProbe.check(target("rabbitmq", { managementUrl: rabbit, user: "guest" }), context(2000))).status).toBe("UP");
    const closed = await rabbitmqProbe.check(target("rabbitmq", { host: "127.0.0.1", port: await closedPort() }), context(800));
    expect(closed.errorClass).toBe("network");
  });

  it("heads an s3 bucket and classifies 403 and 404", async () => {
    const url = await listen((req, res) => {
      if (req.method !== "HEAD") {
        res.statusCode = 400;
        res.end();
        return;
      }
      if (req.url === "/missing") res.statusCode = 404;
      else if (req.url === "/denied") res.statusCode = 403;
      else res.statusCode = 200;
      res.end();
    });
    const secret = JSON.stringify({ accessKeyId: "test-key", secretAccessKey: "test-secret" });
    const up = await s3Probe.check(target("s3", { endpoint: url, region: "us-east-1", bucket: "bucket" }), context(2000, secret));
    expect(up.status).toBe("UP");
    const denied = await s3Probe.check(target("s3", { endpoint: url, region: "us-east-1", bucket: "denied" }), context(2000, secret));
    expect(denied.errorClass).toBe("auth");
    const missing = await s3Probe.check(target("s3", { endpoint: url, region: "us-east-1", bucket: "missing" }), context(2000, secret));
    expect(missing.errorClass).toBe("query");
    expect(JSON.stringify(up)).not.toContain("test-secret");
  });

  it("reads memcached version, etcd health, and a sqlite file inside the root", async () => {
    const memcached = await new Promise<number>((resolve) => {
      const server = net.createServer((socket) => {
        socket.once("data", () => socket.end("VERSION 1.6.0\r\n"));
      });
      servers.push(server as unknown as Server);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(address && typeof address !== "string" ? address.port : 0);
      });
    });
    expect((await memcachedProbe.check(target("memcached", { host: "127.0.0.1", port: memcached }), context(2000))).status).toBe("UP");

    const etcd = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ health: "true" }));
    });
    expect((await etcdProbe.check(target("etcd", { url: etcd }), context(2000))).status).toBe("UP");

    const root = mkdtempSync(path.join(tmpdir(), "sqlite-probe-"));
    dirs.push(root);
    writeFileSync(path.join(root, "sidecar.db"), "");
    const driver = await import("better-sqlite3");
    const file = new driver.default(path.join(root, "sidecar.db"));
    file.exec("CREATE TABLE sample (id INTEGER)");
    file.close();
    const up = await sqliteProbe.check(target("sqlite", { path: "sidecar.db", sqliteRoot: root }), context(2000));
    expect(up.status).toBe("UP");
    const escaped = await sqliteProbe.check(target("sqlite", { path: "../sidecar.db", sqliteRoot: root }), context(2000));
    expect(escaped.errorClass).toBe("auth");
  });

  it("folds old checks, blocks hard delete while checks or an incident exist, and confirms a subscriber", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-"));
    dirs.push(dir);
    const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
    initializeDatabase(db);
    try {
    const config: AppConfig = {
      PORT: 0,
      DB_PATH: path.join(dir, "monitor.db"),
      DEFAULT_INTERVAL_SECONDS: 60,
      DEFAULT_TIMEOUT_MS: 5000,
      DEFAULT_FAILURE_THRESHOLD: 3,
      RETRY_COUNT: 0,
      RETRY_BASE_DELAY_MS: 250,
      RETRY_FACTOR: 2,
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      ENABLED_PROBES: ["http"],
      MCP_ENABLED: false,
      AUTH_MODE: "disabled",
      MCP_ONLY: false,
      MONITOR_BASE_URL: "",
      MCP_TOKEN: "",
      SMTP_URL: "",
      SMTP_FROM: "",
      STATUS_BASE_URL: "http://localhost:3000",
      RETENTION_RAW_DAYS: 14,
      SQLITE_PROBE_ROOT: "",
      VISION_MARKETPLACE_ENABLED: false,
      VISION_STAFF_TOKEN: "",
      VISION_PUBLIC_RATE_LIMIT: 60,
    };
    const app = createApp({ db, config });
    const created = await request(app).post("/services").send({ name: "Payments", url: "https://example.com", intervalSeconds: 60, timeoutMs: 1000, failureThreshold: 1 });
    const id = created.body.id as string;
    const fresh = await request(app).delete(`/services/${id}?hard=true`);
    expect(fresh.status).toBe(204);

    const second = await request(app).post("/services").send({ name: "Checkout", url: "https://example.com", intervalSeconds: 60, timeoutMs: 1000, failureThreshold: 1 });
    const serviceId = second.body.id as string;
    db.insertHealthCheck({ serviceId, status: "UP", responseTimeMs: 12, checkedAt: "2020-01-01T00:10:00.000Z" });
    db.insertHealthCheck({ serviceId, status: "DOWN", responseTimeMs: 20, errorClass: "network", checkedAt: "2020-01-01T00:40:00.000Z" });
    const blocked = await request(app).delete(`/services/${serviceId}?hard=true`);
    expect(blocked.status).toBe(409);
    const folded = db.compactHealthChecks("2020-02-01T00:00:00.000Z");
    expect(folded.deleted).toBe(2);
    expect(db.countHealthChecks(serviceId)).toBe(0);
    expect(db.listRollupsSince(serviceId, "2019-01-01T00:00:00.000Z")[0]).toMatchObject({ checks: 2, upChecks: 1, downChecks: 1 });
    const incident = db.openIncident({ serviceId, reason: "Automatic: down" });
    expect((await request(app).delete(`/services/${serviceId}?hard=true`)).status).toBe(409);
    db.resolveIncident(incident.id, "2020-01-02T00:00:00.000Z");
    expect((await request(app).delete(`/services/${serviceId}?hard=true`)).status).toBe(204);

    const group = db.listGroups()[0];
    const page = db.createStatusPage({ groupId: group.id, slug: "harbor", title: "Harbor", visibility: "public" });
    const live = await request(app).post("/services").send({ name: "Ledger", url: "https://example.com", intervalSeconds: 60, timeoutMs: 1000, failureThreshold: 1 });
    db.addStatusComponent({ statusPageId: page.id, serviceId: live.body.id, displayName: "Ledger", sortOrder: 0 });
    const messages: string[] = [];
    await requestSubscription({
      db,
      slug: "harbor",
      email: "ops@example.com",
      statusBaseUrl: "http://localhost:3000",
      send: async (message) => {
        messages.push(message.text);
      },
    });
    const confirm = /confirm\/(sub_[A-Za-z0-9_-]+)/.exec(messages[0] ?? "");
    expect(confirm?.[1]).toBeTruthy();
    const confirmed = await request(app).get(`/status/harbor/subscribers/confirm/${confirm?.[1]}`);
    expect(confirmed.text).toContain("Updates confirmed");
    expect(db.listVerifiedSubscriberEmails(live.body.id)).toEqual(["ops@example.com"]);
    const stopped = await request(app).get(`/status/harbor/subscribers/unsubscribe/${confirm?.[1]}`);
    expect(stopped.text).toContain("Updates stopped");
    expect(db.listVerifiedSubscriberEmails(live.body.id)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

function target(kind: string, config: Record<string, unknown>) {
  return { kind, address: "127.0.0.1", config };
}

function context(timeoutMs: number, secret?: string, signal = new AbortController().signal): ProbeContext {
  return { timeoutMs, signal, secret, log: createNoopLogger() };
}

function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
