import type Database from "better-sqlite3";

export type EditorialStatus = "draft" | "submitted" | "changes_requested" | "published" | "suspended" | "archived";
export type ListingType = "api" | "plugin" | "service";
export type PricingModel = "free" | "freemium" | "subscription" | "usage_based" | "quote" | "external";
export type LinkKind = "docs" | "pricing" | "signup" | "status" | "terms" | "privacy" | "support";
export type ReviewDecision = "approve" | "changes" | "reject" | "suspend";
export type GuideDifficulty = "beginner" | "intermediate" | "advanced";
export type GuideKind = "quickstart" | "tutorial" | "setup" | "troubleshooting" | "glossary";

export interface ListingRecord {
  id: string;
  slug: string;
  publisherId: string | null;
  name: string;
  summary: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  listingType: ListingType;
  status: EditorialStatus;
  pricingModel: PricingModel;
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
  reviewNote: string | null;
  reviewedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingLinkRecord {
  id: string;
  listingId: string;
  label: string;
  url: string;
  kind: LinkKind;
  sortOrder: number;
  enabled: boolean;
}

export interface GuideRecord {
  id: string;
  listingId: string | null;
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  prerequisites: string;
  difficulty: GuideDifficulty;
  published: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
  kind: GuideKind;
  locale: string;
  purpose: string;
  setupUrl: string | null;
  minPermissions: string;
  credentialLocation: string;
  localTestMd: string;
  productionMd: string;
  securityNotes: string;
  costNotes: string;
  commonErrorsMd: string;
  cleanupMd: string;
  docsUrl: string | null;
  testedVersion: string;
  testEnvironment: string;
  compatibilityNotes: string;
  exampleText: string;
  successMd: string;
  revision: number;
}

export interface GuideRevision {
  id: string;
  guideId: string;
  version: number;
  note: string;
  author: string;
  verifiedAt: string | null;
  snapshotJson: string;
  createdAt: string;
}

export interface GuideReport {
  id: string;
  guideId: string;
  kind: string;
  note: string;
  status: string;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  listingId: string;
  reviewerId: string;
  decision: ReviewDecision;
  note: string;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  listingId: string;
  kind: string;
  note: string;
  status: string;
  createdAt: string;
}

export interface ListingDraft {
  id: string;
  slug: string;
  publisherId?: string | null;
  name: string;
  summary: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  listingType: ListingType;
  pricingModel: PricingModel;
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
  createdAt: string;
}

export interface MarketplaceStore {
  getListing(id: string): ListingRecord | undefined;
  getListingBySlug(slug: string): ListingRecord | undefined;
  insertListing(input: ListingDraft): ListingRecord;
  updateListing(id: string, patch: Partial<ListingRecord> & { updatedAt: string }): void;
  listListings(filter: { statuses: EditorialStatus[]; category?: string; listingType?: string; query?: string; limit: number; offset: number }): ListingRecord[];
  countListings(filter: { statuses: EditorialStatus[]; category?: string; listingType?: string; query?: string }): number;
  replaceLinks(listingId: string, links: Array<Omit<ListingLinkRecord, "listingId">>): void;
  listLinks(listingId: string): ListingLinkRecord[];
  getLink(listingId: string, linkId: string): ListingLinkRecord | undefined;
  insertEvent(input: { listingId: string; eventType: "view" | "outbound_click"; occurredAt: string; coarseReferrer: string | null }): void;
  countEvents(listingId: string, eventType: "view" | "outbound_click"): number;
  insertReview(input: Omit<ReviewRecord, "id" | "createdAt"> & { id: string; createdAt: string }): void;
  listReviews(listingId: string): ReviewRecord[];
  latestReviewAt(listingId: string): string | null;
  listOwnedListings(publisherId: string): ListingRecord[];
  listGuideIdsByPublisher(publisherId: string): string[];
  insertGuide(input: GuideRecord): void;
  updateGuide(id: string, patch: Partial<GuideRecord> & { updatedAt: string }): void;
  getGuide(id: string): GuideRecord | undefined;
  getGuideBySlug(slug: string): GuideRecord | undefined;
  listGuides(listingId: string, publishedOnly: boolean): GuideRecord[];
  listPublishedGuides(): GuideRecord[];
  insertRevision(input: GuideRevision): void;
  listRevisions(guideId: string): GuideRevision[];
  markRevisionVerified(id: string, verifiedAt: string): void;
  insertGuideReport(input: GuideReport): void;
  listOpenGuideReports(): GuideReport[];
  resolveGuideReports(guideId: string): void;
  insertReport(input: ReportRecord): void;
  listOpenReports(): ReportRecord[];
  dismissReport(id: string): void;
  listEvents(listingId: string): Array<{ eventType: string; coarseReferrer: string | null }>;
}

export function createMarketplaceStore(db: Database.Database): MarketplaceStore {
  const listingColumns = `
    id, slug, publisher_id as publisherId, name, summary, description_md as descriptionMd,
    category, tags_json as tagsJson, listing_type as listingType, status, pricing_model as pricingModel,
    currency, price_summary as priceSummary, provider_name as providerName, provider_domain as providerDomain,
    docs_url as docsUrl, signup_url as signupUrl, pricing_url as pricingUrl, status_url as statusUrl,
    terms_url as termsUrl, privacy_url as privacyUrl, regions_json as regionsJson,
    capabilities_json as capabilitiesJson, requirements_json as requirementsJson,
    review_note as reviewNote, reviewed_by as reviewedBy, published_at as publishedAt,
    created_at as createdAt, updated_at as updatedAt
  `;

  const guideColumns = `
    id, listing_id as listingId, slug, title, summary, body_md as bodyMd, prerequisites, difficulty,
    published, verified_at as verifiedAt, verified_by as verifiedBy, created_at as createdAt, updated_at as updatedAt,
    kind, locale, purpose, setup_url as setupUrl, min_permissions as minPermissions, credential_location as credentialLocation,
    local_test_md as localTestMd, production_md as productionMd, security_notes as securityNotes, cost_notes as costNotes,
    common_errors_md as commonErrorsMd, cleanup_md as cleanupMd, docs_url as docsUrl, tested_version as testedVersion,
    test_environment as testEnvironment, compatibility_notes as compatibilityNotes, example_text as exampleText,
    success_md as successMd, revision
  `;

  function mapListing(row: Record<string, unknown>): ListingRecord {
    return {
      id: String(row.id),
      slug: String(row.slug),
      publisherId: row.publisherId == null ? null : String(row.publisherId),
      name: String(row.name),
      summary: String(row.summary),
      descriptionMd: String(row.descriptionMd),
      category: String(row.category),
      tags: parseList(row.tagsJson),
      listingType: row.listingType as ListingType,
      status: row.status as EditorialStatus,
      pricingModel: row.pricingModel as PricingModel,
      currency: row.currency == null ? null : String(row.currency),
      priceSummary: row.priceSummary == null ? null : String(row.priceSummary),
      providerName: String(row.providerName),
      providerDomain: String(row.providerDomain),
      docsUrl: String(row.docsUrl),
      signupUrl: row.signupUrl == null ? null : String(row.signupUrl),
      pricingUrl: row.pricingUrl == null ? null : String(row.pricingUrl),
      statusUrl: row.statusUrl == null ? null : String(row.statusUrl),
      termsUrl: String(row.termsUrl),
      privacyUrl: String(row.privacyUrl),
      regions: parseList(row.regionsJson),
      capabilities: parseList(row.capabilitiesJson),
      requirements: parseList(row.requirementsJson),
      reviewNote: row.reviewNote == null ? null : String(row.reviewNote),
      reviewedBy: row.reviewedBy == null ? null : String(row.reviewedBy),
      publishedAt: row.publishedAt == null ? null : String(row.publishedAt),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  function where(filter: { statuses: EditorialStatus[]; category?: string; listingType?: string; query?: string }) {
    const clauses = [`status IN (${filter.statuses.map(() => "?").join(", ")})`];
    const params: Array<string> = [...filter.statuses];
    if (filter.category) {
      clauses.push("category = ?");
      params.push(filter.category);
    }
    if (filter.listingType) {
      clauses.push("listing_type = ?");
      params.push(filter.listingType);
    }
    if (filter.query) {
      const like = `%${filter.query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      clauses.push("(name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR provider_name LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    return { sql: clauses.join(" AND "), params };
  }

  return {
    getListing(id) {
      const row = db.prepare(`SELECT ${listingColumns} FROM marketplace_listings WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      return row ? mapListing(row) : undefined;
    },
    getListingBySlug(slug) {
      const row = db.prepare(`SELECT ${listingColumns} FROM marketplace_listings WHERE slug = ?`).get(slug) as Record<string, unknown> | undefined;
      return row ? mapListing(row) : undefined;
    },
    insertListing(input) {
      db.prepare(
        `INSERT INTO marketplace_listings (
          id, slug, publisher_id, name, summary, description_md, category, tags_json, listing_type, status,
          pricing_model, currency, price_summary, provider_name, provider_domain, docs_url, signup_url, pricing_url,
          status_url, terms_url, privacy_url, regions_json, capabilities_json, requirements_json, review_note,
          reviewed_by, published_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      ).run(
        input.id, input.slug, input.publisherId ?? null, input.name, input.summary, input.descriptionMd, input.category, JSON.stringify(input.tags),
        input.listingType, input.pricingModel, input.currency, input.priceSummary, input.providerName, input.providerDomain,
        input.docsUrl, input.signupUrl, input.pricingUrl, input.statusUrl, input.termsUrl, input.privacyUrl,
        JSON.stringify(input.regions), JSON.stringify(input.capabilities), JSON.stringify(input.requirements),
        input.createdAt, input.createdAt,
      );
      const saved = this.getListing(input.id);
      if (!saved) throw new Error("listing insert failed");
      return saved;
    },
    updateListing(id, patch) {
      const current = this.getListing(id);
      if (!current) return;
      const next = { ...current, ...patch };
      db.prepare(
        `UPDATE marketplace_listings SET
          name = ?, summary = ?, description_md = ?, category = ?, tags_json = ?, listing_type = ?, status = ?,
          pricing_model = ?, currency = ?, price_summary = ?, provider_name = ?, provider_domain = ?, docs_url = ?,
          signup_url = ?, pricing_url = ?, status_url = ?, terms_url = ?, privacy_url = ?, regions_json = ?,
          capabilities_json = ?, requirements_json = ?, review_note = ?, reviewed_by = ?, published_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        next.name, next.summary, next.descriptionMd, next.category, JSON.stringify(next.tags), next.listingType, next.status,
        next.pricingModel, next.currency, next.priceSummary, next.providerName, next.providerDomain, next.docsUrl,
        next.signupUrl, next.pricingUrl, next.statusUrl, next.termsUrl, next.privacyUrl, JSON.stringify(next.regions),
        JSON.stringify(next.capabilities), JSON.stringify(next.requirements), next.reviewNote, next.reviewedBy, next.publishedAt,
        patch.updatedAt, id,
      );
    },
    listListings(filter) {
      const built = where(filter);
      const rows = db.prepare(
        `SELECT ${listingColumns} FROM marketplace_listings WHERE ${built.sql} ORDER BY name LIMIT ? OFFSET ?`,
      ).all(...built.params, filter.limit, filter.offset) as Array<Record<string, unknown>>;
      return rows.map(mapListing);
    },
    countListings(filter) {
      const built = where(filter);
      const row = db.prepare(`SELECT COUNT(*) as count FROM marketplace_listings WHERE ${built.sql}`).get(...built.params) as { count: number };
      return Number(row.count);
    },
    replaceLinks(listingId, links) {
      const write = db.transaction(() => {
        db.prepare(`DELETE FROM listing_links WHERE listing_id = ?`).run(listingId);
        const insert = db.prepare(
          `INSERT INTO listing_links (id, listing_id, label, url, kind, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const link of links) {
          insert.run(link.id, listingId, link.label, link.url, link.kind, link.sortOrder, link.enabled ? 1 : 0);
        }
      });
      write();
    },
    listLinks(listingId) {
      const rows = db.prepare(
        `SELECT id, listing_id as listingId, label, url, kind, sort_order as sortOrder, enabled
         FROM listing_links WHERE listing_id = ? ORDER BY sort_order`,
      ).all(listingId) as Array<Record<string, unknown>>;
      return rows.map(mapLink);
    },
    getLink(listingId, linkId) {
      const row = db.prepare(
        `SELECT id, listing_id as listingId, label, url, kind, sort_order as sortOrder, enabled
         FROM listing_links WHERE listing_id = ? AND id = ?`,
      ).get(listingId, linkId) as Record<string, unknown> | undefined;
      return row ? mapLink(row) : undefined;
    },
    insertEvent(input) {
      db.prepare(
        `INSERT INTO listing_events (listing_id, event_type, occurred_at, coarse_referrer, visitor_key_hash) VALUES (?, ?, ?, ?, NULL)`,
      ).run(input.listingId, input.eventType, input.occurredAt, input.coarseReferrer);
    },
    countEvents(listingId, eventType) {
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM listing_events WHERE listing_id = ? AND event_type = ?`,
      ).get(listingId, eventType) as { count: number };
      return Number(row.count);
    },
    insertReview(input) {
      db.prepare(
        `INSERT INTO listing_reviews (id, listing_id, reviewer_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.listingId, input.reviewerId, input.decision, input.note, input.createdAt);
    },
    listReviews(listingId) {
      const rows = db.prepare(
        `SELECT id, listing_id as listingId, reviewer_id as reviewerId, decision, note, created_at as createdAt
         FROM listing_reviews WHERE listing_id = ? ORDER BY created_at`,
      ).all(listingId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        listingId: String(row.listingId),
        reviewerId: String(row.reviewerId),
        decision: row.decision as ReviewDecision,
        note: String(row.note),
        createdAt: String(row.createdAt),
      }));
    },
    listOwnedListings(publisherId) {
      const rows = db.prepare(
        `SELECT ${listingColumns} FROM marketplace_listings WHERE publisher_id = ? ORDER BY name`,
      ).all(publisherId) as Array<Record<string, unknown>>;
      return rows.map(mapListing);
    },
    listGuideIdsByPublisher(publisherId) {
      const rows = db.prepare(
        `SELECT g.id as id FROM listing_guides g
         INNER JOIN marketplace_listings l ON l.id = g.listing_id
         WHERE l.publisher_id = ?`,
      ).all(publisherId) as Array<{ id: string }>;
      return rows.map((row) => String(row.id));
    },
    latestReviewAt(listingId) {
      const row = db.prepare(
        `SELECT created_at as createdAt FROM listing_reviews WHERE listing_id = ? ORDER BY created_at DESC LIMIT 1`,
      ).get(listingId) as { createdAt: string } | undefined;
      return row?.createdAt ?? null;
    },
    insertGuide(input) {
      db.prepare(
        `INSERT INTO listing_guides (
          id, listing_id, slug, title, summary, body_md, prerequisites, difficulty, published, verified_at, verified_by, created_at, updated_at,
          kind, locale, purpose, setup_url, min_permissions, credential_location, local_test_md, production_md, security_notes, cost_notes,
          common_errors_md, cleanup_md, docs_url, tested_version, test_environment, compatibility_notes, example_text, success_md, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id, input.listingId, input.slug, input.title, input.summary, input.bodyMd, input.prerequisites,
        input.difficulty, input.published ? 1 : 0, input.verifiedAt, input.verifiedBy, input.createdAt, input.updatedAt,
        input.kind, input.locale, input.purpose, input.setupUrl, input.minPermissions, input.credentialLocation,
        input.localTestMd, input.productionMd, input.securityNotes, input.costNotes, input.commonErrorsMd, input.cleanupMd,
        input.docsUrl, input.testedVersion, input.testEnvironment, input.compatibilityNotes, input.exampleText, input.successMd, input.revision,
      );
    },
    updateGuide(id, patch) {
      const current = this.getGuide(id);
      if (!current) return;
      const next = { ...current, ...patch };
      db.prepare(
        `UPDATE listing_guides SET
          title = ?, summary = ?, body_md = ?, prerequisites = ?, difficulty = ?, published = ?, verified_at = ?, verified_by = ?, updated_at = ?,
          kind = ?, locale = ?, purpose = ?, setup_url = ?, min_permissions = ?, credential_location = ?, local_test_md = ?, production_md = ?,
          security_notes = ?, cost_notes = ?, common_errors_md = ?, cleanup_md = ?, docs_url = ?, tested_version = ?, test_environment = ?,
          compatibility_notes = ?, example_text = ?, success_md = ?, revision = ?
         WHERE id = ?`,
      ).run(
        next.title, next.summary, next.bodyMd, next.prerequisites, next.difficulty, next.published ? 1 : 0, next.verifiedAt, next.verifiedBy, patch.updatedAt,
        next.kind, next.locale, next.purpose, next.setupUrl, next.minPermissions, next.credentialLocation, next.localTestMd, next.productionMd,
        next.securityNotes, next.costNotes, next.commonErrorsMd, next.cleanupMd, next.docsUrl, next.testedVersion, next.testEnvironment,
        next.compatibilityNotes, next.exampleText, next.successMd, next.revision, id,
      );
    },
    getGuide(id) {
      const row = db.prepare(`SELECT ${guideColumns} FROM listing_guides WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      return row ? mapGuide(row) : undefined;
    },
    getGuideBySlug(slug) {
      const row = db.prepare(`SELECT ${guideColumns} FROM listing_guides WHERE slug = ?`).get(slug) as Record<string, unknown> | undefined;
      return row ? mapGuide(row) : undefined;
    },
    listGuides(listingId, publishedOnly) {
      const rows = db.prepare(
        `SELECT ${guideColumns} FROM listing_guides WHERE listing_id = ? ${publishedOnly ? "AND published = 1 AND verified_at IS NOT NULL" : ""} ORDER BY title`,
      ).all(listingId) as Array<Record<string, unknown>>;
      return rows.map(mapGuide);
    },
    listPublishedGuides() {
      const rows = db.prepare(
        `SELECT ${guideColumns} FROM listing_guides WHERE published = 1 AND verified_at IS NOT NULL ORDER BY title`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map(mapGuide);
    },
    insertRevision(input) {
      db.prepare(
        `INSERT INTO guide_revisions (id, guide_id, version, note, author, verified_at, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.guideId, input.version, input.note, input.author, input.verifiedAt, input.snapshotJson, input.createdAt);
    },
    markRevisionVerified(id, verifiedAt) {
      db.prepare(`UPDATE guide_revisions SET verified_at = ? WHERE id = ?`).run(verifiedAt, id);
    },
    listRevisions(guideId) {
      const rows = db.prepare(
        `SELECT id, guide_id as guideId, version, note, author, verified_at as verifiedAt, snapshot_json as snapshotJson, created_at as createdAt
         FROM guide_revisions WHERE guide_id = ? ORDER BY version`,
      ).all(guideId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        guideId: String(row.guideId),
        version: Number(row.version),
        note: String(row.note),
        author: String(row.author),
        verifiedAt: row.verifiedAt == null ? null : String(row.verifiedAt),
        snapshotJson: String(row.snapshotJson),
        createdAt: String(row.createdAt),
      }));
    },
    insertGuideReport(input) {
      db.prepare(
        `INSERT INTO guide_reports (id, guide_id, kind, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.guideId, input.kind, input.note, input.status, input.createdAt);
    },
    listOpenGuideReports() {
      const rows = db.prepare(
        `SELECT id, guide_id as guideId, kind, note, status, created_at as createdAt
         FROM guide_reports WHERE status = 'open' ORDER BY created_at`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        guideId: String(row.guideId),
        kind: String(row.kind),
        note: String(row.note),
        status: String(row.status),
        createdAt: String(row.createdAt),
      }));
    },
    resolveGuideReports(guideId) {
      db.prepare(`UPDATE guide_reports SET status = 'resolved' WHERE guide_id = ? AND status = 'open'`).run(guideId);
    },
    insertReport(input) {
      db.prepare(
        `INSERT INTO listing_reports (id, listing_id, kind, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.listingId, input.kind, input.note, input.status, input.createdAt);
    },
    listOpenReports() {
      const rows = db.prepare(
        `SELECT id, listing_id as listingId, kind, note, status, created_at as createdAt
         FROM listing_reports WHERE status = 'open' ORDER BY created_at`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map(mapReport);
    },
    dismissReport(id) {
      db.prepare(`UPDATE listing_reports SET status = 'dismissed' WHERE id = ?`).run(id);
    },
    listEvents(listingId) {
      const rows = db.prepare(
        `SELECT event_type as eventType, coarse_referrer as coarseReferrer FROM listing_events WHERE listing_id = ? ORDER BY id`,
      ).all(listingId) as Array<{ eventType: string; coarseReferrer: string | null }>;
      return rows.map((row) => ({ eventType: String(row.eventType), coarseReferrer: row.coarseReferrer == null ? null : String(row.coarseReferrer) }));
    },
  };
}

function mapLink(row: Record<string, unknown>): ListingLinkRecord {
  return {
    id: String(row.id),
    listingId: String(row.listingId),
    label: String(row.label),
    url: String(row.url),
    kind: row.kind as LinkKind,
    sortOrder: Number(row.sortOrder),
    enabled: Boolean(Number(row.enabled)),
  };
}

function mapGuide(row: Record<string, unknown>): GuideRecord {
  const difficulty = row.difficulty === "intermediate" || row.difficulty === "advanced" ? row.difficulty : "beginner";
  const kind = row.kind === "quickstart" || row.kind === "tutorial" || row.kind === "troubleshooting" || row.kind === "glossary" ? row.kind : "setup";
  return {
    id: String(row.id),
    listingId: row.listingId == null ? null : String(row.listingId),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    bodyMd: String(row.bodyMd),
    prerequisites: String(row.prerequisites ?? ""),
    difficulty,
    published: Boolean(Number(row.published)),
    verifiedAt: row.verifiedAt == null ? null : String(row.verifiedAt),
    verifiedBy: row.verifiedBy == null ? null : String(row.verifiedBy),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    kind,
    locale: row.locale == null ? "en" : String(row.locale),
    purpose: String(row.purpose ?? ""),
    setupUrl: row.setupUrl == null ? null : String(row.setupUrl),
    minPermissions: String(row.minPermissions ?? ""),
    credentialLocation: String(row.credentialLocation ?? ""),
    localTestMd: String(row.localTestMd ?? ""),
    productionMd: String(row.productionMd ?? ""),
    securityNotes: String(row.securityNotes ?? ""),
    costNotes: String(row.costNotes ?? ""),
    commonErrorsMd: String(row.commonErrorsMd ?? ""),
    cleanupMd: String(row.cleanupMd ?? ""),
    docsUrl: row.docsUrl == null ? null : String(row.docsUrl),
    testedVersion: String(row.testedVersion ?? ""),
    testEnvironment: String(row.testEnvironment ?? ""),
    compatibilityNotes: String(row.compatibilityNotes ?? ""),
    exampleText: String(row.exampleText ?? ""),
    successMd: String(row.successMd ?? ""),
    revision: Number(row.revision ?? 1),
  };
}

function mapReport(row: Record<string, unknown>): ReportRecord {
  return {
    id: String(row.id),
    listingId: String(row.listingId),
    kind: String(row.kind),
    note: String(row.note),
    status: String(row.status),
    createdAt: String(row.createdAt),
  };
}

function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
