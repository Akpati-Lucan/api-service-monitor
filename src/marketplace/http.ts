import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../types/index.js";
import type { DatabaseApi } from "../db/database.js";
import { AppError, notFound, unauthorized, validationError } from "../utils/errors.js";
import {
  CATEGORIES,
  createDraft,
  getPublicBySlug,
  getPublicGuide,
  listPublicGuides,
  metricsFor,
  openDestination,
  reportListing,
  retireListing,
  reviewListing,
  searchPublic,
  submitListing,
  type ListingInput,
} from "./catalog.js";
import { directoryPage, editorGate, editorPage, guidePage, listingPage, messagePage } from "./pages.js";
import { consumeRateLimit } from "./rateLimit.js";
import type { DestinationDeps } from "./urls.js";
import type { MarketplaceStore } from "./store.js";

const listingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(280),
  descriptionMd: z.string().min(1).max(8000),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  listingType: z.enum(["api", "plugin", "service"]),
  pricingModel: z.enum(["free", "freemium", "subscription", "usage_based", "quote", "external"]),
  currency: z.string().trim().max(8).nullable().optional(),
  priceSummary: z.string().trim().max(200).nullable().optional(),
  providerName: z.string().trim().min(1).max(120),
  providerDomain: z.string().trim().min(1).max(253),
  docsUrl: z.string().trim().min(1).max(2000),
  signupUrl: z.string().trim().max(2000).nullable().optional(),
  pricingUrl: z.string().trim().max(2000).nullable().optional(),
  statusUrl: z.string().trim().max(2000).nullable().optional(),
  termsUrl: z.string().trim().min(1).max(2000),
  privacyUrl: z.string().trim().min(1).max(2000),
  regions: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  requirements: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

const noteSchema = z.object({ note: z.string().trim().min(1).max(500) });

export interface MarketplaceDeps extends DestinationDeps {
  db: DatabaseApi;
  config: AppConfig;
}

export function mountMarketplace(app: Express, deps: MarketplaceDeps): void {
  if (!deps.config.VISION_MARKETPLACE_ENABLED) {
    for (const prefix of ["/marketplace", "/vision", "/learn", "/go"]) {
      app.use(prefix, (_req, res) => {
        res.status(404).type("text/plain").send("Not found");
      });
    }
    return;
  }
  const store = deps.db.marketplace;
  app.use("/marketplace", createApiRouter(store, deps));
  app.use("/vision", createPageRouter(store, deps));
  app.use("/learn", createLearnRouter(store, deps));
  app.use("/go", createGoRouter(store, deps));
}

function createApiRouter(store: MarketplaceStore, deps: MarketplaceDeps): Router {
  const router = Router();
  router.get("/listings", (req, res, next) => {
    try {
      assertRate(req, deps.config);
      const page = Number(req.query.page ?? 1);
      res.json(searchPublic(store, {
        q: typeof req.query.query === "string" ? req.query.query : undefined,
        category: typeof req.query.category === "string" ? req.query.category : undefined,
        type: typeof req.query.type === "string" ? req.query.type : undefined,
        page: Number.isInteger(page) ? page : 1,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings/:listingId/guides", (req, res, next) => {
    try {
      res.json(listPublicGuides(store, req.params.listingId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings/:slug", (req, res, next) => {
    try {
      const bySlug = store.getListingBySlug(req.params.slug);
      if (bySlug) {
        res.json(getPublicBySlug(store, bySlug.slug, false));
        return;
      }
      const byId = store.getListing(req.params.slug);
      if (!byId) throw notFound(`Listing ${req.params.slug} does not exist`);
      res.json(getPublicBySlug(store, byId.slug, false));
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings", async (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      const parsed = listingSchema.safeParse(req.body);
      if (!parsed.success) throw validationError("Validation failed", fieldErrors(parsed.error.flatten().fieldErrors));
      const listing = await createDraft(store, parsed.data as ListingInput, deps);
      res.status(201).json(staffView(store, listing.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings/:id/submit", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      res.json(staffView(store, submitListing(store, req.params.id).id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings/:id/review", async (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      const parsed = noteSchema.extend({ decision: z.enum(["approve", "changes", "reject", "suspend"]) }).safeParse(req.body);
      if (!parsed.success) throw validationError("Validation failed", fieldErrors(parsed.error.flatten().fieldErrors));
      const listing = await reviewListing(store, req.params.id, parsed.data.decision, parsed.data.note, deps);
      res.json(staffView(store, listing.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings/:id/retire", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) throw validationError("Validation failed", fieldErrors(parsed.error.flatten().fieldErrors));
      res.json(staffView(store, retireListing(store, req.params.id, parsed.data.note).id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/listings", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      res.json(store.listListings({ statuses: ["draft", "submitted", "changes_requested", "published", "suspended", "archived"], limit: 100, offset: 0 }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/reports", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      res.json(store.listOpenReports());
    } catch (error) {
      next(error);
    }
  });

  router.post("/reports/:id/dismiss", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      store.dismissReport(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings/:id/metrics", (req, res, next) => {
    try {
      requireStaff(req, deps.config);
      res.json(metricsFor(store, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings/:id/reports", (req, res, next) => {
    try {
      const kind = typeof req.body?.kind === "string" ? req.body.kind : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      res.status(201).json(reportListing(store, req.params.id, kind, note));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function createPageRouter(store: MarketplaceStore, deps: MarketplaceDeps): Router {
  const router = Router();
  router.get("/", (req, res, next) => {
    try {
      assertRate(req, deps.config);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const category = typeof req.query.category === "string" ? req.query.category : "";
      const page = Number(req.query.page ?? 1);
      const result = searchPublic(store, { q, category: category || undefined, page: Number.isInteger(page) ? page : 1 });
      sendHtml(res, 200, directoryPage({ ...result, q, category }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/editor", (_req, res) => {
    sendHtml(res, 200, editorGate());
  });

  router.post("/editor", (req, res, next) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      requireStaffToken(token, deps.config);
      sendHtml(res, 200, renderEditor(store, token));
    } catch (error) {
      next(error);
    }
  });

  router.post("/editor/:id/publish", async (req, res, next) => {
    await editorAction(req, res, next, store, deps, async (id, note) => {
      await reviewListing(store, id, "approve", note, deps);
    });
  });

  router.post("/editor/:id/suspend", async (req, res, next) => {
    await editorAction(req, res, next, store, deps, async (id, note) => {
      await reviewListing(store, id, "suspend", note, deps);
    });
  });

  router.post("/editor/:id/retire", (req, res, next) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      requireStaffToken(token, deps.config);
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      retireListing(store, req.params.id, note);
      sendHtml(res, 200, renderEditor(store, token));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug", (req, res, next) => {
    try {
      const listing = getPublicBySlug(store, req.params.slug, true);
      const guides = listPublicGuides(store, listing.id).map((guide) => ({ slug: guide.slug, title: guide.title }));
      sendHtml(res, 200, listingPage(listing, false, guides));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:slug/reports", (req, res, next) => {
    try {
      const listing = store.getListingBySlug(req.params.slug);
      if (!listing) throw validationError("Listing was not found", { slug: ["not found"] });
      const kind = typeof req.body?.kind === "string" ? req.body.kind : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      reportListing(store, listing.id, kind, note);
      const guides = listPublicGuides(store, listing.id).map((guide) => ({ slug: guide.slug, title: guide.title }));
      sendHtml(res, 200, listingPage(getPublicBySlug(store, listing.slug, false), true, guides));
    } catch (error) {
      next(error);
    }
  });

  router.use(htmlErrors);
  return router;
}

function createLearnRouter(store: MarketplaceStore, deps: MarketplaceDeps): Router {
  const router = Router();
  router.get("/:slug", (req, res, next) => {
    try {
      assertRate(req, deps.config);
      const guide = getPublicGuide(store, req.params.slug);
      sendHtml(res, 200, guidePage(guide));
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

function createGoRouter(store: MarketplaceStore, deps: MarketplaceDeps): Router {
  const router = Router();
  router.get("/:listingId/:linkId", async (req, res, next) => {
    try {
      assertRate(req, deps.config);
      const destination = await openDestination(store, req.params.listingId, req.params.linkId, req.header("referer"), deps);
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, destination);
    } catch (error) {
      next(error);
    }
  });
  router.use(htmlErrors);
  return router;
}

async function editorAction(
  req: Request,
  res: Response,
  next: (error: unknown) => void,
  store: MarketplaceStore,
  deps: MarketplaceDeps,
  action: (id: string, note: string) => Promise<void>,
) {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    requireStaffToken(token, deps.config);
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    const id = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id;
    await action(id, note);
    sendHtml(res, 200, renderEditor(store, token));
  } catch (error) {
    next(error);
  }
}

function renderEditor(store: MarketplaceStore, token: string): string {
  const listings = store.listListings({
    statuses: ["draft", "submitted", "changes_requested", "published", "suspended", "archived"],
    limit: 100,
    offset: 0,
  });
  return editorPage(token, listings, store.listOpenReports());
}

function staffView(store: MarketplaceStore, id: string) {
  const listing = store.getListing(id);
  return { ...listing, links: listing ? store.listLinks(id) : [] };
}

function requireStaff(req: Request, config: AppConfig): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  requireStaffToken(token, config);
  const origin = req.header("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      throw unauthorized("Origin is not allowed");
    }
    if (originHost !== req.header("host")) throw unauthorized("Origin is not allowed");
  }
}

function requireStaffToken(token: string, config: AppConfig): void {
  const expected = config.VISION_STAFF_TOKEN;
  const presented = Buffer.from(token);
  const actual = Buffer.from(expected);
  if (!expected || presented.length !== actual.length || !timingSafeEqual(presented, actual)) {
    throw unauthorized("Staff token is required");
  }
}

function assertRate(req: Request, config: AppConfig): void {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  if (!consumeRateLimit(key, config.VISION_PUBLIC_RATE_LIMIT)) {
    throw new AppError("CONFLICT", "Too many requests", 429);
  }
}

function htmlErrors(error: unknown, _req: Request, res: Response, next: (error: unknown) => void): void {
  const page = htmlError(error);
  if (!page) {
    next(error);
    return;
  }
  sendHtml(res, page.status, page.html);
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'").send(html);
}

function fieldErrors(value: Record<string, string[] | undefined>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

export function htmlError(error: unknown): { status: number; html: string } | undefined {
  if (error instanceof AppError) return messagePage(error.statusCode === 404 ? "Not found" : "Unable to continue", error.message, error.statusCode);
  return undefined;
}
