import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { DEFAULT_GROUP_ID } from "../src/db/migrations.js";
import { InMemoryMonitor } from "../src/services/monitor.js";
import { createDefaultProbeRegistry } from "../src/probes/registry.js";
import { RoutingAlertSink } from "../src/alerts/routing.js";
import { LoggingAlertSink } from "../src/services/alert.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";

const config: AppConfig = {
  PORT: 0,
  DB_PATH: "./data/test.db",
  DEFAULT_INTERVAL_SECONDS: 60,
  DEFAULT_TIMEOUT_MS: 1000,
  DEFAULT_FAILURE_THRESHOLD: 1,
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
  STATUS_BASE_URL: "http://status.example",
  VERSION: "1.0.0",
};

describe("phase 3", () => {
  const dirs: string[] = [];
  const databases: DatabaseApi[] = [];
  const servers: http.Server[] = [];
  const sockets: net.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(sockets.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const db of databases.splice(0)) db.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.HOOK_TOKEN;
  });

  it("flips a status document from operational to down and posts one webhook on open and resolve", async () => {
    let healthy = true;
    const target = await listen(servers, (_req, res) => {
      res.statusCode = healthy ? 200 : 500;
      res.end(healthy ? "ok" : "down");
    });
    const posts: Array<{ kind?: string; authorization?: string }> = [];
    const hook = await listen(servers, (req, res) => {
      readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { kind?: string };
        posts.push({ kind: body.kind, authorization: req.headers.authorization });
        res.statusCode = 204;
        res.end();
      });
    });
    const { app, db, monitor } = boot(dirs, databases);
    const created = await request(app).post("/services").send(serviceBody(target.port, "Payments API")).expect(201);
    await request(app).post("/alert-routes").send({
      kind: "webhook",
      config: { url: `http://127.0.0.1:${hook.port}/hook` },
      secretRef: "HOOK_TOKEN",
    }).expect(201);
    const page = await request(app).post("/status-pages").send({
      groupId: DEFAULT_GROUP_ID,
      slug: "acme",
      title: "Acme",
      visibility: "public",
    }).expect(201);
    await request(app).post(`/status-pages/${page.body.id}/components`).send({
      serviceId: created.body.id,
      displayName: "Payments API",
    }).expect(201);

    process.env.HOOK_TOKEN = "hook-secret";
    await monitor.runOnce(created.body.id);
    expect((await request(app).get("/status/acme.json")).body.status).toBe("operational");

    healthy = false;
    await monitor.runOnce(created.body.id);
    const down = await request(app).get("/status/acme.json").expect(200);
    expect(down.body.status).toBe("down");
    expect(down.body.components[0].status).toBe("down");
    expect(down.body.incidents[0].resolvedAt).toBeNull();
    const badge = await request(app).get("/status/acme/badge.svg").expect(200);
    expect(String(badge.text ?? badge.body)).toContain("down");
    expect((await request(app).get("/status/acme")).text).toContain("Payments API");
    expect((await request(app).get("/status/acme/feed.xml")).text).toContain("Automatic:");

    healthy = true;
    await monitor.runOnce(created.body.id);
    expect(posts.map((post) => post.kind)).toEqual(["opened", "resolved"]);
    expect(posts[0]?.authorization).toBe("Bearer hook-secret");
    expect(db.listAlertDeliveries(down.body.incidents[0].id).map((row) => row.status)).toEqual(["sent", "sent"]);
    delete process.env.HOOK_TOKEN;
  });

  it("keeps a vendor outage off the page status and ignores a human resolved update", async () => {
    const checkout = await listen(servers, (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    const vendor = await listen(servers, (_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    const { app, db, monitor } = boot(dirs, databases);
    const owned = await request(app).post("/services").send(serviceBody(checkout.port, "Checkout")).expect(201);
    const dependency = await request(app).post("/services").send({
      ...serviceBody(vendor.port, "Stripe"),
      role: "dependency",
    }).expect(201);
    const page = await request(app).post("/status-pages").send({
      groupId: DEFAULT_GROUP_ID, slug: "shop", title: "Shop", visibility: "public",
    }).expect(201);
    await request(app).post(`/status-pages/${page.body.id}/components`).send({ serviceId: owned.body.id, displayName: "Checkout" }).expect(201);
    await request(app).post(`/status-pages/${page.body.id}/components`).send({ serviceId: dependency.body.id, displayName: "Stripe" }).expect(201);
    await monitor.runOnce(owned.body.id);
    await monitor.runOnce(dependency.body.id);

    const document = await request(app).get("/status/shop.json").expect(200);
    expect(document.body.status).toBe("operational");
    expect(document.body.components.find((item: { name: string }) => item.name === "Stripe").status).toBe("down");
    expect((await request(app).get("/status/shop")).text).toContain("Dependencies");

    const incidentId = document.body.incidents[0].id as string;
    const update = await request(app).post(`/incidents/${incidentId}/updates`).send({
      state: "resolved",
      message: "Watching the next check",
    }).expect(201);
    expect(update.body.incident.resolvedAt).toBeNull();
    expect(db.getOpenIncident(dependency.body.id)?.id).toBe(incidentId);
  });

  it("requires a read key for a private page and serves a public page without one", async () => {
    const { app, db } = boot(dirs, databases);
    await request(app).post("/status-pages").send({
      groupId: DEFAULT_GROUP_ID, slug: "public-page", title: "Public", visibility: "public",
    }).expect(201);
    await request(app).post("/status-pages").send({
      groupId: DEFAULT_GROUP_ID, slug: "private-page", title: "Private", visibility: "private",
    }).expect(201);
    const key = await request(app).post("/api-keys").send({
      name: "reader", scope: "read", groupId: DEFAULT_GROUP_ID,
    }).expect(201);
    const locked = createApp({ db, config: { ...config, AUTH_MODE: "enabled" }, logger: createNoopLogger() });

    await request(locked).get("/status/public-page.json").expect(200);
    await request(locked).get("/status/private-page.json").expect(401);
    await request(locked).get("/status/private-page.json").set("Authorization", `Bearer ${key.body.token}`).expect(200);
    const mcp = await request(locked).post("/mcp").send({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "status.get", arguments: { slug: "public-page" } },
    }).expect(200);
    expect(mcp.body.result.structuredContent.title).toBe("Public");
    await request(locked).post("/mcp").send({ jsonrpc: "2.0", id: 2, method: "tools/list" }).expect(401);
  });

  it("stores the check during maintenance and skips the incident and the webhook", async () => {
    const target = await listen(servers, (_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    const posts: string[] = [];
    const hook = await listen(servers, (req, res) => {
      posts.push(req.url ?? "");
      res.statusCode = 204;
      res.end();
    });
    const { app, db, monitor } = boot(dirs, databases);
    const created = await request(app).post("/services").send(serviceBody(target.port, "Quiet")).expect(201);
    await request(app).post("/alert-routes").send({
      kind: "webhook",
      config: { url: `http://127.0.0.1:${hook.port}/hook` },
    }).expect(201);
    await request(app).post("/maintenance-windows").send({
      serviceId: created.body.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      note: "deploy",
    }).expect(201);

    await monitor.runOnce(created.body.id);
    expect(db.getRecentHealthChecks(created.body.id, 5)).toHaveLength(1);
    expect(db.getOpenIncident(created.body.id)).toBeUndefined();
    expect(posts).toEqual([]);
  });

  it("records a failed webhook without dropping the other route", async () => {
    const target = await listen(servers, (_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    const good: string[] = [];
    const hook = await listen(servers, (req, res) => {
      const failed = (req.url ?? "").includes("fail");
      if (!failed) good.push("ok");
      res.statusCode = failed ? 500 : 204;
      res.end();
    });
    const { app, db, monitor } = boot(dirs, databases);
    const created = await request(app).post("/services").send(serviceBody(target.port, "Split")).expect(201);
    await request(app).post("/alert-routes").send({ kind: "webhook", config: { url: `http://127.0.0.1:${hook.port}/fail` } }).expect(201);
    await request(app).post("/alert-routes").send({ kind: "webhook", config: { url: `http://127.0.0.1:${hook.port}/ok` } }).expect(201);
    await monitor.runOnce(created.body.id);
    const incident = db.getOpenIncident(created.body.id);
    expect(incident).toBeTruthy();
    expect(good).toEqual(["ok"]);
    expect(db.listAlertDeliveries(incident!.id).map((row) => row.status).sort()).toEqual(["failed", "sent"]);
  });

  it("sends one email when an incident opens", async () => {
    const target = await listen(servers, (_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    const messages: string[] = [];
    const smtp = net.createServer((socket) => {
      socket.write("220 ready\r\n");
      let collecting = false;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (collecting) {
          if (buffer.includes("\r\n.\r\n")) {
            messages.push(buffer);
            collecting = false;
            buffer = "";
            socket.write("250 accepted\r\n");
          }
          return;
        }
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("DATA")) {
            collecting = true;
            socket.write("354 go\r\n");
          } else if (line.startsWith("QUIT")) {
            socket.write("221 bye\r\n");
            socket.end();
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    sockets.push(smtp);
    const port = await new Promise<number>((resolve) => {
      smtp.listen(0, "127.0.0.1", () => {
        const address = smtp.address();
        resolve(address && typeof address === "object" ? address.port : 0);
      });
    });
    const { app, monitor } = boot(dirs, databases, `smtp://127.0.0.1:${port}`);
    const created = await request(app).post("/services").send(serviceBody(target.port, "Mail API")).expect(201);
    await request(app).post("/alert-routes").send({ kind: "email", config: { to: ["ops@example.com"] } }).expect(201);
    await monitor.runOnce(created.body.id);
    expect(messages.some((message) => message.includes("Mail API"))).toBe(true);
  });
});

function boot(dirs: string[], databases: DatabaseApi[], smtpUrl = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase3-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  initializeDatabase(db);
  databases.push(db);
  const logger = createNoopLogger();
  const monitor = new InMemoryMonitor({
    db,
    registry: createDefaultProbeRegistry(["http"]),
    alerts: new RoutingAlertSink({
      db,
      logger,
      statusBaseUrl: config.STATUS_BASE_URL,
      smtpUrl,
      smtpFrom: smtpUrl ? "ops@example.com" : "",
      fallback: new LoggingAlertSink(logger),
    }),
    logger,
    retry: { retries: 0, baseDelayMs: 1, factor: 1 },
  });
  const app = createApp({ db, config, logger });
  return { app, db, monitor };
}

function serviceBody(port: number, name: string) {
  return {
    name,
    url: `http://127.0.0.1:${port}/health`,
    intervalSeconds: 86400,
    timeoutMs: 1000,
    failureThreshold: 1,
  };
}

function listen(servers: http.Server[], handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise<http.Server & { port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve(Object.assign(server, { port }));
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
