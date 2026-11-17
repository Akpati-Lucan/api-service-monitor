import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "../utils/logger.js";
import { AppError, forbidden, unauthorized } from "../utils/errors.js";
import { consumeRateLimit } from "./rateLimit.js";
import { messagePage } from "./pages.js";
import type { IdentityStore } from "./identity.js";
import type { MarketplaceStore } from "./store.js";
import type { PublisherDeps } from "./publisher.js";
import { loadSession, assertCsrf } from "./publisher.js";
import type { BillingProcessor } from "./billing.js";
import {
  activateOffer,
  billingExport,
  checkoutChoices,
  createOffer,
  openPortal,
  receiveWebhook,
  refundSubscription,
  reconcileSubscriptions,
  restorePublisher,
  restrictPublisher,
  saveBillingPreference,
  saveExternalNote,
  startCheckout,
} from "./billing.js";
import type { BillingStore } from "./billingStore.js";
import { billingPage, checkoutReturnPage, offersPage, processorCheckoutPage, processorPortalPage, termsPage } from "./billingPages.js";

type RawRequest = Request & { rawBody?: Buffer };

export function mountBilling(app: Express, identity: IdentityStore, store: MarketplaceStore, billing: BillingStore, processor: BillingProcessor, deps: PublisherDeps, logger?: Logger): void {
  app.use("/billing", createBillingRouter(identity, store, billing, processor, deps, logger));
  app.use("/publisher", createOfferRouter(identity, store, billing, deps));
}

function createBillingRouter(identity: IdentityStore, store: MarketplaceStore, billing: BillingStore, processor: BillingProcessor, deps: PublisherDeps, logger?: Logger): Router {
  const router = Router();
  router.post("/webhook", async (req, res) => {
    try {
      const raw = (req as RawRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      await receiveWebhook({
        billing,
        identity,
        processor,
        mailer: deps.mailer,
        rawBody: raw,
        signature: req.header("stripe-signature"),
        logger,
        feeBps: deps.config.VISION_PLATFORM_FEE_BPS,
      });
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
        return;
      }
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Webhook was rejected." } });
    }
  });
  router.get("/processor-portal", (_req, res) => {
    sendHtml(res, 200, processorPortalPage());
  });
  router.get("/processor-checkout", (_req, res) => {
    sendHtml(res, 200, processorCheckoutPage());
  });
  router.get("/checkout/return", (_req, res) => {
    sendHtml(res, 200, checkoutReturnPage());
  });
  router.get("/terms", (_req, res) => {
    sendHtml(res, 200, termsPage());
  });
  router.get("/", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      sendHtml(res, 200, renderBilling(identity, billing, deps, current, requestedOrg(req)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/portal", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const url = await openPortal(billing, identity, processor, current.user, {
        organizationId: text(req.body, "organizationId"),
        subscriptionId: text(req.body, "subscriptionId"),
        returnUrl: `${deps.config.STATUS_BASE_URL}/billing`,
        statusBase: deps.config.STATUS_BASE_URL,
      });
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  });
  router.post("/checkout", async (req, res, next) => {
    try {
      if (!consumeRateLimit(`checkout:${req.ip || req.socket.remoteAddress || "unknown"}`, 8)) throw new AppError("CONFLICT", "Too many requests", 429);
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      const url = await startCheckout(billing, identity, store, processor, current.user, {
        organizationId,
        offerId: text(req.body, "offerId"),
        country: text(req.body, "country"),
        termsAccepted: text(req.body, "terms") === "yes",
        idempotencyKey: text(req.body, "idempotencyKey"),
        feeBps: deps.config.VISION_PLATFORM_FEE_BPS,
        countries: deps.config.VISION_BILLING_COUNTRIES,
        statusBase: deps.config.STATUS_BASE_URL,
      });
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  });
  router.post("/external", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      saveExternalNote(billing, identity, current.user, {
        organizationId,
        label: text(req.body, "label"),
        url: text(req.body, "url"),
        note: text(req.body, "note"),
      });
      sendHtml(res, 200, renderBilling(identity, billing, deps, current, organizationId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/preferences", (req, res, next) => {
    try {
      const current = guard(req, identity);
      saveBillingPreference(billing, identity, current.user, text(req.body, "emailOptIn") === "yes");
      sendHtml(res, 200, renderBilling(identity, billing, deps, current, requestedOrg(req)));
    } catch (error) {
      next(error);
    }
  });
  router.get("/export", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      res.status(200).type("json").send(billingExport(billing, identity, current.user.id));
    } catch (error) {
      next(error);
    }
  });
  router.get("/statement", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const organizationId = requestedOrg(req) || firstOrg(identity, current.user.id);
      if (organizationId && !identity.getMember(organizationId, current.user.id)) throw new AppError("NOT_FOUND", "Organization does not exist", 404);
      res.status(200).type("json").send({ statement: organizationId ? billing.listLedgerForOrganization(organizationId) : [] });
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

function createOfferRouter(identity: IdentityStore, store: MarketplaceStore, billing: BillingStore, deps: PublisherDeps): Router {
  const router = Router();
  router.get("/offers", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const organizationId = requestedOrg(req) || firstOrg(identity, current.user.id);
      sendHtml(res, 200, renderOffers(identity, store, billing, current.session.csrfToken, organizationId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/offers", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      const amount = Number(text(req.body, "amountMinor"));
      createOffer(billing, identity, store, current.user, {
        organizationId,
        listingId: text(req.body, "listingId"),
        planName: text(req.body, "planName"),
        billingInterval: text(req.body, "billingInterval"),
        amountMinor: amount,
        currency: text(req.body, "currency"),
      });
      sendHtml(res, 200, renderOffers(identity, store, billing, current.session.csrfToken, organizationId));
    } catch (error) {
      next(error);
    }
  });
  router.get("/statement", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const organizationId = requestedOrg(req) || firstOrg(identity, current.user.id);
      const member = identity.getMember(organizationId, current.user.id);
      if (!member || !identity.getOrganization(organizationId)) throw new AppError("NOT_FOUND", "Organization does not exist", 404);
      if (member.role !== "owner" && member.role !== "admin" && member.role !== "billing") throw new AppError("FORBIDDEN", "Billing management requires an owner, admin, or billing role.", 403);
      res.status(200).type("json").send({ statement: billing.listLedgerForPublisher(organizationId) });
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

export function staffBillingRoutes(router: Router, identity: IdentityStore, billing: BillingStore, processor: BillingProcessor, deps: PublisherDeps, render: (token: string) => string): void {
  router.post("/editor/offers/:id/activate", (req, res, next) => {
    try {
      const token = staff(req, deps);
      activateOffer(billing, identity, one(req.params.id), text(req.body, "providerPriceRef"));
      sendHtml(res, 200, render(token));
    } catch (error) {
      next(error);
    }
  });
  router.post("/editor/billing/reconcile", async (req, res, next) => {
    try {
      const token = staff(req, deps);
      await reconcileSubscriptions(billing, identity, processor, deps.mailer);
      sendHtml(res, 200, render(token));
    } catch (error) {
      next(error);
    }
  });
  router.post("/editor/billing/refund", async (req, res, next) => {
    try {
      const token = staff(req, deps);
      const amount = Number(text(req.body, "amountMinor"));
      await refundSubscription(billing, identity, processor, {
        subscriptionId: text(req.body, "subscriptionId"),
        amountMinor: amount,
        approved: text(req.body, "approved") === "yes",
        reason: text(req.body, "reason"),
        feeBps: deps.config.VISION_PLATFORM_FEE_BPS,
      });
      sendHtml(res, 200, render(token));
    } catch (error) {
      next(error);
    }
  });
  router.post("/editor/billing/restrict", (req, res, next) => {
    try {
      const token = staff(req, deps);
      restrictPublisher(billing, identity, {
        publisherId: text(req.body, "publisherId"),
        reason: text(req.body, "reason"),
        approved: text(req.body, "approved") === "yes",
      });
      sendHtml(res, 200, render(token));
    } catch (error) {
      next(error);
    }
  });
  router.post("/editor/billing/restore", (req, res, next) => {
    try {
      const token = staff(req, deps);
      restorePublisher(billing, identity, {
        publisherId: text(req.body, "publisherId"),
        reason: text(req.body, "reason"),
        approved: text(req.body, "approved") === "yes",
      });
      sendHtml(res, 200, render(token));
    } catch (error) {
      next(error);
    }
  });
}

function renderBilling(identity: IdentityStore, billing: BillingStore, deps: PublisherDeps, current: ReturnType<typeof loadSession>, requested: string): string {
  const organizationId = requested || firstOrg(identity, current.user.id);
  if (requested && !identity.getMember(requested, current.user.id)) throw new AppError("NOT_FOUND", "Organization does not exist", 404);
  const org = organizationId ? identity.getOrganization(organizationId) : undefined;
  return billingPage({
    csrf: current.session.csrfToken,
    organizationId,
    organizationName: org?.name ?? "",
    subscriptions: organizationId ? billing.listSubscriptionViews(organizationId) : [],
    invoices: organizationId ? billing.listInvoices(organizationId) : [],
    notes: organizationId ? billing.listExternalNotes(organizationId) : [],
    emailOptIn: billing.getPreference(current.user.id)?.emailOptIn === true,
    offers: checkoutChoices(billing, organizationId),
    countries: deps.config.VISION_BILLING_COUNTRIES,
    statement: organizationId ? billing.listLedgerForOrganization(organizationId) : [],
    graceDays: deps.config.VISION_BILLING_GRACE_DAYS,
    now: new Date(),
  });
}

function renderOffers(identity: IdentityStore, store: MarketplaceStore, billing: BillingStore, csrf: string, organizationId: string): string {
  if (organizationId && !identity.getOrganization(organizationId)) throw new AppError("NOT_FOUND", "Organization does not exist", 404);
  const accounts = organizationId ? billing.listPaymentAccounts(organizationId) : [];
  return offersPage({
    csrf,
    organizationId,
    listings: organizationId ? store.listOwnedListings(organizationId) : [],
    offers: organizationId ? billing.listOffers(organizationId) : [],
    chargesEnabled: accounts.some((account) => account.chargesEnabled),
  });
}

function firstOrg(identity: IdentityStore, userId: string): string {
  return identity.listOrganizationsForUser(userId)[0]?.id ?? "";
}

function requestedOrg(req: Request): string {
  const query = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  return query || text(req.body, "organizationId");
}

function guard(req: Request, identity: IdentityStore) {
  assertOrigin(req);
  const current = loadSession(identity, req.header("cookie"));
  assertCsrf(current.session, req.body, req.header("x-csrf-token"));
  return current;
}

function staff(req: Request, deps: PublisherDeps): string {
  const token = text(req.body, "token");
  const expected = deps.config.VISION_STAFF_TOKEN;
  const presented = Buffer.from(token);
  const actual = Buffer.from(expected);
  if (!expected || presented.length !== actual.length || !timingSafeEqual(presented, actual)) {
    throw unauthorized("Staff token is required");
  }
  return token;
}

function text(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function assertOrigin(req: Request): void {
  const origin = req.header("origin");
  const site = req.header("sec-fetch-site");
  if (!origin || origin === "null") {
    if (site && site !== "same-origin" && site !== "none") throw forbidden("Cross-site request was refused.");
    return;
  }
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden("Cross-site request was refused.");
  }
  if (host !== req.header("host")) throw forbidden("Cross-site request was refused.");
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'").send(html);
}

function htmlErrors(error: unknown, _req: Request, res: Response, next: (error: unknown) => void): void {
  if (error instanceof AppError) {
    const page = messagePage(error.statusCode === 404 ? "Not found" : "Unable to continue", error.message, error.statusCode, true);
    sendHtml(res, page.status, page.html);
    return;
  }
  next(error);
}
