import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { RoutingAlertSink } from "../src/alerts/routing.js";
import { LoggingAlertSink } from "../src/services/alert.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AlertEvent } from "../src/types/index.js";

describe("alerts", () => {
  const dirs: string[] = [];
  const databases: DatabaseApi[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const db of databases.splice(0)) db.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.SLACK_HOOK;
  });

  it("records a failed webhook and still delivers the next route", async () => {
    const db = openDb();
    const bad = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("no");
    });
    const good: unknown[] = [];
    const ok = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        good.push(JSON.parse(body));
        res.statusCode = 204;
        res.end();
      });
    });
    db.createAlertRoute({ groupId: null, kind: "webhook", config: { url: `http://127.0.0.1:${bad.port}/hook` }, secretRef: null });
    db.createAlertRoute({ groupId: null, kind: "webhook", config: { url: `http://127.0.0.1:${ok.port}/hook` }, secretRef: null });
    const sink = new RoutingAlertSink({
      db,
      logger: createNoopLogger(),
      statusBaseUrl: "http://localhost:3000",
      smtpUrl: "",
      smtpFrom: "",
      fallback: new LoggingAlertSink(createNoopLogger()),
    });
    const event = sampleEvent(db);
    await sink.notify(event);
    expect(good).toHaveLength(1);
    expect(db.listAlertDeliveries(event.incident.id).map((row) => row.status).sort()).toEqual(["failed", "sent"]);
  });

  it("posts slack text and sends email through smtp", async () => {
    const db = openDb();
    const slack: Array<{ text?: string; channel?: string }> = [];
    const hook = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        slack.push(JSON.parse(body) as { text?: string; channel?: string });
        res.statusCode = 200;
        res.end("ok");
      });
    });
    process.env.SLACK_HOOK = `http://127.0.0.1:${hook.port}/slack`;
    db.createAlertRoute({ groupId: null, kind: "slack", config: { channel: "#ops" }, secretRef: "SLACK_HOOK" });
    const smtp = await smtpServer();
    db.createAlertRoute({ groupId: null, kind: "email", config: { to: ["ops@example.com"] }, secretRef: null });
    const sink = new RoutingAlertSink({
      db,
      logger: createNoopLogger(),
      statusBaseUrl: "http://localhost:3000",
      smtpUrl: `smtp://127.0.0.1:${smtp.port}`,
      smtpFrom: "monitor@example.com",
      fallback: new LoggingAlertSink(createNoopLogger()),
    });
    const event = sampleEvent(db);
    await sink.notify(event);
    expect(slack[0]?.channel).toBe("#ops");
    expect(slack[0]?.text).toContain("Payments");
    expect(slack[0]?.text).toContain("opened");
    expect(smtp.messages.some((message) => message.includes("ops@example.com"))).toBe(true);
    expect(db.listAlertDeliveries(event.incident.id).every((row) => row.status === "sent")).toBe(true);
    smtp.close();
  });

  function openDb() {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-alerts-"));
    dirs.push(dir);
    const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
    initializeDatabase(db);
    databases.push(db);
    return db;
  }

  function listen(handler: http.RequestListener) {
    const server = http.createServer(handler);
    servers.push(server);
    return new Promise<{ port: number }>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") resolve({ port: address.port });
      });
    });
  }
});

function sampleEvent(db: DatabaseApi): AlertEvent {
  const service = db.createService({
    name: "Payments",
    url: "http://127.0.0.1:9/health",
    intervalSeconds: 60,
    timeoutMs: 1000,
    failureThreshold: 1,
  });
  const incident = db.openIncident({ serviceId: service.id, reason: "HTTP 500", errorClass: "http_status" });
  return { service, incident, kind: "opened" };
}

function smtpServer() {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("220 ready\r\n");
    let mode: "lines" | "data" = "lines";
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (mode === "lines") {
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line === "DATA") {
            mode = "data";
            socket.write("354 go\r\n");
          } else {
            socket.write("250 ok\r\n");
          }
        }
        return;
      }
      if (buffer.includes("\r\n.\r\n")) {
        messages.push(buffer);
        buffer = "";
        mode = "lines";
        socket.write("250 queued\r\n");
      }
    });
  });
  return new Promise<{ port: number; messages: string[]; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        resolve({ port: address.port, messages, close: () => server.close() });
      }
    });
  });
}
