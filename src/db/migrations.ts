import type Database from "better-sqlite3";

export const DEFAULT_GROUP_ID = "grp_default";

/**
 * Schema that shipped before versioned migrations. Kept so an existing
 * database file can be adopted as version 1 and then upgraded in place.
 */
export const version1SchemaSql = `
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL,
    timeout_ms INTEGER NOT NULL,
    failure_threshold INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    response_time_ms INTEGER,
    error TEXT,
    checked_at TEXT NOT NULL,
    FOREIGN KEY(service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    resolved_at TEXT,
    reason TEXT NOT NULL,
    duration_seconds INTEGER,
    FOREIGN KEY(service_id) REFERENCES services(id)
  );

  CREATE INDEX IF NOT EXISTS idx_health_checks_service_checked_at
    ON health_checks(service_id, checked_at);

  CREATE INDEX IF NOT EXISTS idx_incidents_service_resolved_at
    ON incidents(service_id, resolved_at);
`;

const version2SchemaSql = `
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  INSERT INTO groups (id, name, slug, created_at)
  SELECT '${DEFAULT_GROUP_ID}', 'Default', 'default', '1970-01-01T00:00:00.000Z'
  WHERE NOT EXISTS (SELECT 1 FROM groups WHERE id = '${DEFAULT_GROUP_ID}');

  ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'http';
  ALTER TABLE services ADD COLUMN role TEXT NOT NULL DEFAULT 'owned';
  ALTER TABLE services ADD COLUMN group_id TEXT;
  ALTER TABLE services ADD COLUMN secret_ref TEXT;
  ALTER TABLE services ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE services ADD COLUMN latency_budget_ms INTEGER;
  ALTER TABLE services ADD COLUMN success_threshold INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE services ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE services ADD COLUMN address TEXT;

  UPDATE services SET group_id = '${DEFAULT_GROUP_ID}' WHERE group_id IS NULL;
  UPDATE services SET address = url WHERE address IS NULL;

  ALTER TABLE health_checks ADD COLUMN error_class TEXT;
  ALTER TABLE health_checks ADD COLUMN evidence_json TEXT;
  ALTER TABLE health_checks ADD COLUMN region TEXT;

  ALTER TABLE incidents ADD COLUMN error_class TEXT;
  ALTER TABLE incidents ADD COLUMN update_state TEXT NOT NULL DEFAULT 'investigating';

  CREATE TABLE IF NOT EXISTS maintenance_windows (
    id TEXT PRIMARY KEY,
    group_id TEXT,
    service_id TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL,
    scope TEXT NOT NULL,
    group_id TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_routes (
    id TEXT PRIMARY KEY,
    group_id TEXT,
    kind TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    secret_ref TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS alert_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_pages (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_components (
    id TEXT PRIMARY KEY,
    status_page_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS incident_updates (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id TEXT PRIMARY KEY,
    status_page_id TEXT NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS acknowledgements (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    note TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS heartbeats (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    grace_seconds INTEGER NOT NULL,
    last_ping_at TEXT
  );

  CREATE TABLE IF NOT EXISTS check_rollups (
    hour TEXT NOT NULL,
    service_id TEXT NOT NULL,
    checks INTEGER NOT NULL,
    up_checks INTEGER NOT NULL,
    degraded_checks INTEGER NOT NULL,
    down_checks INTEGER NOT NULL,
    avg_response_time_ms INTEGER NOT NULL,
    PRIMARY KEY (service_id, hour)
  );

  CREATE INDEX IF NOT EXISTS idx_services_group_active
    ON services(group_id, is_active);
`;

const version3SchemaSql = `
  CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);
`;

const version4SchemaSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_heartbeats_token ON heartbeats(token_hash);
`;

const version5SchemaSql = `
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    publisher_id TEXT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description_md TEXT NOT NULL,
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    listing_type TEXT NOT NULL,
    status TEXT NOT NULL,
    pricing_model TEXT NOT NULL,
    currency TEXT NULL,
    price_summary TEXT NULL,
    provider_name TEXT NOT NULL,
    provider_domain TEXT NOT NULL,
    docs_url TEXT NOT NULL,
    signup_url TEXT NULL,
    pricing_url TEXT NULL,
    status_url TEXT NULL,
    terms_url TEXT NOT NULL,
    privacy_url TEXT NOT NULL,
    regions_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    requirements_json TEXT NOT NULL,
    review_note TEXT NULL,
    reviewed_by TEXT NULL,
    published_at TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_links (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    enabled INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_events (
    id INTEGER PRIMARY KEY,
    listing_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    coarse_referrer TEXT NULL,
    visitor_key_hash TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_guides (
    id TEXT PRIMARY KEY,
    listing_id TEXT NULL,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body_md TEXT NOT NULL,
    prerequisites TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    published INTEGER NOT NULL,
    verified_at TEXT NULL,
    verified_by TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_reviews (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_reports (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_listings_status_category ON marketplace_listings(status, category);
  CREATE INDEX IF NOT EXISTS idx_listing_links_listing ON listing_links(listing_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_listing_events_listing ON listing_events(listing_id, event_type);
  CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listing_reports(status, created_at);
`;

const steps: Array<{ version: number; sql: string }> = [
  { version: 1, sql: version1SchemaSql },
  { version: 2, sql: version2SchemaSql },
  { version: 3, sql: version3SchemaSql },
  { version: 4, sql: version4SchemaSql },
  { version: 5, sql: version5SchemaSql },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_migrations`).all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  for (const step of steps) {
    if (applied.has(step.version)) {
      continue;
    }

    const apply = db.transaction(() => {
      db.exec(step.sql);
      db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run(
        step.version,
        new Date().toISOString(),
      );
    });

    apply();
  }
}
