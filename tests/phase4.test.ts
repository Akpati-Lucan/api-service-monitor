import { execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { runServiceCheck } from "../src/application/checks.js";
import { createMonitor } from "../src/application/monitors.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { createNoopLogger } from "../src/utils/logger.js";
import { createProbeRegistry } from "../src/probes/registry.js";
import { httpProbe } from "../src/probes/http.js";
import { tcpProbe } from "../src/probes/tcp.js";
import { heartbeatProbe } from "../src/probes/heartbeat.js";
import { createTlsProbe } from "../src/probes/tls.js";
import { createInClusterK8sClient, createK8sProbe, type K8sClient } from "../src/probes/k8s.js";
import { classifyCertificate } from "../src/probes/windows.js";
import { InMemoryMonitor } from "../src/services/monitor.js";
import type { AlertSink } from "../src/services/alert.js";
import type { AppConfig } from "../src/types/index.js";

const config: AppConfig = {
  PORT: 0,
  DB_PATH: "./data/test.db",
  DEFAULT_INTERVAL_SECONDS: 60,
  DEFAULT_TIMEOUT_MS: 1000,
  DEFAULT_FAILURE_THRESHOLD: 3,
  RETRY_COUNT: 0,
  RETRY_BASE_DELAY_MS: 50,
  RETRY_FACTOR: 1,
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  ENABLED_PROBES: ["http", "tcp", "tls", "heartbeat", "k8s.deployment"],
  MCP_ENABLED: true,
  AUTH_MODE: "disabled",
  MCP_ONLY: false,
  MONITOR_BASE_URL: "",
  MCP_TOKEN: "",
  SMTP_URL: "",
  SMTP_FROM: "",
  STATUS_BASE_URL: "http://localhost:3000",
  VERSION: "1.0.0",
};

class FakeK8sClient implements K8sClient {
  async getDeployment() {
    return { replicas: 2, readyReplicas: 0 };
  }
  async getStatefulSet() {
    return { replicas: 1, readyReplicas: 1 };
  }
  async getCronJob() {
    return null;
  }
  async getEndpoints() {
    return { serviceExists: true, readyAddresses: 0, notReadyAddresses: 1, sliceCount: 1 };
  }
  async getIngressCert() {
    return { missing: true };
  }
}

const fakeK8s = new FakeK8sClient();
const realK8s: K8sClient = createInClusterK8sClient();

function registry() {
  const probes = createProbeRegistry();
  probes.register(httpProbe);
  probes.register(tcpProbe);
  probes.register(heartbeatProbe);
  probes.register(createTlsProbe({ rejectUnauthorized: false }));
  probes.register(createK8sProbe("k8s.deployment", fakeK8s));
  return probes;
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") resolve({ server, port: address.port });
    });
  });
}

const dirs: string[] = [];
const closers: Array<() => void> = [];

describe("phase 4 probes", () => {
  const servers: Array<{ close: (cb: () => void) => void }> = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const close of closers.splice(0)) close();
  });

  it("fails a body assertion closed and opens an incident", async () => {
    const fixture = await listen((_req, res) => {
      res.statusCode = 200;
      res.end("the service is down");
    });
    servers.push(fixture.server);
    const { db, monitor, alerts } = boot();
    const service = createMonitor(db, config, {
      name: "Payments",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 60,
      timeoutMs: 1000,
      failureThreshold: 1,
      config: { bodyIncludes: "healthy" },
    });

    const outcome = await monitor.runOnce(service.id);
    expect(outcome.result).toMatchObject({ status: "DOWN", errorClass: "assertion" });
    expect(JSON.stringify(outcome.result)).not.toContain("the service is down");
    expect(db.getOpenIncident(service.id)?.errorClass).toBe("assertion");
    expect(alerts.kinds).toEqual(["opened"]);
  });

  it("opens an incident when a heartbeat is missed and accepts a ping", async () => {
    const { db, monitor } = boot();
    const missed = createMonitor(db, config, {
      name: "Nightly import",
      kind: "heartbeat",
      intervalSeconds: 30,
      timeoutMs: 1000,
      failureThreshold: 1,
      config: { graceSeconds: 30 },
    });
    expect(missed.heartbeatToken?.startsWith("hb_")).toBe(true);
    const later = new Date(Date.parse(missed.createdAt) + 31_000);
    const outcome = await runServiceCheck({
      service: missed,
      streak: 0,
      db,
      registry: registry(),
      alerts: { async notify() {} },
      logger: createNoopLogger(),
      retry: { retries: 0, baseDelayMs: 1, factor: 1 },
      now: later,
    });
    expect(outcome.result.errorClass).toBe("missed_heartbeat");
    expect(db.getOpenIncident(missed.id)?.reason).toBe("missed heartbeat");

    const app = createApp({ db, config, logger: createNoopLogger(), monitor });
    const created = await request(app).post("/services").send({
      name: "Backup",
      kind: "heartbeat",
      intervalSeconds: 30,
      timeoutMs: 1000,
      failureThreshold: 1,
      config: { graceSeconds: 30 },
    }).expect(201);
    expect(typeof created.body.heartbeatToken).toBe("string");
    const quiet = await request(app).get(`/services/${created.body.id}`).expect(200);
    expect(quiet.body.heartbeatToken).toBeUndefined();
    await request(app).post(`/heartbeats/${created.body.heartbeatToken}`).expect(204);
    await request(app).post("/heartbeats/not-a-real-token").expect(404);

    const service = db.getService(created.body.id);
    if (!service) throw new Error("backup missing");
    const pinged = await runServiceCheck({
      service,
      streak: 0,
      db,
      registry: registry(),
      alerts: { async notify() {} },
      logger: createNoopLogger(),
      retry: { retries: 0, baseDelayMs: 1, factor: 1 },
      now: new Date(Date.now() + 1000),
    });
    expect(pinged.result.status).toBe("UP");
    expect(db.getOpenIncident(service.id)).toBeUndefined();
  });

  it("marks a certificate inside downDays as down", async () => {
    expect(classifyCertificate(1, 21, 3)).toMatchObject({ status: "DOWN", errorClass: "expired_certificate" });
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-cert-"));
    dirs.push(dir);
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const certPath = path.join(dir, "cert.pem");
    const keyPath = path.join(dir, "key.pem");
    writeCert(dir, certPath, keyPath);
    const server = tls.createServer({ cert: readPair(certPath, keyPath).cert, key: readPair(certPath, keyPath).key }, (socket) => {
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("tls port missing");

    const { db } = boot();
    const service = createMonitor(db, config, {
      name: "Edge",
      kind: "tls",
      intervalSeconds: 60,
      timeoutMs: 2000,
      failureThreshold: 1,
      config: { host: "127.0.0.1", port: address.port, warnDays: 30, downDays: 10 },
    });
    const outcome = await runServiceCheck({
      service,
      streak: 0,
      db,
      registry: registry(),
      alerts: { async notify() {} },
      logger: createNoopLogger(),
      retry: { retries: 0, baseDelayMs: 1, factor: 1 },
    });
    expect(outcome.result.status).toBe("DOWN");
    expect(outcome.result.errorClass).toBe("expired_certificate");
    expect(outcome.result.evidence?.daysRemaining).toBeLessThan(10);
  });

  it("opens an incident when a deployment has zero ready replicas", async () => {
    const { db, monitor } = boot();
    const service = createMonitor(db, config, {
      name: "Payments deployment",
      kind: "k8s.deployment",
      intervalSeconds: 60,
      timeoutMs: 1000,
      failureThreshold: 1,
      config: { namespace: "payments", name: "api" },
    });
    const outcome = await monitor.runOnce(service.id);
    expect(outcome.result).toMatchObject({
      status: "DOWN",
      errorClass: "not_ready",
      evidence: { readyReplicas: 0, replicas: 2 },
    });
    expect(db.getOpenIncident(service.id)?.errorClass).toBe("not_ready");
    expect(realK8s.getDeployment).toBeTypeOf("function");

    const app = createApp({ db, config, logger: createNoopLogger(), monitor });
    const listed = await request(app).post("/mcp").send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "workloads.list", arguments: {} },
    }).expect(200);
    expect(listed.body.result.structuredContent).toEqual([
      expect.objectContaining({ kind: "k8s.deployment", status: "DOWN", evidence: { readyReplicas: 0, replicas: 2 } }),
    ]);

    const httpOnly = { ...config, ENABLED_PROBES: ["http"] };
    const hidden = await request(createApp({ db, config: httpOnly, logger: createNoopLogger(), monitor }))
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
      .expect(200);
    expect(hidden.body.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("workloads.list");
  });

  it("checks tcp ports and returns a down result from an on-demand check", async () => {
    const up = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => up.listen(0, "127.0.0.1", () => resolve()));
    servers.push(up);
    const upAddress = up.address();
    if (!upAddress || typeof upAddress === "string") throw new Error("tcp port missing");

    const { db, monitor } = boot();
    const open = createMonitor(db, config, {
      name: "Mail",
      kind: "tcp",
      intervalSeconds: 60,
      timeoutMs: 1000,
      config: { host: "127.0.0.1", port: upAddress.port },
    });
    expect((await monitor.runOnce(open.id)).result.status).toBe("UP");

    const held = net.createServer();
    await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", () => resolve()));
    const heldAddress = held.address();
    if (!heldAddress || typeof heldAddress === "string") throw new Error("closed port missing");
    await new Promise<void>((resolve) => held.close(() => resolve()));
    const closed = createMonitor(db, config, {
      name: "Closed mail",
      kind: "tcp",
      intervalSeconds: 60,
      timeoutMs: 1000,
      config: { host: "127.0.0.1", port: heldAddress.port },
    });
    expect((await monitor.runOnce(closed.id)).result.errorClass).toBe("network");

    const controller = new AbortController();
    controller.abort();
    const timedOut = await tcpProbe.check(
      { kind: "tcp", address: "192.0.2.1:9", config: { host: "192.0.2.1", port: 9 } },
      { timeoutMs: 50, signal: controller.signal, log: createNoopLogger() },
    );
    expect(timedOut.errorClass).toBe("timeout");

    const fixture = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("no");
    });
    servers.push(fixture.server);
    const httpService = createMonitor(db, config, {
      name: "Checkout",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 60,
      timeoutMs: 1000,
      failureThreshold: 3,
    });
    const app = createApp({ db, config, logger: createNoopLogger(), monitor });
    const onDemand = await request(app).post(`/services/${httpService.id}/check`).expect(200);
    expect(onDemand.body).toMatchObject({ status: "DOWN", errorClass: "http_status", httpStatus: 500 });
    const viaMcp = await request(app).post("/mcp").send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "checks.run", arguments: { serviceId: httpService.id } },
    }).expect(200);
    expect(viaMcp.body.result.structuredContent.status).toBe("DOWN");
  });
});

function boot() {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase4-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  initializeDatabase(db);
  const alerts = { kinds: [] as string[] };
  const sink: AlertSink = {
    async notify(event) {
      alerts.kinds.push(event.kind);
    },
  };
  const monitor = new InMemoryMonitor({
    db,
    registry: registry(),
    alerts: sink,
    logger: createNoopLogger(),
    retry: { retries: 0, baseDelayMs: 1, factor: 1 },
  });
  closers.push(() => {
    monitor.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, monitor, alerts };
}

function writeCert(dir: string, certPath: string, keyPath: string) {
  const bin = opensslBin();
  execFileSync(bin, [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "2",
    "-nodes",
    "-subj", "/CN=localhost",
  ], { cwd: dir, stdio: "ignore" });
}

function opensslBin(): string {
  const candidates = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("openssl is required to mint the certificate fixture");
}

function readPair(certPath: string, keyPath: string) {
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}
