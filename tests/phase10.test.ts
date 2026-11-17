import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";
import type { DatabaseApi } from "../src/db/database.js";
import type { OutboundMail } from "../src/marketplace/publisher.js";

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
  VISION_PUBLISHER_PORTAL_ENABLED: true,
  VISION_BILLING_ENABLED: false,
  VISION_BILLING_WEBHOOK_SECRET: "",
  VISION_STRIPE_SECRET_KEY: "",
  VISION_PLATFORM_FEE_BPS: 0,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VERSION: "1.0.0",
};

describe("phase 10", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("keeps a publisher inside one organization and records review", async () => {
    const mail: OutboundMail[] = [];
    let txt = "";
    const { app, db, dbPath } = boot(mail, () => (txt ? [`vision-verify=${txt}`] : []));
    const raw = new Database(dbPath, { readonly: true });
    const orgSql = raw.prepare(`SELECT sql FROM sqlite_master WHERE name = 'organizations'`).get() as { sql: string };
    const profileSql = raw.prepare(`SELECT sql FROM sqlite_master WHERE name = 'publisher_profiles'`).get() as { sql: string };
    raw.close();
    expect(orgSql.sql).not.toContain("group_id");
    expect(profileSql.sql.toLowerCase()).not.toContain("payment");

    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const orgPage = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf, name: "Northwind" }).expect(200);
    const organizationId = hidden(orgPage.text, "organizationId");
    expect(organizationId).toBeTruthy();

    await ada.post("/publisher/profile").type("form").send({
      csrf: adaCsrf,
      organizationId,
      legalName: "Northwind Ledger",
      supportUrl: "https://northwind.test/support",
      privacyUrl: "https://northwind.test/privacy",
      termsUrl: "https://northwind.test/terms",
      regions: "US, CA",
    }).expect(200);

    const domainPage = await ada.post("/publisher/domains").type("form").send({
      csrf: adaCsrf,
      organizationId,
      domain: "northwind.test",
      method: "dns_txt",
    }).expect(200);
    txt = /vision-verify=([a-f0-9]+)/.exec(domainPage.text)?.[1] ?? "";
    expect(txt).toBeTruthy();
    const domainId = /\/publisher\/domains\/([^/]+)\/check/.exec(domainPage.text)?.[1] ?? "";

    const draft = await ada.post("/publisher/listings").type("form").send(listingFields(adaCsrf, organizationId, "Northwind Ledger API")).expect(200);
    const listingId = /\/publisher\/listings\/([0-9a-f-]{36})/.exec(draft.text)?.[1] ?? "";
    expect(draft.text).toContain("Preview");
    await ada.post(`/publisher/listings/${listingId}/submit`).type("form").send({ csrf: adaCsrf, organizationId }).expect(400);

    await ada.post(`/publisher/domains/${domainId}/check`).type("form").send({ csrf: adaCsrf, organizationId }).expect(200);
    await ada.post(`/publisher/listings/${listingId}/submit`).type("form").send({ csrf: adaCsrf, organizationId }).expect(200);
    await request(app).get("/vision/northwind-ledger-api").expect(404);

    const bob = request.agent(app);
    const bobCsrf = await signup(app, bob, mail, "bob@other.test");
    await bob.get(`/publisher/listings/${listingId}`).expect(404);
    const bobHome = await bob.get("/publisher").expect(200);
    expect(bobHome.text).not.toContain("Northwind Ledger API");

    const reader = await request(app).post("/api-keys").send({ name: "root", scope: "admin" }).expect(201);
    await request(app)
      .post(`/publisher/listings/${listingId}/submit`)
      .set("Authorization", `Bearer ${reader.body.token}`)
      .expect(401);
    await ada.post("/publisher/organizations").type("form").send({ name: "Second" }).expect(403);

    await request(app)
      .post(`/marketplace/listings/${listingId}/review`)
      .set("Authorization", "Bearer staff-token")
      .send({ decision: "changes", note: "Name the sandbox in the summary." })
      .expect(200);
    const noticed = await ada.get("/publisher").expect(200);
    expect(noticed.text).toContain("Name the sandbox in the summary.");
    const editor = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(editor.text).toContain("listing.review");
    expect(editor.text).not.toContain("correct-horse-battery");

    await ada.post(`/publisher/listings/${listingId}`).type("form").send({
      ...listingFields(adaCsrf, organizationId, "Northwind Ledger API"),
      summary: "Sandbox charges only.",
    }).expect(200);
    await ada.post(`/publisher/listings/${listingId}/submit`).type("form").send({ csrf: adaCsrf, organizationId }).expect(200);
    await request(app)
      .post(`/marketplace/listings/${listingId}/review`)
      .set("Authorization", "Bearer staff-token")
      .send({ decision: "approve", note: "Sandbox summary is present." })
      .expect(200);
    const published = await request(app).get("/vision/northwind-ledger-api").expect(200);
    expect(published.text).toContain("Northwind Ledger API");
    expect(published.text).not.toContain("Sandbox summary is present.");

    await ada.post(`/publisher/listings/${listingId}`).type("form").send(listingFields(adaCsrf, organizationId, "Northwind Ledger API")).expect(200);
    await request(app).get("/vision/northwind-ledger-api").expect(404);

    const guide = await ada.post(`/publisher/listings/${listingId}/guides`).type("form").send({
      csrf: adaCsrf,
      organizationId,
      title: "Ledger sandbox",
      summary: "Use the provider sandbox.",
      bodyMd: "Call the sandbox with YOUR_API_KEY.",
    }).expect(200);
    expect(guide.text).toContain("stays unpublished");
    await request(app).get("/learn/ledger-sandbox").expect(404);
    await ada.post(`/publisher/listings/${listingId}/guides`).type("form").send({
      csrf: adaCsrf,
      organizationId,
      title: "Bad example",
      summary: "Do not store this.",
      bodyMd: "API_KEY=sk_live_abcdefghijklmnop",
    }).expect(400);

    const exported = await ada.get("/account/export").expect(200);
    expect(exported.text).not.toContain("scrypt$");
    expect(exported.text).not.toContain("correct-horse-battery");
    expect(exported.text).toContain("Northwind Ledger API");

    const removed = await ada.post("/account/delete").type("form").send({ csrf: adaCsrf, password: "correct-horse-battery" }).expect(409);
    expect(removed.text).toContain("Transfer ownership");
    await ada.get("/account").expect(200);
  });

  it("leaves the portal closed when the flag is off", async () => {
    const { app } = boot([], () => [], false);
    await request(app).get("/account").expect(404);
    await request(app).get("/publisher").expect(404);
    await request(app).get("/services").expect(200);
  });
});

async function signup(app: ReturnType<typeof createApp>, agent: ReturnType<typeof request.agent>, mail: OutboundMail[], email: string) {
  await agent.post("/account/register").type("form").send({
    email,
    displayName: email.split("@")[0] ?? "Publisher",
    password: "correct-horse-battery",
  }).expect(200);
  const message = mail.find((item) => item.to === email && item.subject.includes("Verify"));
  const token = /token=([a-f0-9]+)/.exec(message?.text ?? "")?.[1] ?? "";
  await request(app).get(`/account/verify?token=${token}`).expect(200);
  const login = await agent.post("/account/login").type("form").send({ email, password: "correct-horse-battery" }).expect(200);
  expect(String(login.headers["set-cookie"])).toContain("HttpOnly");
  expect(String(login.headers["set-cookie"])).toContain("SameSite=Lax");
  return hidden(login.text, "csrf");
}

function listingFields(csrf: string, organizationId: string, name: string) {
  return {
    csrf,
    organizationId,
    name,
    summary: "A provider API for the sandbox.",
    descriptionMd: "The provider hosts the service.",
    category: "payments",
    providerName: "Northwind",
    providerDomain: "northwind.test",
    docsUrl: "https://northwind.test/docs",
    termsUrl: "https://northwind.test/terms",
    privacyUrl: "https://northwind.test/privacy",
    signupUrl: "https://northwind.test/signup",
  };
}

function hidden(html: string, name: string): string {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
}

function boot(mail: OutboundMail[], resolveTxt: () => string[], portal = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase10-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "monitor.db");
  const db = createDatabase({ dbPath });
  databases.push(db);
  initializeDatabase(db);
  const app = createApp({
    db,
    config: { ...config, VISION_PUBLISHER_PORTAL_ENABLED: portal },
    logger: createNoopLogger(),
    marketplace: {
      async resolveHost() {
        return ["93.184.216.34"];
      },
      async fetchImpl() {
        return new Response(null, { status: 204 });
      },
      async resolveTxt() {
        return resolveTxt();
      },
      async mailer(message) {
        mail.push(message);
      },
    },
  });
  return { app, db, dbPath };
}

const dirs: string[] = [];
const databases: DatabaseApi[] = [];
