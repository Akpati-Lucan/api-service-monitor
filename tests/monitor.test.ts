import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { InMemoryMonitor } from "../src/services/monitor.js";
import { LoggingAlertSink } from "../src/services/alert.js";
import { createProbeRegistry } from "../src/probes/registry.js";
import { httpProbe } from "../src/probes/http.js";
import { createNoopLogger } from "../src/utils/logger.js";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/types/index.js";
import type { AlertSink } from "../src/services/alert.js";

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
  ENABLED_PROBES: ["http"],
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

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        resolve({ server, port: address.port });
      }
    });
  });
}

const pipelineDirs: string[] = [];
const pipelineDbs: Array<{ close: () => void }> = [];

describe("monitor pipeline", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const db of pipelineDbs.splice(0)) {
      db.close();
    }
    for (const dir of pipelineDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens, holds, and resolves an incident, and keeps a second threshold independent", async () => {
    let healthy = false;
    const fixture = await listen((_req, res) => {
      res.statusCode = healthy ? 200 : 500;
      res.end(healthy ? "ok" : "down");
    });
    servers.push(fixture.server);

    const notifications: string[] = [];
    const alerts: AlertSink = {
      async notify(event) {
        notifications.push(event.kind);
      },
    };
    const { db, monitor } = createPipeline(alerts);
    const sensitive = db.createService({
      name: "Sensitive",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 86400,
      timeoutMs: 1000,
      failureThreshold: 2,
    });
    const patient = db.createService({
      name: "Patient",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 86400,
      timeoutMs: 1000,
      failureThreshold: 3,
    });

    await monitor.runOnce(sensitive.id);
    expect(db.listIncidents(sensitive.id)).toHaveLength(0);
    await monitor.runOnce(sensitive.id);
    expect(db.getOpenIncident(sensitive.id)?.reason).toBe("HTTP 500");
    await monitor.runOnce(sensitive.id);
    expect(db.listIncidents(sensitive.id)).toHaveLength(1);
    expect(notifications).toEqual(["opened"]);

    await monitor.runOnce(patient.id);
    expect(db.getOpenIncident(patient.id)).toBeUndefined();

    healthy = true;
    await monitor.runOnce(sensitive.id);
    expect(db.getOpenIncident(sensitive.id)).toBeUndefined();
    expect(db.listIncidents(sensitive.id)[0]?.resolvedAt).toBeTruthy();
    expect(notifications).toEqual(["opened", "resolved"]);
    expect(db.listIncidentUpdates(db.listIncidents(sensitive.id)[0].id).map((update) => update.state)).toEqual([
      "investigating",
      "resolved",
    ]);
  });

  it("does not open a second incident or alert again after a restart", async () => {
    const fixture = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    servers.push(fixture.server);
    const notifications: string[] = [];
    const alerts: AlertSink = { async notify(event) { notifications.push(event.kind); } };
    const first = createPipeline(alerts);
    const service = first.db.createService({
      name: "Payments",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 86400,
      timeoutMs: 1000,
      failureThreshold: 2,
    });
    await first.monitor.runOnce(service.id);
    await first.monitor.runOnce(service.id);
    expect(notifications).toEqual(["opened"]);

    first.monitor.stop();
    const restarted = new InMemoryMonitor({
      db: first.db,
      registry: registry(),
      alerts,
      logger: createNoopLogger(),
      retry: { retries: 0, baseDelayMs: 1, factor: 1 },
    });
    restarted.start();
    await restarted.waitForIdle(2000);
    restarted.stop();

    expect(first.db.listIncidents(service.id)).toHaveLength(1);
    expect(notifications).toEqual(["opened"]);
    restarted.stop();
  });

  it("runs the first check when the scheduler starts", async () => {
    const fixture = await listen((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    servers.push(fixture.server);
    const { db, monitor } = createPipeline(new LoggingAlertSink(createNoopLogger()));
    db.createService({
      name: "Ready",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 86400,
      timeoutMs: 1000,
      failureThreshold: 3,
    });

    monitor.start();
    await monitor.waitForIdle(2000);
    monitor.stop();

    const checks = db.getRecentHealthChecks(db.listServices()[0].id, 5);
    expect(checks[0]?.status).toBe("UP");
    expect(monitor.activeServiceCount()).toBe(1);
  });

  it("exposes the same open incident through MCP and the REST list", async () => {
    const fixture = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    servers.push(fixture.server);
    const { db, monitor } = createPipeline(new LoggingAlertSink(createNoopLogger()));
    const service = db.createService({
      name: "Checkout",
      url: `http://127.0.0.1:${fixture.port}/health`,
      intervalSeconds: 86400,
      timeoutMs: 1000,
      failureThreshold: 1,
    });
    await monitor.runOnce(service.id);

    const app = createApp({ db, config, logger: createNoopLogger(), monitor });
    const rest = await request(app).get(`/services/${service.id}/incidents`).expect(200);
    const mcp = await request(app)
      .post("/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "incidents.list_open", arguments: {} },
      })
      .expect(200);

    expect(mcp.body.result.structuredContent.map((incident: { id: string }) => incident.id)).toEqual(
      rest.body.map((incident: { id: string }) => incident.id),
    );
    expect(mcp.body.result.isError).toBe(false);
  });
});

function registry() {
  const probes = createProbeRegistry();
  probes.register(httpProbe);
  return probes;
}

function createPipeline(alerts: AlertSink) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-pipeline-"));
  pipelineDirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  pipelineDbs.push(db);
  initializeDatabase(db);
  const monitor = new InMemoryMonitor({
    db,
    registry: registry(),
    alerts,
    logger: createNoopLogger(),
    retry: { retries: 0, baseDelayMs: 1, factor: 1 },
  });
  return { dir, db, monitor };
}
