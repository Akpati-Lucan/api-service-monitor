import { randomUUID } from "node:crypto";
import type { GuideRecord, MarketplaceStore } from "./store.js";
import { exampleIsPublishable, findSecrets } from "./secrets.js";
import { notFound, validationError } from "../utils/errors.js";

export const GUIDE_STALE_DAYS = 90;

export interface LearningGuide {
  guide: GuideRecord;
  stale: boolean;
  pendingReview: boolean;
  copyAllowed: boolean;
  docsHref: string | null;
  setupHref: string | null;
  history: Array<{ version: number; note: string; author: string; createdAt: string; verifiedAt: string | null }>;
}

export function listLearningGuides(store: MarketplaceStore): GuideRecord[] {
  return store.listPublishedGuides();
}

export function presentGuide(store: MarketplaceStore, slug: string, now = Date.now()): LearningGuide {
  const guide = store.getGuideBySlug(slug);
  if (!guide || !guide.published || !guide.verifiedAt || !guide.verifiedBy) {
    throw notFound(`Guide ${slug} does not exist`);
  }
  if (guide.kind === "setup" && guide.listingId && !guide.cleanupMd.trim()) {
    throw notFound(`Guide ${slug} does not exist`);
  }
  const pending = store.listRevisions(guide.id).some((revision) => revision.verifiedAt == null);
  return {
    guide,
    stale: Date.parse(guide.verifiedAt) < now - GUIDE_STALE_DAYS * 24 * 60 * 60 * 1000,
    pendingReview: pending,
    copyAllowed: exampleIsPublishable(guide.exampleText),
    docsHref: outboundHref(store, guide, "docs"),
    setupHref: outboundHref(store, guide, "signup"),
    history: store.listRevisions(guide.id).map((revision) => ({
      version: revision.version,
      note: revision.note,
      author: revision.author,
      createdAt: revision.createdAt,
      verifiedAt: revision.verifiedAt,
    })),
  };
}

export function guideExample(store: MarketplaceStore, slug: string): string {
  const presented = presentGuide(store, slug);
  if (!presented.copyAllowed) {
    throw notFound(`Example for ${slug} is not available`);
  }
  return presented.guide.exampleText;
}

export function reportGuide(store: MarketplaceStore, slug: string, kind: string, note: string, now = new Date()) {
  const guide = store.getGuideBySlug(slug);
  if (!guide || !guide.published) throw notFound(`Guide ${slug} does not exist`);
  const trimmed = note.trim();
  if (!["error", "stale"].includes(kind) || trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  if (findSecrets(trimmed).length > 0) {
    throw validationError("Validation failed", { note: ["do not include a credential"] });
  }
  const report = { id: randomUUID(), guideId: guide.id, kind, note: trimmed, status: "open", createdAt: now.toISOString() };
  store.insertGuideReport(report);
  return { id: report.id };
}

export function proposeGuideRevision(store: MarketplaceStore, id: string, patch: Partial<GuideRecord>, note: string, now = new Date()) {
  const guide = requiredGuide(store, id);
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  const snapshot = { ...guide, ...patch };
  assertNoSecrets(snapshot);
  const version = nextVersion(store, id);
  store.insertRevision({
    id: randomUUID(),
    guideId: id,
    version,
    note: trimmed,
    author: "staff",
    verifiedAt: null,
    snapshotJson: JSON.stringify(snapshotFields(snapshot)),
    createdAt: now.toISOString(),
  });
  return { version, pending: true };
}

export function verifyGuide(store: MarketplaceStore, id: string, note: string, now = new Date()): GuideRecord {
  const guide = requiredGuide(store, id);
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  const pending = store.listRevisions(id).filter((revision) => revision.verifiedAt == null).at(-1);
  if (pending) {
    const snapshot = JSON.parse(pending.snapshotJson) as Partial<GuideRecord>;
    const next = { ...guide, ...snapshot };
    assertNoSecrets(next);
    store.updateGuide(id, {
      ...snapshotFields(next),
      revision: pending.version,
      verifiedAt: now.toISOString(),
      verifiedBy: "staff",
      updatedAt: now.toISOString(),
    });
    store.markRevisionVerified(pending.id, now.toISOString());
  } else {
    store.updateGuide(id, { verifiedAt: now.toISOString(), verifiedBy: "staff", updatedAt: now.toISOString() });
    store.insertRevision({
      id: randomUUID(),
      guideId: id,
      version: nextVersion(store, id),
      note: trimmed,
      author: "staff",
      verifiedAt: now.toISOString(),
      snapshotJson: JSON.stringify(snapshotFields(guide)),
      createdAt: now.toISOString(),
    });
  }
  store.resolveGuideReports(id);
  return requiredGuide(store, id);
}

function requiredGuide(store: MarketplaceStore, id: string): GuideRecord {
  const guide = store.getGuide(id);
  if (!guide) throw notFound(`Guide ${id} does not exist`);
  return guide;
}

function nextVersion(store: MarketplaceStore, guideId: string): number {
  const versions = store.listRevisions(guideId).map((revision) => revision.version);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function outboundHref(store: MarketplaceStore, guide: GuideRecord, kind: "docs" | "signup"): string | null {
  if (!guide.listingId) return null;
  const listing = store.getListing(guide.listingId);
  if (!listing || listing.status !== "published") return null;
  const link = store.listLinks(guide.listingId).find((item) => item.enabled && item.kind === kind);
  return link ? `/go/${listing.id}/${link.id}` : null;
}

function assertNoSecrets(guide: Partial<GuideRecord>): void {
  const blob = [guide.bodyMd, guide.localTestMd, guide.productionMd, guide.exampleText, guide.successMd].filter(Boolean).join("\n");
  if (findSecrets(blob).length > 0) {
    throw validationError("Validation failed", { exampleText: ["examples cannot contain a credential"] });
  }
}

function snapshotFields(guide: Partial<GuideRecord>) {
  return {
    title: guide.title,
    summary: guide.summary,
    bodyMd: guide.bodyMd,
    prerequisites: guide.prerequisites,
    purpose: guide.purpose,
    minPermissions: guide.minPermissions,
    credentialLocation: guide.credentialLocation,
    localTestMd: guide.localTestMd,
    productionMd: guide.productionMd,
    securityNotes: guide.securityNotes,
    costNotes: guide.costNotes,
    commonErrorsMd: guide.commonErrorsMd,
    cleanupMd: guide.cleanupMd,
    testedVersion: guide.testedVersion,
    testEnvironment: guide.testEnvironment,
    compatibilityNotes: guide.compatibilityNotes,
    exampleText: guide.exampleText,
    successMd: guide.successMd,
  };
}
