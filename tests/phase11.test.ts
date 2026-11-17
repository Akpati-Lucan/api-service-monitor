import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import { createNoopLogger, type Logger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";
import type { OutboundMail } from "../src/marketplace/publisher.js";
import { createRecordProcessor, createStripeProcessor, signStripePayload } from "../src/marketplace/billing.js";

const secret = "whsec_phase11";
const card = "4242424242424242";

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
  VISION_BILLING_WEBHOOK_SECRET: secret,
  VISION_STRIPE_SECRET_KEY: "",
  VISION_PLATFORM_FEE_BPS: 0,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VERSION: "1.0.0",
};

describe("phase 11", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("projects a signed marketplace subscription and keeps checkout closed", async () => {
    const mail: OutboundMail[] = [];
    const logged: string[] = [];
    const processor = createRecordProcessor(secret, config.STATUS_BASE_URL);
    const { app, db } = boot(mail, logged, processor);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const orgPage = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf, name: "Northwind" }).expect(200);
    const organizationId = hidden(orgPage.text, "organizationId");
    const listingId = "lst_phase11_ledger";
    db.marketplace.insertListing({
      id: listingId,
      slug: "phase11-ledger",
      publisherId: organizationId,
      name: "Phase11 Ledger",
      summary: "A sandbox ledger.",
      descriptionMd: "The provider hosts the ledger.",
      category: "payments",
      tags: [],
      listingType: "api",
      pricingModel: "subscription",
      currency: "USD",
      priceSummary: null,
      providerName: "Example",
      providerDomain: "example.com",
      docsUrl: "https://example.com/docs",
      signupUrl: null,
      pricingUrl: null,
      statusUrl: null,
      termsUrl: "https://example.com/terms",
      privacyUrl: "https://example.com/privacy",
      regions: [],
      capabilities: [],
      requirements: [],
      createdAt: new Date().toISOString(),
    });

    const offered = await ada.post("/publisher/offers").type("form").send({
      csrf: adaCsrf,
      organizationId,
      listingId,
      planName: "Ada Sandbox Plan",
      billingInterval: "month",
      amountMinor: "1999",
      currency: "USD",
    }).expect(200);
    expect(offered.text).toContain("USD 19.99");
    expect(offered.text).toContain("draft");
    await ada.post("/publisher/offers").type("form").send({
      csrf: adaCsrf,
      organizationId,
      listingId,
      planName: "Usage plan",
      billingInterval: "usage",
      amountMinor: "100",
      currency: "USD",
    }).expect(400);

    const editor = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    const offerId = /\/vision\/editor\/offers\/([^/]+)\/activate/.exec(editor.text)?.[1] ?? "";
    expect(offerId).toBeTruthy();
    await request(app).post(`/vision/editor/offers/${offerId}/activate`).type("form").send({ token: "staff-token", providerPriceRef: "price_ada" }).expect(200);

    const nowSec = Math.floor(Date.now() / 1000);
    const periodEnd = new Date((nowSec + 86400 * 20) * 1000).toISOString();
    const subscription = (status: string, created: number, cancelAtPeriodEnd = false) => JSON.stringify({
      id: `evt_${status}_${created}`,
      type: "customer.subscription.updated",
      created,
      data: {
        object: {
          id: "sub_ada_1",
          customer: "cus_ada_1",
          status,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: status === "canceled" ? created : null,
          metadata: { organization_id: organizationId, offer_id: offerId },
          current_period_start: created,
          current_period_end: nowSec + 86400 * 20,
          card: { number: card },
          items: { data: [{ price: { id: "price_ada" } }] },
        },
      },
    });
    const postEvent = (body: string) => request(app)
      .post("/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signStripePayload(secret, Buffer.from(body), nowSec))
      .send(body);

    const forged = subscription("active", nowSec - 100).replace(card, card);
    await request(app).post("/billing/webhook").set("Content-Type", "application/json").set("Stripe-Signature", "t=1,v1=dead").send(forged).expect(400);
    expect(logged.join("")).not.toContain(card);
    await postEvent(JSON.stringify({ id: "evt_product", type: "product.created", created: nowSec - 120, data: { object: { id: "prod_1", card: { number: card } } } })).expect(200);
    const before = await ada.get("/billing").expect(200);
    expect(before.text).toContain("No Vision API marketplace subscriptions.");
    expect(before.text).not.toContain("Ada Sandbox Plan");

    const active = subscription("active", nowSec - 100);
    await postEvent(active).expect(200);
    await postEvent(active).expect(200);
    const page = await ada.get("/billing").expect(200);
    expect(page.text.split("Open hosted portal").length - 1).toBe(1);
    expect(page.text).toContain("Ada Sandbox Plan");
    expect(page.text).toContain("USD 19.99");
    expect(page.text).toContain("State: active");
    expect(page.text).toContain(`Next renewal ${periodEnd}`);
    expect(page.text).toContain("Reported by the payment processor");
    expect(page.text).not.toContain("sub_ada_1");
    expect(page.text).not.toContain("cus_ada_1");
    expect(page.text).not.toContain(card);
    expect(logged.join("")).not.toContain(card);

    const bob = request.agent(app);
    const bobCsrf = await signup(app, bob, mail, "bob@other.test");
    const bobPage = await bob.get("/billing").expect(200);
    expect(bobPage.text).not.toContain("Ada Sandbox Plan");
    await bob.get(`/billing?organizationId=${organizationId}`).expect(404);
    await bob.post("/billing/portal").type("form").send({ csrf: bobCsrf, organizationId, subscriptionId: "missing" }).expect(404);

    const reader = await request(app).post("/api-keys").send({ name: "root", scope: "admin" }).expect(201);
    await request(app).get("/billing").set("Authorization", `Bearer ${reader.body.token}`).expect(401);

    const subscriptionId = hidden(page.text, "subscriptionId");
    const portal = await ada.post("/billing/portal").type("form").send({ csrf: adaCsrf, organizationId, subscriptionId }).expect(302);
    expect(portal.headers.location).toBe("http://localhost:3000/billing/processor-portal");
    const hosted = await ada.get("/billing/processor-portal").expect(200);
    expect(hosted.text).toContain("Card numbers and security codes are not collected on this page.");
    await ada.post("/billing/checkout").type("form").send({ csrf: adaCsrf, organizationId }).expect(409);

    const cara = request.agent(app);
    const caraCsrf = await signup(app, cara, mail, "cara@northwind.test");
    const caraUser = db.identity.getCredentialByEmail("cara@northwind.test");
    db.identity.insertMember({ organizationId, userId: caraUser!.id, role: "viewer", createdAt: new Date().toISOString() });
    const visible = await cara.get(`/billing?organizationId=${organizationId}`).expect(200);
    expect(visible.text).toContain("Ada Sandbox Plan");
    await cara.post("/billing/portal").type("form").send({ csrf: caraCsrf, organizationId, subscriptionId }).expect(403);

    await ada.post("/account/register").type("form").send({ email: "quiet@northwind.test", displayName: "Quiet", password: "correct-horse-battery" }).expect(200);
    const quiet = db.identity.getCredentialByEmail("quiet@northwind.test");
    db.identity.insertMember({ organizationId, userId: quiet!.id, role: "billing", createdAt: new Date().toISOString() });
    db.billing.savePreference(quiet!.id, true, new Date().toISOString());

    await postEvent(subscription("active", nowSec - 80, true)).expect(200);
    const canceling = await ada.get("/billing").expect(200);
    expect(canceling.text).toContain(`Access continues until ${periodEnd}`);

    await ada.post("/billing/preferences").type("form").send({ csrf: adaCsrf, emailOptIn: "yes", organizationId }).expect(200);
    await postEvent(subscription("past_due", nowSec - 40)).expect(200);
    const notices = mail.filter((item) => item.subject.includes("Ada Sandbox Plan"));
    expect(notices.map((item) => item.to)).toEqual(["ada@northwind.test"]);
    expect(notices[0]?.text).toContain("past_due");
    expect(notices[0]?.text).not.toContain("sub_ada_1");
    expect(notices[0]?.text).not.toContain(card);
    const due = await ada.get("/billing").expect(200);
    expect(due.text).toContain("State: past_due");
    expect(due.text).toContain("payment method update in the hosted portal");

    await postEvent(JSON.stringify({
      id: "evt_invoice_bad",
      type: "invoice.paid",
      created: nowSec - 30,
      data: { object: { id: "in_bad", subscription: "sub_ada_1", amount_due: 10.5, amount_paid: 10.5, currency: "usd", status: "paid", card: { number: card } } },
    })).expect(200);
    await postEvent(JSON.stringify({
      id: "evt_invoice_ok",
      type: "invoice.paid",
      created: nowSec - 20,
      data: { object: { id: "in_ok", subscription: "sub_ada_1", amount_due: 1999, amount_paid: 1999, currency: "usd", status: "paid", hosted_invoice_url: "https://pay.stripe.test/receipt" } },
    })).expect(200);
    const invoiced = await ada.get("/billing").expect(200);
    expect(invoiced.text).toContain("https://pay.stripe.test/receipt");
    expect(invoiced.text).toContain("USD 19.99 paid");

    processor.setRemote({
      processorSubscriptionRef: "sub_ada_1",
      processorCustomerRef: "cus_ada_1",
      offerId,
      organizationId,
      status: "canceled",
      cancelAtPeriodEnd: false,
      periodStart: null,
      periodEnd,
      canceledAt: new Date(nowSec * 1000).toISOString(),
      reportedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const reconciled = await request(app).post("/vision/editor/billing/reconcile").type("form").send({ token: "staff-token" }).expect(200);
    expect(reconciled.text).toContain("billing.reconcile");
    expect(reconciled.text).toContain("canceled 1");
    const ended = await ada.get("/billing").expect(200);
    expect(ended.text).toContain("Access ended at");
    expect(ended.text).not.toContain("Next renewal");

    await postEvent(subscription("active", nowSec - 90)).expect(200);
    const stayed = await ada.get("/billing").expect(200);
    expect(stayed.text).toContain("State: canceled");
    const problems = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(problems.text).toContain("stale");
    expect(problems.text).toContain("invalid_amount");
    expect(problems.text).not.toContain(card);

    await request(app).post("/vision/editor/billing/refund").type("form").send({ token: "staff-token", subscriptionId, amountMinor: "500" }).expect(403);
    const refunded = await request(app).post("/vision/editor/billing/refund").type("form").send({ token: "staff-token", subscriptionId, amountMinor: "500", approved: "yes", reason: "Customer requested a refund." }).expect(200);
    expect(refunded.text).toContain("billing.refund");
    expect(refunded.text).not.toContain(card);

    await postEvent(JSON.stringify({
      id: "evt_account",
      type: "account.updated",
      created: nowSec - 10,
      data: { object: { id: "acct_ada", charges_enabled: true, payouts_enabled: false, details_submitted: true, metadata: { publisher_id: organizationId }, card: { number: card } } },
    })).expect(200);
    const offers = await ada.get(`/publisher/offers?organizationId=${organizationId}`).expect(200);
    expect(offers.text).toContain("Processor charges are enabled.");
    expect(offers.text).not.toContain("acct_ada");
    const staff = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(staff.text).toContain("acct_ada");

    await ada.post("/billing/external").type("form").send({
      csrf: adaCsrf,
      organizationId,
      label: "Northwind console",
      url: "https://example.com/billing",
      note: "Entered by the organization.",
    }).expect(200);
    const noted = await ada.get("/billing").expect(200);
    expect(noted.text).toContain("Northwind console");
    expect(noted.text).toContain("Not verified");
    expect(noted.text).not.toContain("sub_ada_1");

    const exported = await ada.get("/account/export").expect(200);
    expect(exported.text).toContain("Ada Sandbox Plan");
    expect(exported.text).not.toContain("sub_ada_1");
    expect(exported.text).not.toContain("scrypt$");
    expect(exported.text).not.toContain(card);
  });

  it("rejects an unapproved Stripe refund before calling the processor", async () => {
    const calls: string[] = [];
    const stripe = createStripeProcessor({
      secretKey: "sk_test",
      webhookSecret: secret,
      async fetchImpl(url, init) {
        calls.push(`${url} ${init?.body ?? ""}`);
        return new Response(JSON.stringify({ url: "https://checkout.stripe.test/c/session" }), { status: 200 });
      },
    });
    const session = await stripe.createCheckout({
      organizationId: "org",
      offerId: "offer",
      priceRef: "price_1",
      connectedAccountRef: "acct_1",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(session.url).toBe("https://checkout.stripe.test/c/session");
    expect(calls[0]).toContain("mode=subscription");
    expect(calls[0]).toContain("subscription_data%5Btransfer_data%5D%5Bdestination%5D=acct_1");
    expect(calls[0]).not.toContain("application_fee");
    expect(calls[0]).not.toContain("card");
    await expect(stripe.refund({ processorSubscriptionRef: "sub_1", amountMinor: 100, approved: false })).rejects.toThrow(/approved staff decision/);
    expect(calls).toHaveLength(1);
  });

  it("leaves billing closed when the flag is off", async () => {
    const { app } = boot([], [], createRecordProcessor(secret, config.STATUS_BASE_URL), false);
    await request(app).get("/billing").expect(404);
    await request(app).get("/vision").expect(200);
    const { app: closed } = boot([], [], createRecordProcessor(secret, config.STATUS_BASE_URL), false, false);
    await request(closed).get("/billing").expect(404);
  });
});

const dirs: string[] = [];
const databases: DatabaseApi[] = [];

function boot(mail: OutboundMail[], logged: string[], processor: ReturnType<typeof createRecordProcessor>, billing = true, marketplace = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase11-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const logger = createNoopLogger();
  const record = (value: unknown) => {
    logged.push(JSON.stringify(value ?? ""));
  };
  logger.info = record as Logger["info"];
  logger.warn = record as Logger["warn"];
  logger.error = record as Logger["error"];
  const app = createApp({
    db,
    config: { ...config, VISION_BILLING_ENABLED: billing, VISION_MARKETPLACE_ENABLED: marketplace, VISION_PUBLISHER_PORTAL_ENABLED: marketplace },
    logger,
    marketplace: {
      processor,
      async mailer(message) {
        mail.push(message);
      },
    },
  });
  return { app, db };
}

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
  return hidden(login.text, "csrf");
}

function hidden(html: string, name: string): string {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
}
