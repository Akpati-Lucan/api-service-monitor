import type { DatabaseApi } from "./database.js";

export const schemaSql = `
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

export function runMigrations(db: DatabaseApi): void {
  db.initialize();
}
