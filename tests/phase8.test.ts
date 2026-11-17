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
  VISION_MARKETPLACE_ENABLED: true,
  VISION_STAFF_TOKEN: "staff-token",
  VISION_PUBLIC_RATE_LIMIT: 60,
  VISION_PUBLISHER_PORTAL_ENABLED: false,
  VERSION: "1.0.0",
};

describe("phase 8", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("keeps the monitor available while the directory is disabled", async () => {
    const { app } = boot({ ...config, VISION_MARKETPLACE_ENABLED: false });
    await request(app).get("/services").expect(200);
    await request(app).get("/vision").expect(404);
    await request(app).get("/marketplace/listings").expect(404);
    await request(app).get("/go/lst_northwind_payments/lnk_payments_docs").expect(404);
  });

  it("lists curated providers, hides internal notes, and counts a verified outbound click", async () => {
    const { app, db } = boot(config);
    const page = await request(app).get("/vision").expect(200);
    expect(page.text).toContain("Vision API");
    expect(page.text).toContain("External provider");
    expect(page.text).toContain("Northwind Payments");
    expect(page.text).not.toContain("Seed reviewed");

    const empty = await request(app).get("/vision?q=zzzz-no-match").expect(200);
    expect(empty.text).toContain("No listings match this search.");

    const payments = await request(app).get("/vision?category=payments").expect(200);
    expect(payments.text).toContain("Northwind Payments");
    expect(payments.text).not.toContain("Northwind Messages");

    const detail = await request(app).get("/vision/northwind-payments").expect(200);
    expect(detail.text).toContain("This link leaves Vision API.");
    expect(detail.text).toContain("does not sell it");
    expect(detail.text).not.toContain("Seed reviewed");

    const guide = await request(app).get("/learn/evaluate-northwind-payments").expect(200);
    expect(guide.text).toContain("Verified by vision-editorial");
    expect(guide.text).toContain("No Vision API credential is required.");
    expect(guide.text).toContain("YOUR_API_KEY");
    expect(guide.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(guide.text).not.toContain("<script>alert");

    const gone = await request(app)
      .get("/go/lst_northwind_payments/lnk_payments_docs")
      .set("Referer", "https://google.com/search?q=secret")
      .expect(302);
    expect(gone.headers.location).toBe("https://example.com/payments/docs");
    expect(db.marketplace.listEvents("lst_northwind_payments").some((event) => event.coarseReferrer === "google.com")).toBe(true);
    expect(JSON.stringify(db.marketplace.listEvents("lst_northwind_payments"))).not.toContain("secret");

    const metrics = await request(app)
      .get("/marketplace/listings/lst_northwind_payments/metrics")
      .set("Authorization", "Bearer staff-token")
      .expect(200);
    expect(metrics.body.outboundClicks).toBe(1);
    expect(metrics.body.views).toBeGreaterThan(0);
  });

  it("refuses a private destination, a monitor key, and an unpublished redirect", async () => {
    const { app } = boot(config);
    const reader = await request(app).post("/api-keys").send({ name: "root", scope: "admin" }).expect(201);
    const body = listingBody();
    await request(app)
      .post("/marketplace/listings")
      .set("Authorization", `Bearer ${reader.body.token}`)
      .send(body)
      .expect(401);

    const created = await request(app)
      .post("/marketplace/listings")
      .set("Authorization", "Bearer staff-token")
      .send(body)
      .expect(201);
    expect(created.body.status).toBe("draft");
    await request(app).get(`/vision/${created.body.slug}`).expect(404);

    await request(app)
      .post(`/marketplace/listings/${created.body.id}/submit`)
      .set("Authorization", "Bearer staff-token")
      .expect(200);
    const changes = await request(app)
      .post(`/marketplace/listings/${created.body.id}/review`)
      .set("Authorization", "Bearer staff-token")
      .send({ decision: "changes", note: "Add the provider status link." })
      .expect(200);
    expect(changes.body.status).toBe("changes_requested");

    await request(app)
      .post(`/marketplace/listings/${created.body.id}/submit`)
      .set("Authorization", "Bearer staff-token")
      .expect(200);
    const published = await request(app)
      .post(`/marketplace/listings/${created.body.id}/review`)
      .set("Authorization", "Bearer staff-token")
      .send({ decision: "approve", note: "Links stay on example.com." })
      .expect(200);
    expect(published.body.status).toBe("published");

    const directory = await request(app).get("/vision").expect(200);
    expect(directory.text).toContain("Harbor Ledger");

    const suspended = await request(app)
      .post(`/marketplace/listings/${created.body.id}/review`)
      .set("Authorization", "Bearer staff-token")
      .send({ decision: "suspend", note: "Provider asked for a pause." })
      .expect(200);
    expect(suspended.body.status).toBe("suspended");
    const hidden = await request(app).get("/vision/harbor-ledger").expect(200);
    expect(hidden.text).toContain("Temporarily unavailable");
    expect(hidden.text).not.toContain("/go/");
    await request(app).get(`/go/${created.body.id}/${published.body.links[0].id}`).expect(404);

    const retired = await request(app)
      .post(`/marketplace/listings/${created.body.id}/retire`)
      .set("Authorization", "Bearer staff-token")
      .send({ note: "Retired from the directory." })
      .expect(200);
    expect(retired.body.status).toBe("archived");
    const retiredPage = await request(app).get("/vision/harbor-ledger").expect(200);
    expect(retiredPage.text).toContain("Retired");

    await request(app)
      .post("/marketplace/listings")
      .set("Authorization", "Bearer staff-token")
      .send({ ...body, name: "Local Ledger", docsUrl: "http://127.0.0.1/docs" })
      .expect(400);
    await request(app)
      .post("/marketplace/listings")
      .set("Authorization", "Bearer staff-token")
      .send({ ...body, name: "Secret Ledger", docsUrl: "https://user:pass@example.com/docs" })
      .expect(400);
    await request(app)
      .post("/marketplace/listings")
      .set("Authorization", "Bearer staff-token")
      .send({ ...body, name: "Redirect Ledger", docsUrl: "https://example.com/redirect-private" })
      .expect(400);
  });

  it("limits repeated public directory requests", async () => {
    const { app } = boot({ ...config, VISION_PUBLIC_RATE_LIMIT: 2 });
    await request(app).get("/vision").expect(200);
    await request(app).get("/vision").expect(200);
    await request(app).get("/vision").expect(429);
  });
});

function listingBody() {
  return {
    name: "Harbor Ledger",
    summary: "A ledger API operated by Example.",
    descriptionMd: "Read the provider documentation before use.",
    category: "data",
    tags: ["ledger"],
    listingType: "api",
    pricingModel: "external",
    providerName: "Example",
    providerDomain: "example.com",
    docsUrl: "https://example.com/ledger/docs",
    signupUrl: "https://example.com/ledger/signup",
    pricingUrl: "https://example.com/ledger/pricing",
    statusUrl: "https://example.com/ledger/status",
    termsUrl: "https://example.com/ledger/terms",
    privacyUrl: "https://example.com/ledger/privacy",
    regions: ["us"],
    capabilities: ["entries"],
    requirements: ["A provider account"],
  };
}

function boot(appConfig: AppConfig) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase8-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const app = createApp({
    db,
    config: appConfig,
    logger: createNoopLogger(),
    marketplace: {
      async resolveHost(hostname: string) {
        return hostname === "example.com" || hostname.endsWith(".example.com") ? ["93.184.216.34"] : ["10.0.0.8"];
      },
      async fetchImpl(url) {
        const target = String(url);
        if (target.includes("redirect-private")) {
          return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
        }
        return new Response(null, { status: 204 });
      },
    },
  });
  return { app, db };
}

const dirs: string[] = [];
const databases: DatabaseApi[] = [];
