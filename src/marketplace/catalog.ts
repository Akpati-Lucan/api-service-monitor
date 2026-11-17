import { randomUUID } from "node:crypto";
import type { MarketplaceStore, ListingRecord, ListingLinkRecord, ReviewDecision, GuideRecord } from "./store.js";
import { assertPublicDestination, hostWithin, type DestinationDeps } from "./urls.js";
import { notFound, validationError } from "../utils/errors.js";

export const CATEGORIES = [
  "payments",
  "identity",
  "messaging",
  "storage",
  "observability",
  "ai",
  "data",
  "developer_tooling",
] as const;

export const PAGE_SIZE = 12;

const referrerHosts = new Set(["google.com", "www.google.com", "duckduckgo.com", "www.bing.com", "bing.com"]);

export type PublicStatus = "published" | "temporarily_unavailable" | "under_review" | "retired";

export function publicStatus(status: ListingRecord["status"]): PublicStatus | null {
  if (status === "published") return "published";
  if (status === "suspended") return "temporarily_unavailable";
  if (status === "archived") return "retired";
  if (status === "submitted" || status === "changes_requested") return "under_review";
  return null;
}

export function publicStatusLabel(status: PublicStatus): string {
  if (status === "published") return "Published";
  if (status === "temporarily_unavailable") return "Temporarily unavailable";
  if (status === "under_review") return "Under review";
  return "Retired";
}

export interface PublicListing {
  id: string;
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  listingType: string;
  publicStatus: PublicStatus;
  pricingModel: string;
  priceSummary: string | null;
  providerName: string;
  providerDomain: string;
  regions: string[];
  capabilities: string[];
  requirements: string[];
  lastReviewedAt: string | null;
  links: Array<{ id: string; label: string; kind: string }>;
}

export interface ListingInput {
  name: string;
  summary: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  listingType: ListingRecord["listingType"];
  pricingModel: ListingRecord["pricingModel"];
  currency: string | null;
  priceSummary: string | null;
  providerName: string;
  providerDomain: string;
  docsUrl: string;
  signupUrl: string | null;
  pricingUrl: string | null;
  statusUrl: string | null;
  termsUrl: string;
  privacyUrl: string;
  regions: string[];
  capabilities: string[];
  requirements: string[];
}

const linkLabels: Record<string, string> = {
  docs: "Documentation",
  pricing: "Pricing",
  signup: "Sign up",
  status: "Provider status",
  terms: "Terms",
  privacy: "Privacy",
};

export async function applyListingUpdate(store: MarketplaceStore, id: string, input: ListingInput, deps: DestinationDeps, now = new Date()): Promise<ListingRecord> {
  const current = required(store, id);
  const verified = await verifyListingUrls(input, deps);
  const republish = current.status === "published";
  store.updateListing(id, {
    ...verified,
    status: republish ? "draft" : current.status,
    publishedAt: republish ? null : current.publishedAt,
    updatedAt: now.toISOString(),
  });
  store.replaceLinks(id, linksFrom(verified));
  return required(store, id);
}

export async function createDraft(store: MarketplaceStore, input: ListingInput, deps: DestinationDeps, now = new Date(), publisherId: string | null = null): Promise<ListingRecord> {
  const verified = await verifyListingUrls(input, deps);
  const slug = uniqueSlug(store, slugify(input.name));
  const listing = store.insertListing({
    id: randomUUID(),
    slug,
    ...verified,
    publisherId,
    createdAt: now.toISOString(),
  });
  store.replaceLinks(listing.id, linksFrom(verified));
  return store.getListing(listing.id) ?? listing;
}

export function submitListing(store: MarketplaceStore, id: string, now = new Date()): ListingRecord {
  const listing = required(store, id);
  if (listing.status !== "draft" && listing.status !== "changes_requested") {
    throw validationError("Only a draft can be submitted", { status: ["listing cannot be submitted"] });
  }
  store.updateListing(id, { status: "submitted", updatedAt: now.toISOString() });
  return required(store, id);
}

export async function reviewListing(
  store: MarketplaceStore,
  id: string,
  decision: ReviewDecision,
  note: string,
  deps: DestinationDeps,
  now = new Date(),
): Promise<ListingRecord> {
  const listing = required(store, id);
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  if (decision === "approve") {
    await verifyListingUrls(listing, deps);
    store.updateListing(id, {
      status: "published",
      publishedAt: now.toISOString(),
      reviewedBy: "staff",
      reviewNote: trimmed,
      updatedAt: now.toISOString(),
    });
  } else if (decision === "changes") {
    store.updateListing(id, { status: "changes_requested", reviewNote: trimmed, reviewedBy: "staff", updatedAt: now.toISOString() });
  } else if (decision === "reject") {
    store.updateListing(id, { status: "draft", reviewNote: trimmed, reviewedBy: "staff", updatedAt: now.toISOString() });
  } else {
    store.updateListing(id, { status: "suspended", reviewNote: trimmed, reviewedBy: "staff", updatedAt: now.toISOString() });
  }
  store.insertReview({
    id: randomUUID(),
    listingId: id,
    reviewerId: "staff",
    decision,
    note: trimmed,
    createdAt: now.toISOString(),
  });
  return required(store, id);
}

export function retireListing(store: MarketplaceStore, id: string, note: string, now = new Date()): ListingRecord {
  const listing = required(store, id);
  if (listing.status === "archived") return listing;
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  store.updateListing(id, { status: "archived", reviewNote: trimmed, reviewedBy: "staff", updatedAt: now.toISOString() });
  store.insertReview({
    id: randomUUID(),
    listingId: id,
    reviewerId: "staff",
    decision: "reject",
    note: trimmed,
    createdAt: now.toISOString(),
  });
  return required(store, id);
}

export function searchPublic(store: MarketplaceStore, query: { q?: string; category?: string; type?: string; page?: number }) {
  const page = Math.max(1, query.page ?? 1);
  const filter = {
    statuses: ["published", "suspended", "archived"] as ListingRecord["status"][],
    category: query.category,
    listingType: query.type,
    query: query.q?.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const total = store.countListings(filter);
  return {
    page,
    pageSize: PAGE_SIZE,
    total,
    listings: store.listListings(filter).map((listing) => toPublic(store, listing)),
  };
}

export function getPublicBySlug(store: MarketplaceStore, slug: string, recordView: boolean): PublicListing {
  const listing = store.getListingBySlug(slug);
  const status = listing ? publicStatus(listing.status) : null;
  if (!listing || !status || status === "under_review") {
    throw notFound(`Listing ${slug} does not exist`);
  }
  if (recordView) {
    store.insertEvent({ listingId: listing.id, eventType: "view", occurredAt: new Date().toISOString(), coarseReferrer: null });
  }
  return toPublic(store, listing);
}

export function listPublicGuides(store: MarketplaceStore, listingId: string) {
  const listing = store.getListing(listingId);
  const status = listing ? publicStatus(listing.status) : null;
  if (!listing || !status || status === "under_review") throw notFound(`Listing ${listingId} does not exist`);
  return store.listGuides(listingId, true).map(toPublicGuide);
}

export function getPublicGuide(store: MarketplaceStore, slug: string) {
  const guide = store.getGuideBySlug(slug);
  if (!guide || !guide.published || !guide.verifiedAt || !guide.verifiedBy) {
    throw notFound(`Guide ${slug} does not exist`);
  }
  return toPublicGuide(guide);
}

export async function openDestination(
  store: MarketplaceStore,
  listingId: string,
  linkId: string,
  referrer: string | undefined,
  deps: DestinationDeps,
): Promise<string> {
  const listing = store.getListing(listingId);
  const link = store.getLink(listingId, linkId);
  if (!listing || listing.status !== "published" || !link || !link.enabled) {
    throw notFound("Destination does not exist");
  }
  const destination = await assertPublicDestination(link.url, deps);
  store.insertEvent({
    listingId,
    eventType: "outbound_click",
    occurredAt: new Date().toISOString(),
    coarseReferrer: coarseReferrer(referrer),
  });
  return destination;
}

export function reportListing(store: MarketplaceStore, id: string, kind: string, note: string, now = new Date()) {
  const listing = store.getListing(id);
  const status = listing ? publicStatus(listing.status) : null;
  if (!listing || !status || status === "under_review") throw notFound(`Listing ${id} does not exist`);
  const trimmed = note.trim();
  if (!["stale", "misleading", "unsafe", "other"].includes(kind) || trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  const report = { id: randomUUID(), listingId: id, kind, note: trimmed, status: "open", createdAt: now.toISOString() };
  store.insertReport(report);
  return { id: report.id };
}

export function metricsFor(store: MarketplaceStore, id: string) {
  required(store, id);
  return {
    views: store.countEvents(id, "view"),
    outboundClicks: store.countEvents(id, "outbound_click"),
  };
}

function toPublic(store: MarketplaceStore, listing: ListingRecord): PublicListing {
  const status = publicStatus(listing.status) ?? "retired";
  const links = status === "published"
    ? store.listLinks(listing.id).filter((link) => link.enabled).map((link) => ({ id: link.id, label: link.label, kind: link.kind }))
    : [];
  return {
    id: listing.id,
    slug: listing.slug,
    name: listing.name,
    summary: listing.summary,
    descriptionMd: listing.descriptionMd,
    category: listing.category,
    tags: listing.tags,
    listingType: listing.listingType,
    publicStatus: status,
    pricingModel: listing.pricingModel,
    priceSummary: listing.priceSummary,
    providerName: listing.providerName,
    providerDomain: listing.providerDomain,
    regions: listing.regions,
    capabilities: listing.capabilities,
    requirements: listing.requirements,
    lastReviewedAt: store.latestReviewAt(listing.id) ?? listing.publishedAt,
    links,
  };
}

function toPublicGuide(guide: GuideRecord) {
  return {
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    bodyMd: guide.bodyMd,
    prerequisites: guide.prerequisites,
    difficulty: guide.difficulty,
    verifiedAt: guide.verifiedAt,
    verifiedBy: guide.verifiedBy,
    listingId: guide.listingId,
  };
}

async function verifyListingUrls(input: ListingInput | ListingRecord, deps: DestinationDeps): Promise<ListingInput> {
  if (!CATEGORIES.includes(input.category as (typeof CATEGORIES)[number])) {
    throw validationError("Validation failed", { category: ["unknown category"] });
  }
  const names = ["docsUrl", "termsUrl", "privacyUrl", "signupUrl", "pricingUrl", "statusUrl"] as const;
  const next: ListingInput = {
    name: input.name.trim(),
    summary: input.summary.trim(),
    descriptionMd: input.descriptionMd,
    category: input.category,
    tags: input.tags,
    listingType: input.listingType,
    pricingModel: input.pricingModel,
    currency: input.currency ?? null,
    priceSummary: input.priceSummary ?? null,
    providerName: input.providerName.trim(),
    providerDomain: input.providerDomain.trim().toLowerCase(),
    docsUrl: input.docsUrl,
    signupUrl: input.signupUrl ?? null,
    pricingUrl: input.pricingUrl ?? null,
    statusUrl: input.statusUrl ?? null,
    termsUrl: input.termsUrl,
    privacyUrl: input.privacyUrl,
    regions: input.regions,
    capabilities: input.capabilities,
    requirements: input.requirements,
  };
  if (next.name.length < 1 || next.summary.length < 1 || next.providerName.length < 1) {
    throw validationError("Validation failed", { name: ["name, summary, and provider are required"] });
  }
  for (const name of names) {
    const value = next[name];
    if (!value) continue;
    const destination = await assertPublicDestination(value, deps);
    const host = new URL(destination).hostname;
    if (!hostWithin(next.providerDomain, host)) {
      throw validationError("Validation failed", { [name]: ["URL must be on the provider domain"] });
    }
    next[name] = destination;
  }
  return next;
}

function linksFrom(input: ListingInput): Array<Omit<ListingLinkRecord, "listingId">> {
  const pairs: Array<[keyof ListingInput, ListingLinkRecord["kind"]]> = [
    ["docsUrl", "docs"],
    ["pricingUrl", "pricing"],
    ["signupUrl", "signup"],
    ["statusUrl", "status"],
    ["termsUrl", "terms"],
    ["privacyUrl", "privacy"],
  ];
  return pairs.flatMap(([field, kind], index) => {
    const url = input[field];
    if (typeof url !== "string" || url.length === 0) return [];
    return [{ id: randomUUID(), label: linkLabels[kind] ?? kind, url, kind, sortOrder: index + 1, enabled: true }];
  });
}

function required(store: MarketplaceStore, id: string): ListingRecord {
  const listing = store.getListing(id);
  if (!listing) throw notFound(`Listing ${id} does not exist`);
  return listing;
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 80) || "listing";
}

function uniqueSlug(store: MarketplaceStore, base: string): string {
  let slug = base;
  let suffix = 2;
  while (store.getListingBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function coarseReferrer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return referrerHosts.has(host) ? host : null;
  } catch {
    return null;
  }
}
