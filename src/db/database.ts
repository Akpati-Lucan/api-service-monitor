import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "../utils/logger.js";
import type { Service, HealthCheck, Incident } from "../types/index.js";

export interface DatabaseConfig {
  dbPath: string;
  logger?: Logger;
}

export interface DatabaseApi {
  initialize(): void;
  close(): void;
  listServices(): Service[];
  getService(id: string): Service | undefined;
  createService(input: {
    name: string;
    url: string;
    intervalSeconds: number;
    timeoutMs: number;
    failureThreshold: number;
    isActive?: boolean;
  }): Service;
  deactivateService(id: string): void;
  deleteService(id: string): void;
  insertHealthCheck(input: {
    serviceId: string;
    status: "UP" | "DOWN";
    httpStatus?: number | null;
    responseTimeMs?: number | null;
    error?: string | null;
    checkedAt?: string;
  }): HealthCheck;
  getRecentHealthChecks(serviceId: string, limit?: number): HealthCheck[];
  getOpenIncident(serviceId: string): Incident | undefined;
  openIncident(input: {
    serviceId: string;
    reason: string;
    startedAt?: string;
  }): Incident;
  resolveIncident(id: string, resolvedAt?: string): void;
  listIncidents(serviceId: string): Incident[];
  ping(): boolean;
}

export function createDatabase({ dbPath, logger }: DatabaseConfig): DatabaseApi {
  const directory = path.dirname(dbPath);
  mkdirSync(directory, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  logger?.info({ dbPath }, "database initialized");

  function initialize(): void {
    db.exec(`
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
    `);
  }

  function close(): void {
    db.close();
  }

  function listServices(): Service[] {
    const rows = db.prepare(
      `SELECT id, name, url, interval_seconds as intervalSeconds, timeout_ms as timeoutMs, failure_threshold as failureThreshold, created_at as createdAt, is_active as isActive
       FROM services WHERE is_active = 1 ORDER BY created_at DESC`,
    ).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      url: String(row.url),
      intervalSeconds: Number(row.intervalSeconds),
      timeoutMs: Number(row.timeoutMs),
      failureThreshold: Number(row.failureThreshold),
      createdAt: String(row.createdAt),
      isActive: Boolean(Number(row.isActive)),
    }));
  }

  function getService(id: string): Service | undefined {
    const row = db.prepare(
      `SELECT id, name, url, interval_seconds as intervalSeconds, timeout_ms as timeoutMs, failure_threshold as failureThreshold, created_at as createdAt, is_active as isActive
       FROM services WHERE id = ? AND is_active = 1`,
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: String(row.id),
      name: String(row.name),
      url: String(row.url),
      intervalSeconds: Number(row.intervalSeconds),
      timeoutMs: Number(row.timeoutMs),
      failureThreshold: Number(row.failureThreshold),
      createdAt: String(row.createdAt),
      isActive: Boolean(Number(row.isActive)),
    };
  }

  function createService(input: {
    name: string;
    url: string;
    intervalSeconds: number;
    timeoutMs: number;
    failureThreshold: number;
    isActive?: boolean;
  }): Service {
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO services (id, name, url, interval_seconds, timeout_ms, failure_threshold, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.url,
      input.intervalSeconds,
      input.timeoutMs,
      input.failureThreshold,
      now,
      input.isActive === undefined ? 1 : Number(input.isActive),
    );

    return {
      id,
      name: input.name,
      url: input.url,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      failureThreshold: input.failureThreshold,
      createdAt: now,
      isActive: input.isActive === undefined ? true : input.isActive,
    };
  }

  function deactivateService(id: string): void {
    db.prepare(`UPDATE services SET is_active = 0 WHERE id = ?`).run(id);
  }

  function deleteService(id: string): void {
    db.prepare(`DELETE FROM services WHERE id = ?`).run(id);
  }

  function insertHealthCheck(input: {
    serviceId: string;
    status: "UP" | "DOWN";
    httpStatus?: number | null;
    responseTimeMs?: number | null;
    error?: string | null;
    checkedAt?: string;
  }): HealthCheck {
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO health_checks (service_id, status, http_status, response_time_ms, error, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.serviceId,
      input.status,
      input.httpStatus ?? null,
      input.responseTimeMs ?? null,
      input.error ?? null,
      checkedAt,
    );

    const row = db.prepare(`SELECT * FROM health_checks WHERE id = ?`).get(result.lastInsertRowid) as Record<string, unknown>;

    return {
      id: Number(row.id),
      serviceId: String(row.service_id),
      status: String(row.status) as "UP" | "DOWN",
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      responseTimeMs: row.response_time_ms == null ? null : Number(row.response_time_ms),
      error: row.error == null ? null : String(row.error),
      checkedAt: String(row.checked_at),
    };
  }

  function getRecentHealthChecks(serviceId: string, limit = 10): HealthCheck[] {
    const rows = db.prepare(
      `SELECT * FROM health_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT ?`,
    ).all(serviceId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      serviceId: String(row.service_id),
      status: String(row.status) as "UP" | "DOWN",
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      responseTimeMs: row.response_time_ms == null ? null : Number(row.response_time_ms),
      error: row.error == null ? null : String(row.error),
      checkedAt: String(row.checked_at),
    }));
  }

  function getOpenIncident(serviceId: string): Incident | undefined {
    const row = db.prepare(
      `SELECT * FROM incidents WHERE service_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    ).get(serviceId) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: String(row.id),
      serviceId: String(row.service_id),
      startedAt: String(row.started_at),
      resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
      reason: String(row.reason),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    };
  }

  function openIncident(input: { serviceId: string; reason: string; startedAt?: string }): Incident {
    const id = randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();

    db.prepare(
      `INSERT INTO incidents (id, service_id, started_at, resolved_at, reason, duration_seconds)
       VALUES (?, ?, ?, NULL, ?, NULL)`,
    ).run(id, input.serviceId, startedAt, input.reason);

    return {
      id,
      serviceId: input.serviceId,
      startedAt,
      resolvedAt: null,
      reason: input.reason,
      durationSeconds: null,
    };
  }

  function resolveIncident(id: string, resolvedAt = new Date().toISOString()): void {
    const row = db.prepare(`SELECT started_at FROM incidents WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return;
    }

    const startedAt = new Date(String(row.started_at)).getTime();
    const resolvedTime = new Date(resolvedAt).getTime();
    const durationSeconds = Math.max(0, Math.round((resolvedTime - startedAt) / 1000));

    db.prepare(
      `UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?`,
    ).run(resolvedAt, durationSeconds, id);
  }

  function listIncidents(serviceId: string): Incident[] {
    const rows = db.prepare(
      `SELECT * FROM incidents WHERE service_id = ? ORDER BY started_at DESC`,
    ).all(serviceId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      serviceId: String(row.service_id),
      startedAt: String(row.started_at),
      resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
      reason: String(row.reason),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    }));
  }

  function ping(): boolean {
    try {
      const result = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
      return result?.ok === 1;
    } catch {
      return false;
    }
  }

  return {
    initialize,
    close,
    listServices,
    getService,
    createService,
    deactivateService,
    deleteService,
    insertHealthCheck,
    getRecentHealthChecks,
    getOpenIncident,
    openIncident,
    resolveIncident,
    listIncidents,
    ping,
  };
}

export function initializeDatabase(db: DatabaseApi): void {
  db.initialize();
}
