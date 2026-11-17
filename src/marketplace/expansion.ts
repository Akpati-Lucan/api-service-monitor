import { randomUUID } from "node:crypto";
import type { AppConfig } from "../types/index.js";
import { conflict, forbidden, notFound, validationError } from "../utils/errors.js";
import type { DatabaseApi } from "../db/database.js";
import { findSecrets } from "./secrets.js";
import { assertPublicDestination, type DestinationDeps } from "./urls.js";
import type { IdentityStore, OrgRole } from "./identity.js";
import type { MarketplaceStore } from "./store.js";
import type { ExpansionStore, ListingNotice } from "./expansionStore.js";

// Phase 14 keeps catalogs, totals, a compatibility review, and an explicit monitor template.
// SDK packages stay unpublished. Public star ratings stay closed. One billing adapter remains.

export const BADGE_DAYS = 180;
const EDIT = new Set<OrgRole>(["owner", "admin", "editor"]);
const fixedTemplate = /^https:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[A-Za-z0-9._~/-]*)?$/;
const hostTemplate = /^https:\/\/\{host\}(?::\d{2,5})?(?:\/[A-Za-z0-9._~/-]*)?$/;
const secretRefPattern = /^[A-Z][A-Z0-9_]{0,63}$/;

export function badgeSentence(store: ExpansionStore, listingId: string, now: string): string {
  const review = store.getCompatibility(listingId);
  if (!review || review.expiresAt <= now) return "";
  return `Compatibility reviewed ${review.reviewedAt}.`;
}

export function assessCompatibility(input: { published: boolean; httpsLinks: number; example: string; now: string }): { passed: boolean; sentence: string } {
  if (!input.published) return { passed: false, sentence: "The listing is not published." };
  if (input.httpsLinks < 1) return { passed: false, sentence: "The listing needs a reviewed HTTPS link." };
  if (findSecrets(input.example).length > 0) return { passed: false, sentence: "The example contains a credential." };
  return { passed: true, sentence: `Compatibility reviewed ${input.now}.` };
}

export function recordCompatibility(store: ExpansionStore, listings: MarketplaceStore, listingId: string, example: string, now: string): { passed: boolean; sentence: string } {
  const listing = listings.getListing(listingId);
  if (!listing) throw notFound("Listing does not exist.");
  const httpsLinks = listings.listLinks(listingId).filter((link) => link.enabled && link.url.startsWith("https://")).length;
  const result = assessCompatibility({ published: listing.status === "published", httpsLinks, example, now });
  if (!result.passed) return result;
  const expires = new Date(Date.parse(now) + BADGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  store.saveCompatibility({ listingId, reviewedAt: now, expiresAt: expires });
  return result;
}

export function saveTemplate(store: ExpansionStore, listings: MarketplaceStore, listingId: string, urlTemplate: string, now: string): void {
  const listing = listings.getListing(listingId);
  if (!listing || listing.status !== "published") throw notFound("Listing does not exist.");
  if (!fixedTemplate.test(urlTemplate) && !hostTemplate.test(urlTemplate)) {
    throw validationError("The template must be a reviewed HTTPS path.");
  }
  store.saveTemplate({ listingId, urlTemplate, probeKind: "http", reviewedAt: now });
}

export function saveInCollection(input: {
  store: ExpansionStore;
  listings: MarketplaceStore;
  identity: IdentityStore;
  userId: string;
  organizationId: string;
  listingId: string;
  name: string;
  now: string;
}): { collectionId: string } {
  requireEditor(input.identity, input.userId, input.organizationId);
  const listing = input.listings.getListing(input.listingId);
  if (!listing || listing.status !== "published") throw notFound("Listing does not exist.");
  const name = cleanName(input.name || "Saved");
  let collection = input.store.findCollection(input.organizationId, name);
  if (!collection) {
    collection = { id: randomUUID(), organizationId: input.organizationId, name, createdAt: input.now };
    input.store.insertCollection(collection);
  }
  input.store.addItem(collection.id, listing.id, input.now);
  return { collectionId: collection.id };
}

export function postNotice(input: {
  store: ExpansionStore;
  listings: MarketplaceStore;
  identity: IdentityStore;
  userId: string;
  organizationId: string;
  listingId: string;
  versionLabel: string;
  summary: string;
  now: string;
}): void {
  requireEditor(input.identity, input.userId, input.organizationId);
  const listing = input.listings.getListing(input.listingId);
  if (!listing || listing.publisherId !== input.organizationId) throw notFound("Listing does not exist.");
  const versionLabel = input.versionLabel.trim();
  const summary = input.summary.trim();
  if (versionLabel.length < 1 || versionLabel.length > 40 || summary.length < 1 || summary.length > 200) {
    throw validationError("A notice needs a version and a short summary.");
  }
  input.store.insertNotice({ id: randomUUID(), listingId: listing.id, versionLabel, summary, createdAt: input.now });
}

export function recordGuideNotice(store: ExpansionStore, listingId: string | null, revision: number, now: string): void {
  if (!listingId) return;
  store.insertNotice({
    id: randomUUID(),
    listingId,
    versionLabel: `guide-${revision}`,
    summary: "A verified guide was updated.",
    createdAt: now,
  });
}

export function comparisonItems(store: ExpansionStore, identity: IdentityStore, userId: string, collectionId: string) {
  const collection = store.getCollection(collectionId);
  if (!collection || !identity.getMember(collection.organizationId, userId)) throw notFound("Collection does not exist.");
  const items = store.listItems(collectionId).filter((item) => item.status === "published").slice(0, 3);
  return { collection, items, badgeFor: (listingId: string, now: string) => badgeSentence(store, listingId, now) };
}

export function noticesForCollection(store: ExpansionStore, identity: IdentityStore, userId: string, organizationId: string): ListingNotice[] {
  if (!identity.getMember(organizationId, userId)) throw notFound("Organization does not exist.");
  const notices: ListingNotice[] = [];
  for (const collection of store.listCollections(organizationId)) {
    for (const item of store.listItems(collection.id)) {
      if (item.status !== "published") continue;
      notices.push(...store.listNotices(item.listingId));
    }
  }
  return notices.slice(0, 6);
}

export async function createMonitorFromTemplate(input: {
  db: DatabaseApi;
  store: ExpansionStore;
  listings: MarketplaceStore;
  identity: IdentityStore;
  userId: string;
  organizationId: string;
  listingId: string;
  name: string;
  host: string;
  secretRef: string;
  deps: DestinationDeps;
  config: AppConfig;
  now: string;
}): Promise<{ serviceId: string; url: string; secretRef: string }> {
  requireEditor(input.identity, input.userId, input.organizationId);
  const listing = input.listings.getListing(input.listingId);
  if (!listing || listing.status !== "published") throw notFound("Listing does not exist.");
  const template = input.store.getTemplate(listing.id);
  if (!template) throw conflict("This listing has no reviewed monitor template.");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw validationError("The monitor needs a name.");
  const secretRef = input.secretRef.trim();
  if (secretRef && !secretRefPattern.test(secretRef)) throw validationError("The secret reference is an environment variable name.");
  const url = composeTemplate(template.urlTemplate, input.host.trim());
  const destination = await assertPublicDestination(url, input.deps);
  const service = input.db.createService({
    name,
    url: destination,
    address: destination,
    kind: "http",
    intervalSeconds: input.config.DEFAULT_INTERVAL_SECONDS,
    timeoutMs: input.config.DEFAULT_TIMEOUT_MS,
    failureThreshold: input.config.DEFAULT_FAILURE_THRESHOLD,
    secretRef: secretRef || null,
  });
  input.identity.insertAudit({
    id: randomUUID(),
    actorKind: "user",
    actorId: input.userId,
    action: "marketplace.monitor",
    subjectType: "service",
    subjectId: service.id,
    organizationId: input.organizationId,
    detailJson: JSON.stringify({ listingId: listing.id, secretRef: secretRef || "" }),
    createdAt: input.now,
  });
  return { serviceId: service.id, url: destination, secretRef };
}

export function composeTemplate(urlTemplate: string, host: string): string {
  if (hostTemplate.test(urlTemplate)) {
    if (!/^[A-Za-z0-9.-]+$/.test(host) || host.includes("..") || host.toLowerCase() === "localhost" || /^\d/.test(host)) {
      throw validationError("The monitor host must be a public name.");
    }
    return urlTemplate.replace("{host}", host);
  }
  if (fixedTemplate.test(urlTemplate) && !host) return urlTemplate;
  throw validationError("The monitor host must be a public name.");
}

function requireEditor(identity: IdentityStore, userId: string, organizationId: string): void {
  const member = identity.getMember(organizationId, userId);
  if (!member) throw notFound("Organization does not exist.");
  if (!EDIT.has(member.role)) throw forbidden("This action needs an owner, an admin, or an editor.");
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) throw validationError("The collection needs a name.");
  return trimmed;
}
