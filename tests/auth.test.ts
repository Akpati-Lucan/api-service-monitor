import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { DEFAULT_GROUP_ID } from "../src/db/migrations.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";
import type { DatabaseApi } from "../src/db/database.js";

const baseConfig: AppConfig = {
  PORT: 3000,
  DB_PATH: "./data/test.db",
  DEFAULT_INTERVAL_SECONDS: 60,
  DEFAULT_TIMEOUT_MS: 5000,
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

describe("auth", () => {
  const dirs: string[] = [];
  const databases: DatabaseApi[] = [];

  afterEach(() => {
    for (const db of databases) {
      db.close();
    }
    databases.length = 0;
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("keeps routes open when auth is disabled and still creates groups", async () => {
    const { db, app } = boot("disabled");
    await request(app).get("/services").expect(200);
    const created = await request(app).post("/groups").send({ name: "Billing" }).expect(201);
    expect(created.body).toMatchObject({ name: "Billing", slug: "billing" });
    expect(created.body.token).toBeUndefined();

    const listed = await request(app).get("/groups").expect(200);
    expect(listed.body.map((group: { id: string }) => group.id)).toEqual(
      expect.arrayContaining([DEFAULT_GROUP_ID, created.body.id]),
    );
    await request(app).delete(`/groups/${DEFAULT_GROUP_ID}`).expect(409);
  });

  it("requires a bearer token, enforces scope, and hides other groups", async () => {
    const { db, app: openApp } = boot("disabled");
    const billing = await request(openApp).post("/groups").send({ name: "Billing" }).expect(201);
    const other = await request(openApp).post("/groups").send({ name: "Other" }).expect(201);
    const admin = await request(openApp).post("/api-keys").send({ name: "root", scope: "admin" }).expect(201);
    const reader = await request(openApp)
      .post("/api-keys")
      .send({ name: "reader", scope: "read", groupId: billing.body.id })
      .expect(201);
    const writer = await request(openApp)
      .post("/api-keys")
      .send({ name: "writer", scope: "write", groupId: billing.body.id })
      .expect(201);
    const groupAdmin = await request(openApp)
      .post("/api-keys")
      .send({ name: "billing-admin", scope: "admin", groupId: billing.body.id })
      .expect(201);

    expect(admin.body.token).toMatch(/^am_/);
    expect(admin.body.prefix).toBe(admin.body.token.slice(0, 8));
    expect(admin.body.hash).toBeUndefined();
    const stored = db.getApiKey(admin.body.id);
    expect(stored?.hash).toHaveLength(64);
    expect(stored?.hash).not.toBe(admin.body.token);

    const app = createApp({ db, config: { ...baseConfig, AUTH_MODE: "enabled" }, logger: createNoopLogger() });

    const health = await request(app).get("/health");
    expect(health.status).not.toBe(401);
    await request(app).get("/services").expect(401);
    await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(401);
    await request(app).get("/services").set(bearer("nope")).expect(401);

    await request(app).post("/services").set(bearer(reader.body.token)).send(serviceBody()).expect(403);
    await request(app).post("/api-keys").set(bearer(writer.body.token)).send({ name: "x", scope: "read", groupId: billing.body.id }).expect(403);
    await request(app).post("/groups").set(bearer(groupAdmin.body.token)).send({ name: "Escalation" }).expect(403);
    await request(app)
      .post("/api-keys")
      .set(bearer(groupAdmin.body.token))
      .send({ name: "wide", scope: "admin" })
      .expect(403);

    const created = await request(app).post("/services").set(bearer(writer.body.token)).send(serviceBody()).expect(201);
    expect(created.body.groupId).toBe(billing.body.id);
    await request(app)
      .post("/services")
      .set(bearer(writer.body.token))
      .send({ ...serviceBody(), groupId: other.body.id })
      .expect(403);

    const foreign = await request(app)
      .post("/services")
      .set(bearer(admin.body.token))
      .send({ ...serviceBody(), name: "Foreign", groupId: other.body.id })
      .expect(201);

    const visible = await request(app).get("/services").set(bearer(reader.body.token)).expect(200);
    expect(visible.body.map((service: { id: string }) => service.id)).toEqual([created.body.id]);
    await request(app).get(`/services/${foreign.body.id}`).set(bearer(reader.body.token)).expect(403);
    await request(app).get(`/services/${created.body.id}`).set(bearer(reader.body.token)).expect(200);

    const ownGroups = await request(app).get("/groups").set(bearer(reader.body.token)).expect(200);
    expect(ownGroups.body).toEqual([expect.objectContaining({ id: billing.body.id, slug: "billing" })]);
    await request(app).get(`/groups/${other.body.id}`).set(bearer(reader.body.token)).expect(403);
    const detail = await request(app).get(`/groups/${billing.body.id}`).set(bearer(reader.body.token)).expect(200);
    expect(detail.body.counts).toMatchObject({ UNKNOWN: 1, total: 1 });

    const listed = await request(app)
      .post("/mcp")
      .set(bearer(reader.body.token))
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "monitors.list", arguments: {} } })
      .expect(200);
    expect(listed.body.result.structuredContent.map((service: { id: string }) => service.id)).toEqual([created.body.id]);

    const hidden = await request(app)
      .post("/mcp")
      .set(bearer(reader.body.token))
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "monitors.get", arguments: { id: foreign.body.id } },
      })
      .expect(200);
    expect(hidden.body.result.isError).toBe(true);
    expect(hidden.body.result.structuredContent.error.code).toBe("FORBIDDEN");

    const groups = await request(app)
      .post("/mcp")
      .set(bearer(reader.body.token))
      .send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "groups.list", arguments: {} } })
      .expect(200);
    expect(groups.body.result.structuredContent).toHaveLength(1);

    await request(app).delete(`/api-keys/${reader.body.id}`).set(bearer(admin.body.token)).expect(204);
    await request(app).get("/services").set(bearer(reader.body.token)).expect(401);

    const empty = await request(app).post("/groups").set(bearer(admin.body.token)).send({ name: "Temporary" }).expect(201);
    await request(app).delete(`/groups/${empty.body.id}`).set(bearer(admin.body.token)).expect(204);
    await request(app).post("/groups").set(bearer(admin.body.token)).send({ name: "Billing" }).expect(409);
  });

  function boot(mode: "disabled" | "enabled") {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-auth-"));
    dirs.push(dir);
    const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
    initializeDatabase(db);
    databases.push(db);
    const app = createApp({
      db,
      config: { ...baseConfig, AUTH_MODE: mode },
      logger: createNoopLogger(),
    });
    return { db, app };
  }
});

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function serviceBody() {
  return {
    name: "Billing API",
    url: "https://example.com/health",
    intervalSeconds: 60,
    timeoutMs: 1000,
    failureThreshold: 3,
  };
}
