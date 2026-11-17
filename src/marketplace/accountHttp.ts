import type { Express, Request, Response } from "express";
import { Router } from "express";
import { AppError, forbidden } from "../utils/errors.js";
import { consumeRateLimit } from "./rateLimit.js";
import { messagePage } from "./pages.js";
import type { IdentityStore } from "./identity.js";
import type { MarketplaceStore } from "./store.js";
import type { ListingInput } from "./catalog.js";
import { metricsFor } from "./catalog.js";
import {
  acceptInvitation,
  appealListing,
  assertCsrf,
  attachGuide,
  changeRole,
  checkDomain,
  createOrganization,
  createPublisherListing,
  credentialHash,
  deleteAccount,
  exportAccount,
  inviteMember,
  loadSession,
  loginAccount,
  logoutAccount,
  purgeExpiredAccounts,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  saveProfile,
  sessionCookie,
  startDomain,
  submitPublisherListing,
  updatePublisherListing,
  verifyEmail,
  type PublisherDeps,
  type SessionGrant,
} from "./publisher.js";
import type { BillingStore } from "./billingStore.js";
import { billingExport } from "./billing.js";
import type { IntegrationStore } from "./integrationStore.js";
import { exportConnections } from "./integrations.js";
import type { ExpansionStore } from "./expansionStore.js";
import {
  accountHome,
  forgotPage,
  listingDetail,
  listingForm,
  loginPage,
  previewPage,
  publisherHome,
  registerPage,
  registerSentPage,
  resetPage,
} from "./accountPages.js";

export function mountAccounts(app: Express, identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, billing: BillingStore, integrations: IntegrationStore, expansion: ExpansionStore): void {
  app.use("/account", createAccountRouter(identity, store, deps, billing, integrations));
  app.use("/publisher", createPublisherRouter(identity, store, deps, expansion));
}

function createAccountRouter(identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, billing: BillingStore, integrations: IntegrationStore): Router {
  const router = Router();
  router.get("/register", (_req, res) => sendHtml(res, 200, registerPage()));
  router.post("/register", async (req, res, next) => {
    try {
      assertOrigin(req);
      limit(req, "register", 8);
      purgeExpiredAccounts(identity);
      await registerAccount(identity, deps, {
        email: text(req.body, "email"),
        displayName: text(req.body, "displayName"),
        password: text(req.body, "password"),
      });
      sendHtml(res, 200, registerSentPage());
    } catch (error) {
      next(error);
    }
  });
  router.get("/login", (_req, res) => sendHtml(res, 200, loginPage()));
  router.post("/login", async (req, res, next) => {
    try {
      assertOrigin(req);
      limit(req, "login", 8);
      const grant = await loginAccount(identity, text(req.body, "email"), text(req.body, "password"));
      showAccount(res, deps, identity, store, grant);
    } catch (error) {
      next(error);
    }
  });
  router.post("/logout", (req, res, next) => {
    try {
      assertOrigin(req);
      const current = loadSession(identity, req.header("cookie"));
      assertCsrf(current.session, req.body, req.header("x-csrf-token"));
      logoutAccount(identity, current.session);
      res.setHeader("Set-Cookie", clearCookie(deps));
      sendHtml(res, 200, loginPage());
    } catch (error) {
      next(error);
    }
  });
  router.get("/verify", (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      void verifyEmail(identity, token).then(() => sendHtml(res, 200, loginPage())).catch(next);
    } catch (error) {
      next(error);
    }
  });
  router.get("/forgot", (_req, res) => sendHtml(res, 200, forgotPage()));
  router.post("/forgot", async (req, res, next) => {
    try {
      assertOrigin(req);
      limit(req, "reset", 8);
      await requestPasswordReset(identity, deps, text(req.body, "email"));
      sendHtml(res, 200, forgotPage());
    } catch (error) {
      next(error);
    }
  });
  router.get("/reset", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    sendHtml(res, 200, resetPage(token));
  });
  router.post("/reset", async (req, res, next) => {
    try {
      assertOrigin(req);
      await resetPassword(identity, text(req.body, "token"), text(req.body, "password"));
      sendHtml(res, 200, loginPage());
    } catch (error) {
      next(error);
    }
  });
  router.get("/", (req, res, next) => {
    try {
      purgeExpiredAccounts(identity);
      const current = loadSession(identity, req.header("cookie"));
      sendHtml(res, 200, accountHome(current.user, identity.listOrganizationsForUser(current.user.id), current.session.csrfToken, deps.config.VISION_BILLING_ENABLED, deps.config.VISION_INTEGRATIONS_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.get("/export", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const body = { ...exportAccount(identity, store, current.user), billing: billingExport(billing, identity, current.user.id), connections: exportConnections(integrations, identity, current.user.id) };
      res.status(200).type("json").setHeader("Content-Disposition", "attachment; filename=\"account.json\"").send(body);
    } catch (error) {
      next(error);
    }
  });
  router.post("/delete", async (req, res, next) => {
    try {
      assertOrigin(req);
      const current = loadSession(identity, req.header("cookie"));
      assertCsrf(current.session, req.body, req.header("x-csrf-token"));
      await deleteAccount(identity, current.user, text(req.body, "password"), credentialHash(identity, current.user));
      res.setHeader("Set-Cookie", clearCookie(deps));
      sendHtml(res, 200, loginPage());
    } catch (error) {
      next(error);
    }
  });
  router.post("/invitations/accept", (req, res, next) => {
    try {
      assertOrigin(req);
      const current = loadSession(identity, req.header("cookie"));
      assertCsrf(current.session, req.body, req.header("x-csrf-token"));
      acceptInvitation(identity, current.user, text(req.body, "token"));
      sendHtml(res, 200, accountHome(current.user, identity.listOrganizationsForUser(current.user.id), current.session.csrfToken, deps.config.VISION_BILLING_ENABLED, deps.config.VISION_INTEGRATIONS_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

function createPublisherRouter(identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, expansion: ExpansionStore): Router {
  const router = Router();
  router.get("/", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      sendHtml(res, 200, home(identity, store, current, orgId(req), deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/organizations", (req, res, next) => {
    try {
      const current = guard(req, identity);
      createOrganization(identity, current.user, text(req.body, "name"));
      sendHtml(res, 200, home(identity, store, current, "", deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/profile", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      await saveProfile(identity, deps, current.user, organizationId, {
        legalName: text(req.body, "legalName"),
        supportUrl: text(req.body, "supportUrl"),
        privacyUrl: text(req.body, "privacyUrl"),
        termsUrl: text(req.body, "termsUrl"),
        regions: text(req.body, "regions"),
      });
      sendHtml(res, 200, home(identity, store, current, organizationId, deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/domains", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      startDomain(identity, current.user, organizationId, text(req.body, "domain"), text(req.body, "method"));
      sendHtml(res, 200, home(identity, store, current, organizationId, deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/domains/:id/check", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      await checkDomain(identity, deps, current.user, organizationId, one(req.params.id));
      sendHtml(res, 200, home(identity, store, current, organizationId, deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/invitations", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      await inviteMember(identity, deps, current.user, organizationId, text(req.body, "email"), text(req.body, "role"));
      sendHtml(res, 200, home(identity, store, current, organizationId, deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/members/:userId/role", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      changeRole(identity, current.user, organizationId, one(req.params.userId), text(req.body, "role"));
      sendHtml(res, 200, home(identity, store, current, organizationId, deps.config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.get("/listings/new", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
      sendHtml(res, 200, listingForm(current.session.csrfToken, organizationId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/listings", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      const listing = await createPublisherListing(identity, store, deps, current.user, organizationId, listingInput(req.body));
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, organizationId, listing.id));
    } catch (error) {
      next(error);
    }
  });
  router.get("/listings/:id/edit", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const listing = owned(store, current.user.id, identity, one(req.params.id));
      sendHtml(res, 200, listingForm(current.session.csrfToken, listing.publisherId ?? "", listing));
    } catch (error) {
      next(error);
    }
  });
  router.get("/listings/:id/preview", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const listing = owned(store, current.user.id, identity, one(req.params.id));
      sendHtml(res, 200, previewPage(listing));
    } catch (error) {
      next(error);
    }
  });
  router.post("/listings/:id/submit", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      submitPublisherListing(identity, store, current.user, organizationId, one(req.params.id));
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, organizationId, one(req.params.id)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/listings/:id/guides", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      attachGuide(identity, store, current.user, organizationId, one(req.params.id), {
        title: text(req.body, "title"),
        summary: text(req.body, "summary"),
        bodyMd: text(req.body, "bodyMd"),
      });
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, organizationId, one(req.params.id)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/listings/:id/appeal", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      appealListing(identity, store, current.user, organizationId, one(req.params.id), text(req.body, "note"));
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, organizationId, one(req.params.id)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/listings/:id", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      await updatePublisherListing(identity, store, deps, current.user, organizationId, one(req.params.id), listingInput(req.body));
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, organizationId, one(req.params.id)));
    } catch (error) {
      next(error);
    }
  });
  router.get("/listings/:id", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const listing = owned(store, current.user.id, identity, one(req.params.id));
      sendHtml(res, 200, detail(identity, store, expansion, current.session.csrfToken, listing.publisherId ?? "", listing.id));
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

function showAccount(res: Response, deps: PublisherDeps, identity: IdentityStore, store: MarketplaceStore, grant: SessionGrant) {
  res.setHeader("Set-Cookie", sessionCookie(grant.token, deps.config.NODE_ENV === "production", 14 * 24 * 60 * 60));
  const current = loadSession(identity, `${"vision_session"}=${encodeURIComponent(grant.token)}`);
  sendHtml(res, 200, accountHome(current.user, identity.listOrganizationsForUser(current.user.id), current.session.csrfToken, deps.config.VISION_BILLING_ENABLED, deps.config.VISION_INTEGRATIONS_ENABLED));
}

function home(identity: IdentityStore, store: MarketplaceStore, current: ReturnType<typeof loadSession>, requested: string, billing = false): string {
  const orgs = identity.listOrganizationsForUser(current.user.id);
  const organizationId = orgs.some((org) => org.id === requested) ? requested : orgs[0]?.id ?? "";
  return publisherHome({
    csrf: current.session.csrfToken,
    orgs,
    organizationId,
    profile: organizationId ? identity.getProfile(organizationId) ?? null : null,
    domains: organizationId ? identity.listDomains(organizationId) : [],
    listings: organizationId ? store.listOwnedListings(organizationId) : [],
    notifications: organizationId ? identity.listNotifications(organizationId) : [],
    members: organizationId ? identity.listMembers(organizationId).map((member) => ({ userId: member.userId, role: member.role })) : [],
    billing,
  });
}

function detail(identity: IdentityStore, store: MarketplaceStore, expansion: ExpansionStore, csrf: string, organizationId: string, listingId: string): string {
  const listing = store.getListing(listingId);
  if (!listing || listing.publisherId !== organizationId) throw new AppError("NOT_FOUND", "Listing does not exist", 404);
  const metrics = metricsFor(store, listing.id);
  const totals = expansion.listingTotals(listing.id);
  const guides = store.listGuideIdsByPublisher(organizationId);
  return listingDetail({
    csrf,
    listing,
    reviews: store.listReviews(listing.id),
    views: metrics.views,
    clicks: metrics.outboundClicks,
    guideId: guides[0] ?? null,
    checkoutStarts: totals.checkoutStarts,
    activeSubscriptions: totals.activeSubscriptions,
    canceledSubscriptions: totals.canceledSubscriptions,
    refundMinor: totals.refundMinor,
  });
}

function owned(store: MarketplaceStore, userId: string, identity: IdentityStore, listingId: string) {
  const listing = store.getListing(listingId);
  if (!listing?.publisherId || !identity.getMember(listing.publisherId, userId)) {
    throw new AppError("NOT_FOUND", "Listing does not exist", 404);
  }
  return listing;
}

function guard(req: Request, identity: IdentityStore) {
  assertOrigin(req);
  const current = loadSession(identity, req.header("cookie"));
  assertCsrf(current.session, req.body, req.header("x-csrf-token"));
  return current;
}

function listingInput(body: unknown): ListingInput {
  return {
    name: text(body, "name"),
    summary: text(body, "summary"),
    descriptionMd: text(body, "descriptionMd"),
    category: text(body, "category") || "developer_tooling",
    tags: [],
    listingType: "api",
    pricingModel: "external",
    currency: null,
    priceSummary: null,
    providerName: text(body, "providerName"),
    providerDomain: text(body, "providerDomain"),
    docsUrl: text(body, "docsUrl"),
    signupUrl: text(body, "signupUrl") || null,
    pricingUrl: null,
    statusUrl: null,
    termsUrl: text(body, "termsUrl"),
    privacyUrl: text(body, "privacyUrl"),
    regions: [],
    capabilities: [],
    requirements: ["A provider account"],
  };
}

function orgId(req: Request): string {
  return typeof req.query.organizationId === "string" ? req.query.organizationId : text(req.body, "organizationId");
}

function text(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function clearCookie(deps: PublisherDeps): string {
  return sessionCookie("", deps.config.NODE_ENV === "production", 0);
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

function limit(req: Request, bucket: string, max: number): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!consumeRateLimit(`${bucket}:${ip}`, max)) throw new AppError("CONFLICT", "Too many requests", 429);
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
