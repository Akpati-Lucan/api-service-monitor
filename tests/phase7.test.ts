import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { DEFAULT_GROUP_ID } from "../src/db/migrations.js";
import { createProbeRegistry } from "../src/probes/registry.js";
import { httpProbe } from "../src/probes/http.js";
import { InMemoryMonitor } from "../src/services/monitor.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AlertSink, PushPayload, PushSink } from "../src/services/alert.js";
import type { AppConfig } from "../src/types/index.js";
import type { DatabaseApi } from "../src/db/database.js";

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
  RETENTION_RAW_DAYS: 14,
  SQLITE_PROBE_ROOT: "",
  VISION_MARKETPLACE_ENABLED: false,
  VISION_STAFF_TOKEN: "",
  VISION_PUBLIC_RATE_LIMIT: 60,
  VISION_PUBLISHER_PORTAL_ENABLED: false,
  VISION_BILLING_ENABLED: false,
  VISION_BILLING_WEBHOOK_SECRET: "",
  VISION_STRIPE_SECRET_KEY: "",
  VISION_PLATFORM_FEE_BPS: 0,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VERSION: "1.0.0",
};

describe("phase 7", () => {
  afterEach(() => {
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    for (const server of servers) server.close();
    servers.length = 0;
    config.AUTH_MODE = "disabled";
  });

  it("acknowledges without resolving, summarizes, and pushes only when an incident opens or resolves", async () => {
    let statusCode = 500;
    const fixture = await listen((_req, res) => {
      res.statusCode = statusCode;
      res.end(statusCode === 200 ? "ok" : "no");
    });
    servers.push(fixture.server);

    const pushes: PushPayload[] = [];
    const push: PushSink = { async push(payload) { pushes.push(payload); } };
    const { app, monitor } = boot(push);
    const created = await request(app).post("/services").send({
      name: "Ledger API",
      url: `http://127.0.0.1:${fixture.port}/health`,
      failureThreshold: 1,
      timeoutMs: 1000,
      intervalSeconds: 60,
    }).expect(201);

    const opened = await monitor.runOnce(created.body.id);
    expect(opened.effect).toBe("open");
    expect(pushes).toEqual([
      expect.objectContaining({ incidentId: opened.incidentId, serviceName: "Ledger API", kind: "opened" }),
    ]);

    const again = await monitor.runOnce(created.body.id);
    expect(again.effect).toBe("none");
    expect(pushes).toHaveLength(1);

    const ack = await request(app)
      .post(`/incidents/${opened.incidentId}/acknowledgements`)
      .send({ note: "Looking at the upstream timeout" })
      .expect(201);
    expect(ack.body.acknowledgement.actor).toBe("disabled");
    expect(ack.body.incident.resolvedAt).toBeNull();

    await request(app).post(`/incidents/${opened.incidentId}/acknowledgements`).send({ note: " " }).expect(400);

    const summary = await request(app).get("/summary").expect(200);
    expect(summary.body.downCount).toBe(1);
    expect(summary.body.degradedCount).toBe(0);
    expect(summary.body.openIncidents).toEqual([
      expect.objectContaining({
        id: opened.incidentId,
        serviceName: "Ledger API",
        errorClass: "http_status",
        reason: expect.any(String),
        ageSeconds: expect.any(Number),
        responseTimeMs: expect.any(Number),
      }),
    ]);

    const view = await request(app).get(`/incidents/${opened.incidentId}`).expect(200);
    expect(view.body.acknowledgements).toEqual([
      expect.objectContaining({ note: "Looking at the upstream timeout", actor: "disabled" }),
    ]);
    expect(view.body.resolvedAt).toBeNull();

    statusCode = 200;
    const resolved = await monitor.runOnce(created.body.id);
    expect(resolved.effect).toBe("resolve");
    expect(pushes.map((item) => item.kind)).toEqual(["opened", "resolved"]);
    const after = await request(app).get("/summary").expect(200);
    expect(after.body.downCount).toBe(0);
    expect(after.body.openIncidents).toEqual([]);
  });

  it("exposes write tools and refuses a read key", async () => {
    let statusCode = 500;
    const fixture = await listen((_req, res) => {
      res.statusCode = statusCode;
      res.end("no");
    });
    servers.push(fixture.server);
    const { db, app, monitor } = boot({ async push() {} });

    const created = await mcp(app, "monitors.create", {
      name: "Checkout",
      url: `http://127.0.0.1:${fixture.port}/health`,
      failureThreshold: 1,
      timeoutMs: 1000,
      intervalSeconds: 60,
    });
    expect(created.isError).toBe(false);
    const serviceId = created.structuredContent.id as string;

    const paused = await mcp(app, "monitors.pause", { id: serviceId });
    expect(paused.structuredContent.paused).toBe(true);

    const resumed = await mcp(app, "monitors.resume", { id: serviceId });
    expect(resumed.structuredContent.paused).toBe(false);

    const ran = await mcp(app, "checks.run", { serviceId });
    expect(ran.structuredContent).toMatchObject({ status: "DOWN", effect: "open" });
    const incidentId = ran.structuredContent.incidentId as string;

    const noted = await mcp(app, "incidents.acknowledge", { id: incidentId, note: "On it" });
    expect(noted.structuredContent.resolvedAt).toBeNull();
    expect(db.getIncident(incidentId)?.resolvedAt).toBeNull();

    const window = await mcp(app, "maintenance.create", {
      serviceId,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      note: "deploy",
    });
    expect(window.structuredContent.serviceId).toBe(serviceId);

    const reader = await request(app)
      .post("/api-keys")
      .send({ name: "reader", scope: "read", groupId: DEFAULT_GROUP_ID })
      .expect(201);
    config.AUTH_MODE = "enabled";
    const deniedHttp = await request(app)
      .post(`/incidents/${incidentId}/acknowledgements`)
      .set("Authorization", `Bearer ${reader.body.token}`)
      .send({ note: "not allowed" })
      .expect(403);
    expect(deniedHttp.body.error.code).toBe("FORBIDDEN");

    const deniedTool = await mcp(app, "monitors.pause", { id: serviceId }, reader.body.token);
    expect(deniedTool.isError).toBe(true);
    expect(deniedTool.structuredContent.error.code).toBe("FORBIDDEN");
    config.AUTH_MODE = "disabled";

    expect(monitor.isRunning()).toBe(false);
  });
});

function mcp(app: ReturnType<typeof createApp>, name: string, args: Record<string, unknown>, token?: string) {
  const call = request(app).post("/mcp").send({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (token) call.set("Authorization", `Bearer ${token}`);
  return call.expect(200).then((response) => response.body.result as {
    isError?: boolean;
    structuredContent: Record<string, any>;
  });
}

function boot(push: PushSink) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase7-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const registry = createProbeRegistry();
  registry.register(httpProbe);
  const alerts: AlertSink = { async notify() {} };
  const monitor = new InMemoryMonitor({
    db,
    registry,
    alerts,
    push,
    logger: createNoopLogger(),
    retry: { retries: 0, baseDelayMs: 50, factor: 1 },
  });
  const app = createApp({ db, config, logger: createNoopLogger(), monitor });
  return { db, app, monitor };
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
const databases: DatabaseApi[] = [];
const servers: http.Server[] = [];
