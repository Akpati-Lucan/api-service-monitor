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
        'acknowledgements', 'heartbeats', 'check_rollups'
      )`,
    ).all() as Array<{ name: string }>;
    upgraded.close();

    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect(group).toEqual({ name: "Default", slug: "default" });
    expect(tables).toHaveLength(12);
  });
});
