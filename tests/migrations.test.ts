import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { version1SchemaSql } from "../src/db/migrations.js";

describe("migrations", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("upgrades a version-1 database and can run twice", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-migrate-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "legacy.db");

    const legacy = new Database(dbPath);
    legacy.exec(version1SchemaSql);
    legacy.prepare(
      `INSERT INTO services (id, name, url, interval_seconds, timeout_ms, failure_threshold, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run("svc_old", "Legacy API", "https://legacy.example/health", 30, 5000, 3, "2020-01-01T00:00:00.000Z");
    legacy.close();

    const db = createDatabase({ dbPath });
    initializeDatabase(db);
    initializeDatabase(db);

    expect(db.getService("svc_old")).toMatchObject({
      id: "svc_old",
      name: "Legacy API",
      kind: "http",
      role: "owned",
      groupId: "grp_default",
      address: "https://legacy.example/health",
      successThreshold: 1,
      paused: false,
    });

    db.close();

    const upgraded = new Database(dbPath, { readonly: true });
    const versions = upgraded.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as Array<{ version: number }>;
    const group = upgraded.prepare(`SELECT name, slug FROM groups WHERE id = ?`).get("grp_default") as { name: string; slug: string };
    const tables = upgraded.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'groups', 'maintenance_windows', 'api_keys', 'alert_routes', 'alert_deliveries',
        'status_pages', 'status_components', 'incident_updates', 'subscribers',
        'acknowledgements', 'heartbeats', 'check_rollups',
        'marketplace_listings', 'listing_links', 'listing_events', 'listing_guides', 'listing_reviews', 'listing_reports',
        'guide_revisions', 'guide_reports',
        'users', 'web_sessions', 'email_tokens', 'organizations', 'organization_members', 'organization_invitations',
        'publisher_profiles', 'domain_verifications', 'listing_appeals', 'publisher_notifications', 'admin_audit_log',
        'marketplace_offers', 'payment_accounts', 'marketplace_subscriptions', 'payment_events', 'marketplace_invoices',
        'external_provider_notes', 'billing_preferences',
        'checkout_attempts', 'billing_ledger', 'commerce_restrictions'
      )`,
    ).all() as Array<{ name: string }>;
    upgraded.close();

    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(group).toEqual({ name: "Default", slug: "default" });
    expect(tables).toHaveLength(41);
  });
});
