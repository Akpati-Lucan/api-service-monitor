import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import { assessCompatibility, recordGuideNotice } from "../src/marketplace/expansion.js";
import { createNoopLogger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";
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
  VISION_BILLING_ENABLED: true,
  VISION_BILLING_WEBHOOK_SECRET: "",
  VISION_STRIPE_SECRET_KEY: "",
  VISION_PLATFORM_FEE_BPS: 0,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VISION_INTEGRATIONS_ENABLED: true,
  VISION_GATEWAY_ENABLED: false,
  VISION_INTEGRATION_KEY: "",
  VISION_INTEGRATION_KEY_VERSION: 1,
  VISION_INTEGRATION_KEY_PREVIOUS: "",
  VISION_EXAMPLE_AUTHORIZE_URL: "",
  VISION_EXAMPLE_TOKEN_URL: "",
  VISION_EXAMPLE_HEALTH_URL: "",
  VISION_EXAMPLE_CLIENT_ID: "",
  VERSION: "1.0.0",
};

describe("phase 14", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("requires a published listing, a clean example, and a current review date", () => {
    expect(assessCompatibility({ published: false, httpsLinks: 1, example: "Read the status page.", now: "2026-11-17T00:00:00.000Z" }).sentence).toBe("The listing is not published.");
    expect(assessCompatibility({ published: true, httpsLinks: 0, example: "Read the status page.", now: "2026-11-17T00:00:00.000Z" }).sentence).toBe("The listing needs a reviewed HTTPS link.");
    const leaked = assessCompatibility({ published: true, httpsLinks: 1, example: "API_KEY=sk_live_abcdefghij", now: "2026-11-17T00:00:00.000Z" });
    expect(leaked.passed).toBe(false);
    expect(leaked.sentence).toBe("The example contains a credential.");
    expect(leaked.sentence).not.toContain("sk_live_abcdefghij");
    expect(assessCompatibility({ published: true, httpsLinks: 1, example: "Read the status page.", now: "2026-11-17T00:00:00.000Z" }).passed).toBe(true);
  });

  it("keeps collections private and totals on the publisher's own listing", async () => {
    const mail: OutboundMail[] = [];
    const { app, db } = boot(mail);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const created = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf, name: "Northwind" }).expect(200);
    const organizationId = hidden(created.text, "organizationId");
    const listingId = "lst_phase14_status";
    const now = new Date().toISOString();
    db.marketplace.insertListing({
      id: listingId, slug: "phase14-status", publisherId: organizationId, name: "Phase14 Status", summary: "A read-only status signal.",
      descriptionMd: "The provider hosts the signal.", category: "payments", tags: [], listingType: "api", pricingModel: "subscription",
      currency: "USD", priceSummary: "USD 19.99 per month", providerName: "Example", providerDomain: "example.com",
      docsUrl: "https://example.com/docs", signupUrl: null, pricingUrl: null, statusUrl: null, termsUrl: "https://example.com/terms",
      privacyUrl: "https://example.com/privacy", regions: ["US"], capabilities: [], requirements: [], createdAt: now,
    });
    db.marketplace.updateListing(listingId, { status: "published", publishedAt: now, updatedAt: now });
    const saved = await ada.post("/collections/items").type("form").send({ csrf: adaCsrf, organizationId, listingId, name: "Saved" }).expect(200);
    expect(saved.text).toContain("Phase14 Status");
    const collectionId = /\/collections\/([^/]+)\/compare/.exec(saved.text)?.[1] ?? "";
    const compared = await ada.get(`/collections/${collectionId}/compare`).expect(200);
    expect(compared.text).toContain("A read-only status signal.");
    expect(compared.text).toContain("USD 19.99 per month");
    await ada.post(`/publisher/listings/${listingId}/notices`).type("form").send({ csrf: adaCsrf, organizationId, versionLabel: "2", summary: "Version 2 adds a status field." }).expect(302);
    const noticed = await ada.get("/collections").expect(200);
    expect(noticed.text).toContain("Version 2 adds a status field.");
    recordGuideNotice(db.expansion, listingId, 3, now);
    const guided = await ada.get(`/vision/phase14-status`).expect(200);
    expect(guided.text).toContain("A verified guide was updated.");
    expect(guided.text).not.toContain("Rate this");

    const bob = request.agent(app);
    const bobCsrf = await signup(app, bob, mail, "bob@northwind.test");
    const bobOrg = await bob.post("/publisher/organizations").type("form").send({ csrf: bobCsrf, name: "Contoso" }).expect(200);
    const buyerId = hidden(bobOrg.text, "organizationId");
    await bob.get(`/collections?organizationId=${organizationId}`).expect(404);
    await bob.get(`/collections/${collectionId}/compare`).expect(404);
    const cara = request.agent(app);
    await signup(app, cara, mail, "cara@northwind.test");
    const viewer = db.identity.getCredentialByEmail("cara@northwind.test");
    db.identity.insertMember({ organizationId, userId: viewer?.id ?? "", role: "viewer", createdAt: now });
    const caraPage = await cara.get("/collections").expect(200);
    const caraCsrf = hidden(caraPage.text, "csrf");
    const blocked = await cara.post("/collections/items").type("form").send({ csrf: caraCsrf, organizationId, listingId, name: "Saved" }).expect(403);
    expect(blocked.text).toContain("This action needs an owner, an admin, or an editor.");

    const offerId = "offer_phase14";
    db.billing.insertOffer({
      id: offerId, listingId, publisherId: organizationId, planName: "Status plan", billingInterval: "month", amountMinor: 1999, currency: "USD",
      providerPriceRef: "price_phase14", status: "active", createdAt: now, updatedAt: now,
    });
    db.billing.insertCheckoutAttempt({ id: "chk_phase14", organizationId: buyerId, offerId, idempotencyKey: "phase14-checkout-key", country: "US", hostedUrl: "https://example.com/checkout", createdAt: now });
    db.billing.insertSubscription({
      id: "sub_row_active", organizationId: buyerId, offerId, processor: "record", processorCustomerRef: "cus_phase14", processorSubscriptionRef: "sub_phase14_hidden",
      state: "active", periodStart: now, periodEnd: now, cancelAtPeriodEnd: false, canceledAt: null, disputeOpen: false, createdAt: now, updatedAt: now,
    });
    db.billing.insertSubscription({
      id: "sub_row_canceled", organizationId: buyerId, offerId, processor: "record", processorCustomerRef: "cus_phase14", processorSubscriptionRef: "sub_phase14_old",
      state: "canceled", periodStart: now, periodEnd: now, cancelAtPeriodEnd: false, canceledAt: now, disputeOpen: false, createdAt: now, updatedAt: now,
    });
    db.billing.insertLedger({
      organizationId: buyerId, publisherId: organizationId, subscriptionId: "sub_row_active", processor: "record", currency: "USD",
      grossMinor: 500, feeMinor: 0, taxMinor: 0, netMinor: 500, payoutStatus: "reversed", kind: "refund", period: "2026-11",
      transferRef: "re_phase14_hidden", sourceEventRef: "evt_phase14_refund", createdAt: now,
    });
    const metrics = await ada.get(`/publisher/listings/${listingId}/metrics`).expect(200);
    expect(metrics.body).toMatchObject({ checkoutStarts: 1, activeSubscriptions: 1, canceledSubscriptions: 1, refundMinor: 500 });
    expect(JSON.stringify(metrics.body)).not.toContain("sub_phase14_hidden");
    expect(JSON.stringify(metrics.body)).not.toContain("bob@northwind.test");
    const detail = await ada.get(`/publisher/listings/${listingId}`).expect(200);
    expect(detail.text).toContain("Checkout starts 1.");
    expect(detail.text).toContain("Refunds 500 minor units.");
    expect(detail.text).not.toContain("sub_phase14_hidden");
    expect(detail.text).not.toContain("re_phase14_hidden");
    await bob.get(`/publisher/listings/${listingId}/metrics`).expect(404);

    const secret = "sk_live_abcdefghij";
    const rejected = await request(app).post("/vision/editor/listings/lst_northwind_payments/compatibility").type("form").send({ token: "staff-token", example: `API_KEY=${secret}` }).expect(409);
    expect(rejected.text).toContain("The example contains a credential.");
    expect(rejected.text).not.toContain(secret);
    const reviewed = await request(app).post("/vision/editor/listings/lst_northwind_payments/compatibility").type("form").send({ token: "staff-token", example: "Read the status page." }).expect(200);
    expect(reviewed.text).toContain("Compatibility reviewed");
    const listed = await request(app).get("/vision/northwind-payments").expect(200);
    expect(listed.text).toContain("Compatibility reviewed");
    expect(listed.text).not.toContain("Rate this");
    db.expansion.saveCompatibility({ listingId: "lst_northwind_payments", reviewedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-06-01T00:00:00.000Z" });
    const expired = await request(app).get("/vision/northwind-payments").expect(200);
    expect(expired.text).not.toContain("Compatibility reviewed");

    const before = db.listServices().length;
    await request(app).get("/vision/northwind-payments").expect(200);
    expect(db.listServices()).toHaveLength(before);
    await request(app).post("/vision/editor/listings/lst_northwind_payments/template").type("form").send({ token: "staff-token", urlTemplate: "https://{host}/health" }).expect(200);
    const monitor = await ada.get("/collections/monitor?listingId=lst_northwind_payments").expect(200);
    expect(monitor.text).toContain("The value stays in the environment.");
    const made = await ada.post("/collections/monitors").type("form").send({
      csrf: adaCsrf, organizationId, listingId: "lst_northwind_payments", name: "Northwind status", host: "status.example.com", secretRef: "NORTHWIND_TOKEN",
    }).expect(200);
    expect(made.text).toContain("https://status.example.com/health");
    expect(made.text).toContain("NORTHWIND_TOKEN");
    expect(made.text).not.toContain(secret);
    expect(db.listServices()).toHaveLength(before + 1);
    expect(db.listServices().some((service) => service.secretRef === "NORTHWIND_TOKEN" && service.url === "https://status.example.com/health")).toBe(true);
    const refused = await ada.post("/collections/monitors").type("form").send({
      csrf: adaCsrf, organizationId, listingId: "lst_northwind_payments", name: "Northwind status", host: "status.example.com", secretRef: secret,
    }).expect(400);
    expect(refused.text).toContain("The secret reference is an environment variable name.");
    expect(refused.text).not.toContain(secret);
    expect(db.listServices()).toHaveLength(before + 1);
    await ada.post("/collections/monitors").type("form").send({
      csrf: adaCsrf, organizationId, listingId: "lst_northwind_payments", name: "Local status", host: "localhost", secretRef: "NORTHWIND_TOKEN",
    }).expect(400);
    await request(app).get("/sdk").expect(404);

    const closed = boot(mail, false);
    await request(closed.app).get("/collections").expect(404);
    await request(closed.app).get("/vision").expect(200);
  });
});

const dirs: string[] = [];
const databases: DatabaseApi[] = [];

function boot(mail: OutboundMail[], portal = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase14-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const app = createApp({
    db,
    config: { ...config, VISION_PUBLISHER_PORTAL_ENABLED: portal },
    logger: createNoopLogger(),
    marketplace: {
      async mailer(message) { mail.push(message); },
      async resolveHost() { return ["93.184.216.34"]; },
      async fetchImpl() { return new Response("ok", { status: 200 }); },
    },
  });
  return { app, db };
}

async function signup(app: ReturnType<typeof createApp>, agent: ReturnType<typeof request.agent>, mail: OutboundMail[], email: string) {
  await agent.post("/account/register").type("form").send({ email, displayName: email.split("@")[0] ?? "Publisher", password: "correct-horse-battery" }).expect(200);
  const message = mail.find((item) => item.to === email && item.subject.includes("Verify"));
  const token = /token=([a-f0-9]+)/.exec(message?.text ?? "")?.[1] ?? "";
  await request(app).get(`/account/verify?token=${token}`).expect(200);
  const login = await agent.post("/account/login").type("form").send({ email, password: "correct-horse-battery" }).expect(200);
  return hidden(login.text, "csrf");
}

function hidden(html: string, name: string): string {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
}
