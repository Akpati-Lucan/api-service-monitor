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

const version6SchemaSql = `
  ALTER TABLE listing_guides ADD COLUMN kind TEXT NOT NULL DEFAULT 'setup';
  ALTER TABLE listing_guides ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
  ALTER TABLE listing_guides ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN setup_url TEXT NULL;
  ALTER TABLE listing_guides ADD COLUMN min_permissions TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN credential_location TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN local_test_md TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN production_md TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN security_notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN cost_notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN common_errors_md TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN cleanup_md TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN docs_url TEXT NULL;
  ALTER TABLE listing_guides ADD COLUMN tested_version TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN test_environment TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN compatibility_notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN example_text TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN success_md TEXT NOT NULL DEFAULT '';
  ALTER TABLE listing_guides ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE IF NOT EXISTS guide_revisions (
    id TEXT PRIMARY KEY,
    guide_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    note TEXT NOT NULL,
    author TEXT NOT NULL,
    verified_at TEXT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (guide_id, version)
  );

  CREATE TABLE IF NOT EXISTS guide_reports (
    id TEXT PRIMARY KEY,
    guide_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_guide_reports_status ON guide_reports(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_guide_revisions_guide ON guide_revisions(guide_id, version);
`;

const version7SchemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email_verified_at TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS web_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS email_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS organization_members (
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS organization_invitations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publisher_profiles (
    organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
    legal_name TEXT NOT NULL,
    support_url TEXT NOT NULL,
    privacy_url TEXT NOT NULL,
    terms_url TEXT NOT NULL,
    regions_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS domain_verifications (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    domain TEXT NOT NULL,
    method TEXT NOT NULL,
    token TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT NULL,
    created_at TEXT NOT NULL,
    verified_at TEXT NULL,
    UNIQUE (organization_id, domain)
  );

  CREATE TABLE IF NOT EXISTS listing_appeals (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT NULL,
    decided_by TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS publisher_notifications (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    listing_id TEXT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    organization_id TEXT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON web_sessions(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_members_user ON organization_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_domains_status ON domain_verifications(status, created_at);
`;

const version8SchemaSql = `
  CREATE TABLE IF NOT EXISTS marketplace_offers (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
    publisher_id TEXT NOT NULL REFERENCES organizations(id),
    plan_name TEXT NOT NULL,
    billing_interval TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    provider_price_ref TEXT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_accounts (
    id TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES organizations(id),
    processor TEXT NOT NULL,
    processor_account_ref TEXT NOT NULL,
    onboarding_state TEXT NOT NULL,
    charges_enabled INTEGER NOT NULL,
    payouts_enabled INTEGER NOT NULL,
    requirements_state TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (processor, processor_account_ref)
  );

  CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    offer_id TEXT NOT NULL REFERENCES marketplace_offers(id),
    processor TEXT NOT NULL,
    processor_customer_ref TEXT NOT NULL,
    processor_subscription_ref TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,
    period_start TEXT NULL,
    period_end TEXT NULL,
    cancel_at_period_end INTEGER NOT NULL,
    canceled_at TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY,
    processor TEXT NOT NULL,
    processor_event_ref TEXT NOT NULL,
    event_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT NULL,
    processing_state TEXT NOT NULL,
    safe_error_code TEXT NULL,
    UNIQUE (processor, processor_event_ref)
  );

  CREATE TABLE IF NOT EXISTS marketplace_invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES marketplace_subscriptions(id),
    processor_invoice_ref TEXT NOT NULL UNIQUE,
    amount_due_minor INTEGER NOT NULL,
    amount_paid_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    state TEXT NOT NULL,
    hosted_invoice_url TEXT NULL,
    period_start TEXT NULL,
    period_end TEXT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS external_provider_notes (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    listing_id TEXT NULL REFERENCES marketplace_listings(id),
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS billing_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_opt_in INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_offers_publisher ON marketplace_offers(publisher_id, status);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON marketplace_subscriptions(organization_id, state);
  CREATE INDEX IF NOT EXISTS idx_payment_events_state ON payment_events(processing_state, received_at);
`;

const version9SchemaSql = `
  ALTER TABLE marketplace_subscriptions ADD COLUMN dispute_open INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE marketplace_invoices ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS checkout_attempts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    offer_id TEXT NOT NULL REFERENCES marketplace_offers(id),
    idempotency_key TEXT NOT NULL,
    country TEXT NOT NULL,
    hosted_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (organization_id, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS billing_ledger (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    publisher_id TEXT NOT NULL REFERENCES organizations(id),
    subscription_id TEXT NULL REFERENCES marketplace_subscriptions(id),
    processor TEXT NOT NULL,
    currency TEXT NOT NULL,
    gross_minor INTEGER NOT NULL,
    fee_minor INTEGER NOT NULL,
    tax_minor INTEGER NOT NULL,
    net_minor INTEGER NOT NULL,
    payout_status TEXT NOT NULL,
    kind TEXT NOT NULL,
    period TEXT NOT NULL,
    transfer_ref TEXT NULL,
    source_event_ref TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commerce_restrictions (
    publisher_id TEXT PRIMARY KEY REFERENCES organizations(id),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_org ON billing_ledger(organization_id, period);
  CREATE INDEX IF NOT EXISTS idx_ledger_publisher ON billing_ledger(publisher_id, period);
`;

const version10SchemaSql = `
  CREATE TABLE IF NOT EXISTS integration_connections (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    provider_id TEXT NOT NULL,
    status TEXT NOT NULL,
    status_reason TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '',
    key_version INTEGER NOT NULL DEFAULT 1,
    credential_iv TEXT NOT NULL DEFAULT '',
    credential_tag TEXT NOT NULL DEFAULT '',
    credential_ciphertext TEXT NOT NULL DEFAULT '',
    expires_at TEXT NULL,
    region TEXT NOT NULL,
    last_health_at TEXT NULL,
    last_health_status TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (organization_id, provider_id)
  );

  CREATE TABLE IF NOT EXISTS integration_grants (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES integration_connections(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    state_hash TEXT NOT NULL UNIQUE,
    challenge TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    verifier_iv TEXT NOT NULL,
    verifier_tag TEXT NOT NULL,
    verifier_ciphertext TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integration_usage (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES integration_connections(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_integration_usage_recent ON integration_usage(connection_id, occurred_at);
`;

const version11SchemaSql = `
  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (organization_id, name)
  );

  CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id),
    listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, listing_id)
  );

  CREATE TABLE IF NOT EXISTS listing_templates (
    listing_id TEXT PRIMARY KEY REFERENCES marketplace_listings(id),
    url_template TEXT NOT NULL,
    probe_kind TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS compatibility_reviews (
    listing_id TEXT PRIMARY KEY REFERENCES marketplace_listings(id),
    reviewed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listing_notices (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
    version_label TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_listing_notices_listing ON listing_notices(listing_id, created_at);
`;

const steps: Array<{ version: number; sql: string }> = [
  { version: 1, sql: version1SchemaSql },
  { version: 2, sql: version2SchemaSql },
  { version: 3, sql: version3SchemaSql },
  { version: 4, sql: version4SchemaSql },
  { version: 5, sql: version5SchemaSql },
  { version: 6, sql: version6SchemaSql },
  { version: 7, sql: version7SchemaSql },
  { version: 8, sql: version8SchemaSql },
  { version: 9, sql: version9SchemaSql },
  { version: 10, sql: version10SchemaSql },
  { version: 11, sql: version11SchemaSql },
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
