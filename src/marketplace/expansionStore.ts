import type Database from "better-sqlite3";

export interface CollectionRecord {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface CollectionItem {
  collectionId: string;
  listingId: string;
  name: string;
  slug: string;
  summary: string;
  category: string;
  priceSummary: string | null;
  regions: string[];
  status: string;
  createdAt: string;
}

export interface ListingTemplate {
  listingId: string;
  urlTemplate: string;
  probeKind: string;
  reviewedAt: string;
}

export interface CompatibilityReview {
  listingId: string;
  reviewedAt: string;
  expiresAt: string;
}

export interface ListingNotice {
  id: string;
  listingId: string;
  versionLabel: string;
  summary: string;
  createdAt: string;
}

export interface ListingTotals {
  checkoutStarts: number;
  activeSubscriptions: number;
  canceledSubscriptions: number;
  refundMinor: number;
}

export interface ExpansionStore {
  insertCollection(row: CollectionRecord): void;
  findCollection(organizationId: string, name: string): CollectionRecord | undefined;
  getCollection(id: string): CollectionRecord | undefined;
  listCollections(organizationId: string): CollectionRecord[];
  addItem(collectionId: string, listingId: string, createdAt: string): void;
  listItems(collectionId: string): CollectionItem[];
  saveTemplate(row: ListingTemplate): void;
  getTemplate(listingId: string): ListingTemplate | undefined;
  saveCompatibility(row: CompatibilityReview): void;
  getCompatibility(listingId: string): CompatibilityReview | undefined;
  insertNotice(row: ListingNotice): void;
  listNotices(listingId: string): ListingNotice[];
  listingTotals(listingId: string): ListingTotals;
}

export function createExpansionStore(db: Database.Database): ExpansionStore {
  return {
    insertCollection(row) {
      db.prepare(`INSERT INTO collections (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)`).run(row.id, row.organizationId, row.name, row.createdAt);
    },
    findCollection(organizationId, name) {
      return mapCollection(db.prepare(`SELECT id, organization_id as organizationId, name, created_at as createdAt FROM collections WHERE organization_id = ? AND name = ?`).get(organizationId, name) as Record<string, unknown> | undefined);
    },
    getCollection(id) {
      return mapCollection(db.prepare(`SELECT id, organization_id as organizationId, name, created_at as createdAt FROM collections WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
    },
    listCollections(organizationId) {
      return (db.prepare(`SELECT id, organization_id as organizationId, name, created_at as createdAt FROM collections WHERE organization_id = ? ORDER BY created_at`).all(organizationId) as Array<Record<string, unknown>>).map((row) => mapCollection(row)!);
    },
    addItem(collectionId, listingId, createdAt) {
      db.prepare(`INSERT INTO collection_items (collection_id, listing_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(collectionId, listingId, createdAt);
    },
    listItems(collectionId) {
      const rows = db.prepare(
        `SELECT item.collection_id as collectionId, item.listing_id as listingId, listing.name, listing.slug, listing.summary,
                listing.category, listing.price_summary as priceSummary, listing.regions_json as regionsJson, listing.status, item.created_at as createdAt
         FROM collection_items item JOIN marketplace_listings listing ON listing.id = item.listing_id
         WHERE item.collection_id = ? ORDER BY item.created_at`,
      ).all(collectionId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        collectionId: String(row.collectionId),
        listingId: String(row.listingId),
        name: String(row.name),
        slug: String(row.slug),
        summary: String(row.summary),
        category: String(row.category),
        priceSummary: row.priceSummary == null ? null : String(row.priceSummary),
        regions: JSON.parse(String(row.regionsJson ?? "[]")) as string[],
        status: String(row.status),
        createdAt: String(row.createdAt),
      }));
    },
    saveTemplate(row) {
      db.prepare(
        `INSERT INTO listing_templates (listing_id, url_template, probe_kind, reviewed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(listing_id) DO UPDATE SET url_template = excluded.url_template, probe_kind = excluded.probe_kind, reviewed_at = excluded.reviewed_at`,
      ).run(row.listingId, row.urlTemplate, row.probeKind, row.reviewedAt);
    },
    getTemplate(listingId) {
      const row = db.prepare(`SELECT listing_id as listingId, url_template as urlTemplate, probe_kind as probeKind, reviewed_at as reviewedAt FROM listing_templates WHERE listing_id = ?`).get(listingId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { listingId: String(row.listingId), urlTemplate: String(row.urlTemplate), probeKind: String(row.probeKind), reviewedAt: String(row.reviewedAt) };
    },
    saveCompatibility(row) {
      db.prepare(
        `INSERT INTO compatibility_reviews (listing_id, reviewed_at, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(listing_id) DO UPDATE SET reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at`,
      ).run(row.listingId, row.reviewedAt, row.expiresAt);
    },
    getCompatibility(listingId) {
      const row = db.prepare(`SELECT listing_id as listingId, reviewed_at as reviewedAt, expires_at as expiresAt FROM compatibility_reviews WHERE listing_id = ?`).get(listingId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { listingId: String(row.listingId), reviewedAt: String(row.reviewedAt), expiresAt: String(row.expiresAt) };
    },
    insertNotice(row) {
      db.prepare(`INSERT INTO listing_notices (id, listing_id, version_label, summary, created_at) VALUES (?, ?, ?, ?, ?)`).run(row.id, row.listingId, row.versionLabel, row.summary, row.createdAt);
    },
    listNotices(listingId) {
      const rows = db.prepare(`SELECT id, listing_id as listingId, version_label as versionLabel, summary, created_at as createdAt FROM listing_notices WHERE listing_id = ? ORDER BY created_at DESC LIMIT 3`).all(listingId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        listingId: String(row.listingId),
        versionLabel: String(row.versionLabel),
        summary: String(row.summary),
        createdAt: String(row.createdAt),
      }));
    },
    listingTotals(listingId) {
      const starts = db.prepare(
        `SELECT COUNT(*) as count FROM checkout_attempts attempt JOIN marketplace_offers offer ON offer.id = attempt.offer_id WHERE offer.listing_id = ?`,
      ).get(listingId) as { count: number };
      const active = db.prepare(
        `SELECT COUNT(*) as count FROM marketplace_subscriptions subscription JOIN marketplace_offers offer ON offer.id = subscription.offer_id
         WHERE offer.listing_id = ? AND subscription.state IN ('active', 'trialing')`,
      ).get(listingId) as { count: number };
      const canceled = db.prepare(
        `SELECT COUNT(*) as count FROM marketplace_subscriptions subscription JOIN marketplace_offers offer ON offer.id = subscription.offer_id
         WHERE offer.listing_id = ? AND subscription.state = 'canceled'`,
      ).get(listingId) as { count: number };
      const refunds = db.prepare(
        `SELECT COALESCE(SUM(ledger.gross_minor), 0) as total FROM billing_ledger ledger
         JOIN marketplace_subscriptions subscription ON subscription.id = ledger.subscription_id
         JOIN marketplace_offers offer ON offer.id = subscription.offer_id
         WHERE offer.listing_id = ? AND ledger.kind = 'refund'`,
      ).get(listingId) as { total: number };
      return {
        checkoutStarts: Number(starts.count),
        activeSubscriptions: Number(active.count),
        canceledSubscriptions: Number(canceled.count),
        refundMinor: Number(refunds.total),
      };
    },
  };
}

function mapCollection(row: Record<string, unknown> | undefined): CollectionRecord | undefined {
  if (!row) return undefined;
  return { id: String(row.id), organizationId: String(row.organizationId), name: String(row.name), createdAt: String(row.createdAt) };
}
