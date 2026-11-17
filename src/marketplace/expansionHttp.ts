import type { Express, Request, Response } from "express";
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../types/index.js";
import { AppError, forbidden, unauthorized } from "../utils/errors.js";
import type { DatabaseApi } from "../db/database.js";
import { messagePage } from "./pages.js";
import { assertCsrf, loadSession } from "./publisher.js";
import { metricsFor } from "./catalog.js";
import type { IdentityStore } from "./identity.js";
import type { MarketplaceStore } from "./store.js";
import type { ExpansionStore, ListingNotice } from "./expansionStore.js";
import type { DestinationDeps } from "./urls.js";
import { collectionsPage, comparePage, monitorCreatedPage, monitorPage } from "./expansionPages.js";
import {
  badgeSentence,
  comparisonItems,
  createMonitorFromTemplate,
  noticesForCollection,
  postNotice,
  recordCompatibility,
  saveInCollection,
  saveTemplate,
} from "./expansion.js";

export function mountExpansion(app: Express, db: DatabaseApi, identity: IdentityStore, listings: MarketplaceStore, store: ExpansionStore, config: AppConfig, deps: DestinationDeps): void {
  const router = Router();
  router.get("/", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const requested = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
      const listingId = typeof req.query.listingId === "string" ? req.query.listingId : "";
      sendHtml(res, 200, renderCollections(identity, store, current, requested, listingId));
    } catch (error) {
      next(error);
    }
  });
  router.post("/items", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const organizationId = text(req.body, "organizationId");
      saveInCollection({
        store,
        listings,
        identity,
        userId: current.user.id,
        organizationId,
        listingId: text(req.body, "listingId"),
        name: text(req.body, "name"),
        now: new Date().toISOString(),
      });
      sendHtml(res, 200, renderCollections(identity, store, current, organizationId, ""));
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id/compare", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const now = new Date().toISOString();
      const compared = comparisonItems(store, identity, current.user.id, one(req.params.id));
      sendHtml(res, 200, comparePage({
        name: compared.collection.name,
        items: compared.items.map((item) => ({ ...item, badge: compared.badgeFor(item.listingId, now) })),
      }));
    } catch (error) {
      next(error);
    }
  });
  router.get("/monitor", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const listingId = typeof req.query.listingId === "string" ? req.query.listingId : "";
      const listing = listings.getListing(listingId);
      const template = store.getTemplate(listingId);
      if (!listing || listing.status !== "published" || !template) throw new AppError("NOT_FOUND", "Listing does not exist.", 404);
      const orgs = identity.listOrganizationsForUser(current.user.id);
      sendHtml(res, 200, monitorPage({
        csrf: current.session.csrfToken,
        organizationId: orgs[0]?.id ?? "",
        listingId,
        listingName: listing.name,
        needsHost: template.urlTemplate.includes("{host}"),
      }));
    } catch (error) {
      next(error);
    }
  });
  router.post("/monitors", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      const created = await createMonitorFromTemplate({
        db,
        store,
        listings,
        identity,
        userId: current.user.id,
        organizationId: text(req.body, "organizationId"),
        listingId: text(req.body, "listingId"),
        name: text(req.body, "name"),
        host: text(req.body, "host"),
        secretRef: text(req.body, "secretRef"),
        deps,
        config,
        now: new Date().toISOString(),
      });
      sendHtml(res, 200, monitorCreatedPage({ name: text(req.body, "name"), url: created.url, secretRef: created.secretRef }));
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  app.use("/collections", router);

  const publisher = Router();
  publisher.get("/listings/:id/metrics", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const listing = listings.getListing(one(req.params.id));
      if (!listing?.publisherId || !identity.getMember(listing.publisherId, current.user.id)) throw new AppError("NOT_FOUND", "Listing does not exist.", 404);
      const counts = metricsFor(listings, listing.id);
      const totals = store.listingTotals(listing.id);
      res.json({ ...counts, ...totals });
    } catch (error) {
      next(error);
    }
  });
  publisher.post("/listings/:id/notices", (req, res, next) => {
    try {
      const current = guard(req, identity);
      const listing = listings.getListing(one(req.params.id));
      postNotice({
        store,
        listings,
        identity,
        userId: current.user.id,
        organizationId: text(req.body, "organizationId") || listing?.publisherId || "",
        listingId: one(req.params.id),
        versionLabel: text(req.body, "versionLabel"),
        summary: text(req.body, "summary"),
        now: new Date().toISOString(),
      });
      res.redirect(302, `/publisher/listings/${one(req.params.id)}`);
    } catch (error) {
      next(error);
    }
  });
  publisher.use(htmlErrors);
  app.use("/publisher", publisher);

  const staff = Router();
  staff.post("/editor/listings/:id/template", (req, res, next) => {
    try {
      requireStaffToken(text(req.body, "token"), config);
      saveTemplate(store, listings, one(req.params.id), text(req.body, "urlTemplate"), new Date().toISOString());
      sendHtml(res, 200, messagePage("Template saved", "The reviewed monitor template is saved.", 200, true).html);
    } catch (error) {
      next(error);
    }
  });
  staff.post("/editor/listings/:id/compatibility", (req, res, next) => {
    try {
      requireStaffToken(text(req.body, "token"), config);
      const result = recordCompatibility(store, listings, one(req.params.id), text(req.body, "example"), new Date().toISOString());
      const page = messagePage(result.passed ? "Compatibility reviewed" : "Unable to continue", result.sentence, result.passed ? 200 : 409, true);
      sendHtml(res, page.status, page.html);
    } catch (error) {
      next(error);
    }
  });
  staff.use(htmlErrors);
  app.use("/vision", staff);
}

export function publicListingExtras(store: ExpansionStore, listingId: string, now: string): { badge: string; notices: ListingNotice[] } {
  return { badge: badgeSentence(store, listingId, now), notices: store.listNotices(listingId) };
}

function renderCollections(identity: IdentityStore, store: ExpansionStore, current: ReturnType<typeof loadSession>, requested: string, listingId: string): string {
  if (requested && !identity.getMember(requested, current.user.id)) throw new AppError("NOT_FOUND", "Organization does not exist.", 404);
  const orgs = identity.listOrganizationsForUser(current.user.id);
  const organizationId = orgs.some((org) => org.id === requested) ? requested : orgs[0]?.id ?? "";
  return collectionsPage({
    csrf: current.session.csrfToken,
    organizationId,
    organizationName: organizationId ? identity.getOrganization(organizationId)?.name ?? "" : "",
    collections: organizationId ? store.listCollections(organizationId).map((collection) => ({ ...collection, items: store.listItems(collection.id).map((item) => item.name) })) : [],
    notices: organizationId ? noticesForCollection(store, identity, current.user.id, organizationId) : [],
    listingId,
  });
}

function guard(req: Request, identity: IdentityStore) {
  assertOrigin(req);
  const current = loadSession(identity, req.header("cookie"));
  assertCsrf(current.session, req.body, req.header("x-csrf-token"));
  return current;
}

function requireStaffToken(token: string, config: AppConfig): void {
  const expected = config.VISION_STAFF_TOKEN;
  const presented = Buffer.from(token);
  const actual = Buffer.from(expected);
  if (!expected || presented.length !== actual.length || !timingSafeEqual(presented, actual)) throw unauthorized("Staff token is required.");
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

function text(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").send(html);
}

function htmlErrors(error: unknown, _req: Request, res: Response, next: (error: unknown) => void): void {
  if (error instanceof AppError) {
    const page = messagePage(error.statusCode === 404 ? "Not found" : "Unable to continue", error.message, error.statusCode, true);
    sendHtml(res, page.status, page.html);
    return;
  }
  next(error);
}
