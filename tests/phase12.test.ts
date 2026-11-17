import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import { commerceSentences, createRecordProcessor, createStripeProcessor, signStripePayload } from "../src/marketplace/billing.js";
import { createNoopLogger, type Logger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";
import type { OutboundMail } from "../src/marketplace/publisher.js";

const secret = "whsec_phase12";

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
  VISION_PLATFORM_FEE_BPS: 1000,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VERSION: "1.0.0",
};

describe("phase 12", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("keeps a past-due subscription paused unless the grace period is still open", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    const open = commerceSentences({ state: "past_due", periodEnd: "2026-11-17T00:00:00.000Z", disputeOpen: false, publisherRestricted: false, graceDays: 3, now });
    expect(open[0]).toBe("Payment is past due. Access continues until 2026-11-20T00:00:00.000Z under the documented grace period.");
    const ended = commerceSentences({ state: "past_due", periodEnd: "2026-11-17T00:00:00.000Z", disputeOpen: false, publisherRestricted: false, graceDays: 3, now: new Date("2026-11-21T00:00:00.000Z") });
    expect(ended[0]).toContain("The grace period ended at 2026-11-20T00:00:00.000Z.");
    const paused = commerceSentences({ state: "past_due", periodEnd: "2026-11-17T00:00:00.000Z", disputeOpen: false, publisherRestricted: false, graceDays: 0, now });
    expect(paused[0]).toBe("Access is paused until the payment processor reports a successful payment.");
  });

  it("sends the platform fee and idempotency key to hosted checkout", async () => {
    const calls: Array<{ body: string; key: string }> = [];
    const stripe = createStripeProcessor({
      secretKey: "sk_test",
      webhookSecret: secret,
      async fetchImpl(_url, init) {
        calls.push({ body: String(init?.body ?? ""), key: new Headers(init?.headers).get("Idempotency-Key") ?? "" });
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
      feeBps: 1000,
      idempotencyKey: "phase12-checkout-key",
    });
    expect(session.url).toBe("https://checkout.stripe.test/c/session");
    expect(calls[0]?.body).toContain("subscription_data%5Bapplication_fee_percent%5D=10.00");
    expect(calls[0]?.body).toContain("subscription_data%5Btransfer_data%5D%5Bdestination%5D=acct_1");
    expect(calls[0]?.body).not.toContain("card");
    expect(calls[0]?.key).toBe("phase12-checkout-key");
  });

  it("opens hosted checkout and records the subscription from the processor", async () => {
    const mail: OutboundMail[] = [];
    let checkoutCalls = 0;
    const processor = createRecordProcessor(secret, config.STATUS_BASE_URL);
    const original = processor.createCheckout.bind(processor);
    processor.createCheckout = async (input) => {
      checkoutCalls += 1;
      return original(input);
    };
    const { app, db } = boot(mail, processor);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const adaOrg = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf, name: "Northwind" }).expect(200);
    const publisherId = hidden(adaOrg.text, "organizationId");
    const listingId = "lst_phase12_ledger";
    db.marketplace.insertListing({
      id: listingId,
      slug: "phase12-ledger",
      publisherId,
      name: "Phase12 Ledger",
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
    await ada.post("/publisher/offers").type("form").send({
      csrf: adaCsrf, organizationId: publisherId, listingId, planName: "Harbor plan", billingInterval: "month", amountMinor: "1999", currency: "USD",
    }).expect(200);
    const editor = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    const offerId = /\/vision\/editor\/offers\/([^/]+)\/activate/.exec(editor.text)?.[1] ?? "";
    await request(app).post(`/vision/editor/offers/${offerId}/activate`).type("form").send({ token: "staff-token", providerPriceRef: "price_phase12" }).expect(200);

    const bob = request.agent(app);
    const bobCsrf = await signup(app, bob, mail, "bob@harbor.test");
    const bobOrg = await bob.post("/publisher/organizations").type("form").send({ csrf: bobCsrf, name: "Harbor" }).expect(200);
    const organizationId = hidden(bobOrg.text, "organizationId");
    const early = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "US", terms: "yes", idempotencyKey: "phase12-checkout-key",
    }).expect(409);
    expect(early.text).toContain("This listing is not published.");

    const nowSec = Math.floor(Date.now() / 1000);
    const postEvent = (body: string) => request(app).post("/billing/webhook").set("Content-Type", "application/json").set("Stripe-Signature", signStripePayload(secret, Buffer.from(body), nowSec)).send(body);
    await postEvent(JSON.stringify({
      id: "evt_account", type: "account.updated", created: nowSec - 40,
      data: { object: { id: "acct_phase12", charges_enabled: true, payouts_enabled: true, details_submitted: true, metadata: { publisher_id: publisherId } } },
    })).expect(200);
    const at = new Date().toISOString();
    db.marketplace.updateListing(listingId, { status: "published", publishedAt: at, updatedAt: at });

    const catalog = await bob.get("/billing").expect(200);
    expect(catalog.text).toContain("Harbor plan");
    expect(catalog.text).toContain("Continue to hosted checkout");
    expect(catalog.text).not.toContain("State: active");
    const terms = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "US", idempotencyKey: "phase12-checkout-key",
    }).expect(409);
    expect(terms.text).toContain("marketplace terms");
    const country = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "ZZ", terms: "yes", idempotencyKey: "phase12-checkout-key",
    }).expect(409);
    expect(country.text).toContain("outside the launch list");

    const cara = request.agent(app);
    const caraCsrf = await signup(app, cara, mail, "cara@harbor.test");
    const caraUser = db.identity.getCredentialByEmail("cara@harbor.test");
    db.identity.insertMember({ organizationId, userId: caraUser!.id, role: "viewer", createdAt: at });
    await cara.post("/billing/checkout").type("form").send({
      csrf: caraCsrf, organizationId, offerId, country: "US", terms: "yes", idempotencyKey: "phase12-viewer-key01",
    }).expect(403);

    const started = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "US", terms: "yes", idempotencyKey: "phase12-checkout-key",
    }).expect(302);
    expect(started.headers.location).toBe("http://localhost:3000/billing/processor-checkout");
    const again = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "US", terms: "yes", idempotencyKey: "phase12-checkout-key",
    }).expect(302);
    expect(again.headers.location).toBe(started.headers.location);
    expect(checkoutCalls).toBe(1);
    const hosted = await bob.get("/billing/processor-checkout").expect(200);
    expect(hosted.text).toContain("Card numbers and security codes are not collected on this page.");
    const returned = await bob.get("/billing/checkout/return").expect(200);
    expect(returned.text).toContain("A browser return does not activate access.");
    const waiting = await bob.get("/billing").expect(200);
    expect(waiting.text).not.toContain("State: active");

    const periodEnd = new Date((nowSec + 86400 * 30) * 1000).toISOString();
    const subscription = (eventId: string, subscriptionId: string, status: string, created: number) => JSON.stringify({
      id: eventId, type: "customer.subscription.updated", created,
      data: { object: {
        id: subscriptionId, customer: "cus_phase12", status, cancel_at_period_end: false,
        metadata: { organization_id: organizationId, offer_id: offerId },
        current_period_end: nowSec + 86400 * 30,
      } },
    });
    await postEvent(subscription("evt_phase12_1", "sub_phase12_1", "active", nowSec - 30)).expect(200);
    const active = await bob.get("/billing").expect(200);
    expect(active.text).toContain("State: active");
    expect(active.text).toContain(`Next renewal ${periodEnd}`);
    expect(active.text).toContain("Reported by the payment processor");
    expect(active.text).not.toContain("sub_phase12");
    expect(active.text).not.toContain("acct_phase12");
    const duplicate = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId, country: "US", terms: "yes", idempotencyKey: "phase12-second-key01",
    }).expect(409);
    expect(duplicate.text).toContain("already has this subscription");
    await postEvent(subscription("evt_phase12_2", "sub_phase12_2", "active", nowSec - 25)).expect(200);
    const single = await bob.get("/billing").expect(200);
    expect(single.text.split("Open hosted portal").length - 1).toBe(1);
    const problems = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(problems.text).toContain("duplicate_subscription");

    await postEvent(JSON.stringify({
      id: "evt_invoice", type: "invoice.paid", created: nowSec - 20,
      data: { object: { id: "in_phase12", subscription: "sub_phase12_1", amount_due: 1999, amount_paid: 1999, tax: 0, currency: "usd", status: "paid", hosted_invoice_url: "https://pay.example/invoices/1" } },
    })).expect(200);
    const period = new Date((nowSec - 20) * 1000).toISOString().slice(0, 7);
    const staff = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(staff.text).toContain(`stripe USD ${period} pending gross 1999 fee 199 tax 0 net 1800`);
    const statement = await bob.get("/billing/statement").expect(200);
    expect(statement.body.statement[0]).toMatchObject({ kind: "charge", grossMinor: 1999, feeMinor: 199, taxMinor: 0, netMinor: 1800, payoutStatus: "pending" });
    expect(JSON.stringify(statement.body)).not.toContain("sub_phase12");
    const publisherStatement = await ada.get(`/publisher/statement?organizationId=${publisherId}`).expect(200);
    expect(publisherStatement.body.statement[0].grossMinor).toBe(1999);
    expect(JSON.stringify(publisherStatement.body)).not.toContain("acct_phase12");

    await postEvent(JSON.stringify({
      id: "evt_dispute", type: "charge.dispute.created", created: nowSec - 15,
      data: { object: { id: "dp_phase12", amount: 1999, currency: "usd", metadata: { subscription_id: "sub_phase12_1" } } },
    })).expect(200);
    const disputed = await bob.get("/billing").expect(200);
    expect(disputed.text).toContain("State: active");
    expect(disputed.text).toContain("A payment dispute is open.");

    await postEvent(subscription("evt_phase12_due", "sub_phase12_1", "past_due", nowSec - 10)).expect(200);
    const paused = await bob.get("/billing").expect(200);
    expect(paused.text).toContain("State: past_due");
    expect(paused.text).toContain("Access is paused until the payment processor reports a successful payment.");
    expect(paused.text).not.toContain("State: active");

    const subscriptionId = hidden(paused.text, "subscriptionId");
    await request(app).post("/vision/editor/billing/refund").type("form").send({ token: "staff-token", subscriptionId, amountMinor: "500", reason: "Customer requested a refund." }).expect(403);
    await request(app).post("/vision/editor/billing/refund").type("form").send({ token: "staff-token", subscriptionId, amountMinor: "500", approved: "yes" }).expect(400);
    const refunded = await request(app).post("/vision/editor/billing/refund").type("form").send({ token: "staff-token", subscriptionId, amountMinor: "500", approved: "yes", reason: "Customer requested a refund." }).expect(200);
    expect(refunded.text).toContain("billing.refund");
    expect(refunded.text).not.toContain("sub_phase12");

    await ada.post("/publisher/offers").type("form").send({
      csrf: adaCsrf, organizationId: publisherId, listingId, planName: "Second plan", billingInterval: "month", amountMinor: "500", currency: "USD",
    }).expect(200);
    const drafts = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    const secondOffer = /\/vision\/editor\/offers\/([^/]+)\/activate/.exec(drafts.text)?.[1] ?? "";
    await request(app).post(`/vision/editor/offers/${secondOffer}/activate`).type("form").send({ token: "staff-token", providerPriceRef: "price_phase12_b" }).expect(200);
    await request(app).post("/vision/editor/billing/restrict").type("form").send({ token: "staff-token", publisherId, reason: "Eligibility ended.", approved: "yes" }).expect(200);
    const blocked = await bob.post("/billing/checkout").type("form").send({
      csrf: bobCsrf, organizationId, offerId: secondOffer, country: "US", terms: "yes", idempotencyKey: "phase12-checkout-key2",
    }).expect(409);
    expect(blocked.text).toContain("This publisher cannot accept new subscriptions.");
    const continued = await bob.get("/billing").expect(200);
    expect(continued.text).toContain("Existing access follows the payment processor.");

    await postEvent(JSON.stringify({
      id: "evt_payout", type: "payout.paid", created: nowSec - 20,
      data: { object: { id: "po_phase12", metadata: { publisher_id: publisherId } } },
    })).expect(200);
    const reconciled = await request(app).post("/vision/editor").type("form").send({ token: "staff-token" }).expect(200);
    expect(reconciled.text).toContain(`stripe USD ${period} transferred gross 1999 fee 199 tax 0 net 1800`);
  });
});

const dirs: string[] = [];
const databases: DatabaseApi[] = [];

function boot(mail: OutboundMail[], processor: ReturnType<typeof createRecordProcessor>) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase12-"));
  dirs.push(dir);
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const logger = createNoopLogger();
  const app = createApp({
    db,
    config,
    logger,
    marketplace: { processor, async mailer(message) { mail.push(message); } },
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
