import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import { createNoopLogger } from "../src/utils/logger.js";
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
  VISION_MARKETPLACE_ENABLED: true,
  VISION_STAFF_TOKEN: "staff-token",
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

describe("phase 9", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("teaches a sandbox success check and keeps the monitor example on the reader's machine", async () => {
    const { app } = boot();
    const center = await request(app).get("/learn").expect(200);
    expect(center.text).toContain("Quickstarts");
    expect(center.text).toContain("Tell a provider failure from an owned failure");
    expect(center.text).toContain("Directory glossary");

    const guide = await request(app).get("/learn/evaluate-northwind-payments").expect(200);
    expect(guide.text).toContain("Verified by vision-editorial");
    expect(guide.text).toContain("Cleanup");
    expect(guide.text).toContain("Revoke the test key");
    expect(guide.text).toContain("Success check");
    expect(guide.text).toContain("test identifier");
    expect(guide.text).toContain("Copy example");
    expect(guide.text).toContain("YOUR_API_KEY");
    expect(guide.text).not.toContain("sk_live_");
    expect(guide.headers["content-security-policy"]).toContain("script-src 'nonce-");

    const example = await request(app).get("/learn/evaluate-northwind-payments/example.txt").expect(200);
    expect(example.headers["content-type"]).toMatch(/text\/plain/);
    expect(example.text).toContain("Bearer YOUR_API_TOKEN");
    expect(example.text).toContain("http://127.0.0.1:3000/services");
    expect(example.text).not.toContain("sk_live_");
    expect(example.text).not.toMatch(/-X POST/);
  });

  it("holds a guide update until a reviewer marks it current and refuses secrets", async () => {
    const { app, db } = boot();
    const guide = db.marketplace.getGuideBySlug("evaluate-northwind-payments");
    if (!guide) throw new Error("missing guide");

    const reader = await request(app).post("/api-keys").send({ name: "root", scope: "admin" }).expect(201);
    await request(app)
      .post(`/marketplace/guides/${guide.id}/verify`)
      .set("Authorization", `Bearer ${reader.body.token}`)
      .send({ note: "A monitor key cannot review a guide." })
      .expect(401);

    await request(app)
      .post(`/marketplace/guides/${guide.id}/revisions`)
      .set("Authorization", "Bearer staff-token")
      .send({ note: "Clarify the sandbox step.", purpose: "Use the provider sandbox before any live charge." })
      .expect(201);
    const during = await request(app).get("/learn/evaluate-northwind-payments").expect(200);
    expect(during.text).toContain("An update is in review");
    expect(during.text).toContain("Decide whether this provider belongs in your system");
    expect(during.text).not.toContain("Use the provider sandbox before any live charge.");

    const verified = await request(app)
      .post(`/marketplace/guides/${guide.id}/verify`)
      .set("Authorization", "Bearer staff-token")
      .send({ note: "Checked against the provider docs." })
      .expect(200);
    expect(verified.body.purpose).toBe("Use the provider sandbox before any live charge.");
    const after = await request(app).get("/learn/evaluate-northwind-payments").expect(200);
    expect(after.text).toContain("Use the provider sandbox before any live charge.");
    expect(after.text).not.toContain("An update is in review");

    db.marketplace.updateGuide(guide.id, { verifiedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" });
    const stale = await request(app).get("/learn/evaluate-northwind-payments").expect(200);
    expect(stale.text).toContain("This guide has not been verified recently.");

    await request(app)
      .post("/learn/evaluate-northwind-payments/reports")
      .type("form")
      .send({ kind: "stale", note: "The sandbox steps drifted." })
      .expect(200);
    expect(db.marketplace.listOpenGuideReports().map((report) => report.note)).toContain("The sandbox steps drifted.");

    await request(app)
      .post("/learn/evaluate-northwind-payments/reports")
      .type("form")
      .send({ kind: "error", note: "api_key=sk_live_abcdefghijklmnop" })
      .expect(400);
    expect(db.marketplace.listOpenGuideReports().some((report) => report.note.includes("sk_live_"))).toBe(false);

    await request(app)
      .post(`/marketplace/guides/${guide.id}/revisions`)
      .set("Authorization", "Bearer staff-token")
      .send({ note: "Do not publish this.", exampleText: "API_KEY=sk_live_abcdefghijklmnop" })
      .expect(400);
  });
});

function boot() {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase9-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const app = createApp({
    db,
    config,
    logger: createNoopLogger(),
    marketplace: {
      async resolveHost() {
        return ["93.184.216.34"];
      },
      async fetchImpl() {
        return new Response(null, { status: 204 });
      },
    },
  });
  return { app, db };
}

const dirs: string[] = [];
const databases: DatabaseApi[] = [];
