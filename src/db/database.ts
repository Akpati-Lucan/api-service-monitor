import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "../utils/logger.js";
import type {
  Acknowledgement,
  AlertRoute,
  AlertRouteKind,
  ApiKeyRecord,
  AuthScope,
  CheckRollup,
  CheckStatus,
  ErrorClass,
  Group,
  HealthCheck,
  Incident,
  IncidentUpdate,
  MaintenanceWindow,
  Service,
  ServiceRole,
  StatusComponent,
  StatusPage,
  StatusVisibility,
} from "../types/index.js";
import { DEFAULT_GROUP_ID, runMigrations } from "./migrations.js";

export interface DatabaseConfig {
  dbPath: string;
  logger?: Logger;
}

export interface CreateServiceRecord {
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  isActive?: boolean;
  kind?: string;
  role?: ServiceRole;
  groupId?: string | null;
  secretRef?: string | null;
  config?: Record<string, unknown>;
  latencyBudgetMs?: number | null;
  successThreshold?: number;
  paused?: boolean;
  address?: string;
}

export interface DatabaseApi {
  initialize(): void;
  close(): void;
  listServices(): Service[];
  getService(id: string): Service | undefined;
  createService(input: CreateServiceRecord): Service;
  deactivateService(id: string): void;
  deleteService(id: string): void;
  insertHealthCheck(input: {
    serviceId: string;
    status: CheckStatus;
    httpStatus?: number | null;
    responseTimeMs?: number | null;
    error?: string | null;
    errorClass?: ErrorClass | null;
    evidence?: Record<string, string | number | boolean> | null;
    region?: string | null;
    checkedAt?: string;
  }): HealthCheck;
  getRecentHealthChecks(serviceId: string, limit?: number): HealthCheck[];
  getOpenIncident(serviceId: string): Incident | undefined;
  openIncident(input: {
    serviceId: string;
    reason: string;
    startedAt?: string;
    errorClass?: ErrorClass | null;
  }): Incident;
  resolveIncident(id: string, resolvedAt?: string): void;
  listIncidents(serviceId: string): Incident[];
  getIncident(id: string): Incident | undefined;
  listOpenIncidents(groupId?: string): Array<Incident & {
    serviceName: string;
    groupId: string | null;
    groupName: string | null;
    role: ServiceRole;
  }>;
  listIncidentUpdates(incidentId: string): IncidentUpdate[];
  listAcknowledgements(incidentId: string): Acknowledgement[];
  getLatestHealthCheck(serviceId: string): HealthCheck | undefined;
  listHealthChecksSince(serviceId: string, sinceIso: string): HealthCheck[];
  listRollupsSince(serviceId: string, sinceIso: string): CheckRollup[];
  setServicePaused(id: string, paused: boolean): void;
  isMaintenanceActive(serviceId: string, groupId: string | null, nowIso: string): boolean;
  listGroups(): Group[];
  getGroup(id: string): Group | undefined;
  getGroupBySlug(slug: string): Group | undefined;
  createGroup(input: { name: string; slug: string }): Group;
  updateGroup(id: string, input: { name: string }): void;
  deleteGroup(id: string): void;
  countServicesInGroup(groupId: string): number;
  countActiveKeysInGroup(groupId: string): number;
  insertApiKey(input: { name: string; prefix: string; hash: string; scope: AuthScope; groupId: string | null }): ApiKeyRecord;
  listApiKeysByPrefix(prefix: string): ApiKeyRecord[];
  getApiKey(id: string): ApiKeyRecord | undefined;
  revokeApiKey(id: string): boolean;
  createStatusPage(input: { groupId: string; slug: string; title: string; visibility: StatusVisibility }): StatusPage;
  getStatusPage(id: string): StatusPage | undefined;
  getStatusPageBySlug(slug: string): StatusPage | undefined;
  addStatusComponent(input: { statusPageId: string; serviceId: string; displayName: string; sortOrder: number }): StatusComponent;
  listStatusComponents(statusPageId: string): StatusComponent[];
  findStatusComponent(statusPageId: string, serviceId: string): StatusComponent | undefined;
  listPublicSlugsForService(serviceId: string): string[];
  createAlertRoute(input: { groupId: string | null; kind: AlertRouteKind; config: Record<string, unknown>; secretRef: string | null; enabled?: boolean }): AlertRoute;
  listAlertRoutes(): AlertRoute[];
  listEnabledAlertRoutes(): AlertRoute[];
  getAlertRoute(id: string): AlertRoute | undefined;
  deleteAlertRoute(id: string): boolean;
  insertAlertDelivery(input: { routeId: string; incidentId: string; kind: "opened" | "resolved"; status: "sent" | "failed"; error?: string | null }): void;
  listAlertDeliveries(incidentId: string): Array<{ routeId: string; incidentId: string; kind: string; status: string; error: string | null }>;
  createMaintenanceWindow(input: { groupId: string | null; serviceId: string | null; startsAt: string; endsAt: string; note?: string | null }): MaintenanceWindow;
  listMaintenanceWindows(): MaintenanceWindow[];
  recordIncidentUpdate(input: { incidentId: string; state: string; message: string; createdAt?: string }): IncidentUpdate;
  insertHeartbeat(input: { serviceId: string; tokenHash: string; graceSeconds: number }): HeartbeatRow;
  getHeartbeat(serviceId: string): HeartbeatRow | undefined;
  getHeartbeatByHash(tokenHash: string): HeartbeatRow | undefined;
  touchHeartbeat(serviceId: string, lastPingAt: string): void;
  ping(): boolean;
}

export interface HeartbeatRow {
  id: string;
  serviceId: string;
  tokenHash: string;
  graceSeconds: number;
  lastPingAt: string | null;
}

const serviceSelect = `
  id,
  name,
  url,
  interval_seconds as intervalSeconds,
  timeout_ms as timeoutMs,
  failure_threshold as failureThreshold,
  created_at as createdAt,
  is_active as isActive,
  kind,
  role,
  group_id as groupId,
  secret_ref as secretRef,
  config_json as configJson,
  latency_budget_ms as latencyBudgetMs,
  success_threshold as successThreshold,
  paused,
  address
`;

function parseConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function parseEvidence(value: unknown): Record<string, string | number | boolean> | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const evidence: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        evidence[key] = item;
      }
    }
    return evidence;
  } catch {
    return null;
  }
}

function mapService(row: Record<string, unknown>): Service {
  return {
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    address: row.address == null || row.address === "" ? String(row.url) : String(row.address),
    kind: row.kind == null ? "http" : String(row.kind),
    role: row.role === "dependency" ? "dependency" : "owned",
    groupId: row.groupId == null ? null : String(row.groupId),
    secretRef: row.secretRef == null ? null : String(row.secretRef),
    config: parseConfig(row.configJson),
    latencyBudgetMs: row.latencyBudgetMs == null ? null : Number(row.latencyBudgetMs),
    successThreshold: row.successThreshold == null ? 1 : Number(row.successThreshold),
    paused: Boolean(Number(row.paused ?? 0)),
    intervalSeconds: Number(row.intervalSeconds),
    timeoutMs: Number(row.timeoutMs),
    failureThreshold: Number(row.failureThreshold),
    createdAt: String(row.createdAt),
    isActive: Boolean(Number(row.isActive)),
  };
}

function mapHealthCheck(row: Record<string, unknown>): HealthCheck {
  return {
    id: Number(row.id),
    serviceId: String(row.service_id),
    status: String(row.status) as CheckStatus,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    responseTimeMs: row.response_time_ms == null ? null : Number(row.response_time_ms),
    error: row.error == null ? null : String(row.error),
    errorClass: row.error_class == null ? null : (String(row.error_class) as ErrorClass),
    evidence: parseEvidence(row.evidence_json),
    region: row.region == null ? null : String(row.region),
    checkedAt: String(row.checked_at),
  };
}

function mapIncident(row: Record<string, unknown>): Incident {
  return {
    id: String(row.id),
    serviceId: String(row.service_id),
    startedAt: String(row.started_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
    reason: String(row.reason),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    errorClass: row.error_class == null ? null : (String(row.error_class) as ErrorClass),
    updateState: row.update_state == null ? null : String(row.update_state),
  };
}

export function createDatabase({ dbPath, logger }: DatabaseConfig): DatabaseApi {
  const directory = path.dirname(dbPath);
  mkdirSync(directory, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  logger?.info({ dbPath }, "database initialized");

  function initialize(): void {
    runMigrations(db);
  }

  function close(): void {
    db.close();
  }

  function listServices(): Service[] {
    const rows = db.prepare(
      `SELECT ${serviceSelect} FROM services WHERE is_active = 1 ORDER BY created_at DESC`,
    ).all() as Array<Record<string, unknown>>;

    return rows.map((row) => mapService(row));
  }

  function getService(id: string): Service | undefined {
    const row = db.prepare(
      `SELECT ${serviceSelect} FROM services WHERE id = ? AND is_active = 1`,
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return mapService(row);
  }

  function createService(input: CreateServiceRecord): Service {
    const now = new Date().toISOString();
    const id = randomUUID();
    const kind = input.kind ?? "http";
    const role = input.role ?? "owned";
    const groupId = input.groupId ?? DEFAULT_GROUP_ID;
    const address = input.address ?? input.url;
    const successThreshold = input.successThreshold ?? 1;
    const paused = input.paused ?? false;
    const isActive = input.isActive === undefined ? true : input.isActive;

    db.prepare(
      `INSERT INTO services (
        id, name, url, interval_seconds, timeout_ms, failure_threshold, created_at, is_active,
        kind, role, group_id, secret_ref, config_json, latency_budget_ms, success_threshold, paused, address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.url,
      input.intervalSeconds,
      input.timeoutMs,
      input.failureThreshold,
      now,
      Number(isActive),
      kind,
      role,
      groupId,
      input.secretRef ?? null,
      JSON.stringify(input.config ?? {}),
      input.latencyBudgetMs ?? null,
      successThreshold,
      Number(paused),
      address,
    );

    return {
      id,
      name: input.name,
      url: input.url,
      address,
      kind,
      role,
      groupId,
      secretRef: input.secretRef ?? null,
      config: input.config ?? {},
      latencyBudgetMs: input.latencyBudgetMs ?? null,
      successThreshold,
      paused,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      failureThreshold: input.failureThreshold,
      createdAt: now,
      isActive,
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
    status: CheckStatus;
    httpStatus?: number | null;
    responseTimeMs?: number | null;
    error?: string | null;
    errorClass?: ErrorClass | null;
    evidence?: Record<string, string | number | boolean> | null;
    region?: string | null;
    checkedAt?: string;
  }): HealthCheck {
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO health_checks (
        service_id, status, http_status, response_time_ms, error, checked_at, error_class, evidence_json, region
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.serviceId,
      input.status,
      input.httpStatus ?? null,
      input.responseTimeMs ?? null,
      input.error ?? null,
      checkedAt,
      input.errorClass ?? null,
      input.evidence ? JSON.stringify(input.evidence) : null,
      input.region ?? null,
    );

    const row = db.prepare(`SELECT * FROM health_checks WHERE id = ?`).get(result.lastInsertRowid) as Record<string, unknown>;
    return mapHealthCheck(row);
  }

  function getRecentHealthChecks(serviceId: string, limit = 10): HealthCheck[] {
    const rows = db.prepare(
      `SELECT * FROM health_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT ?`,
    ).all(serviceId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => mapHealthCheck(row));
  }

  function getOpenIncident(serviceId: string): Incident | undefined {
    const row = db.prepare(
      `SELECT * FROM incidents WHERE service_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    ).get(serviceId) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return mapIncident(row);
  }

  function insertIncidentUpdate(incidentId: string, state: string, message: string, createdAt: string): void {
    db.prepare(
      `INSERT INTO incident_updates (id, incident_id, state, message, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), incidentId, state, message, createdAt);
  }

  function openIncident(input: {
    serviceId: string;
    reason: string;
    startedAt?: string;
    errorClass?: ErrorClass | null;
  }): Incident {
    const existing = getOpenIncident(input.serviceId);
    if (existing) {
      return existing;
    }

    const id = randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();
    const reason = input.reason;

    const apply = db.transaction(() => {
      db.prepare(
        `INSERT INTO incidents (id, service_id, started_at, resolved_at, reason, duration_seconds, error_class, update_state)
         VALUES (?, ?, ?, NULL, ?, NULL, ?, 'investigating')`,
      ).run(id, input.serviceId, startedAt, reason, input.errorClass ?? null);
      insertIncidentUpdate(id, "investigating", `Automatic: ${reason}`, startedAt);
    });
    apply();

    return {
      id,
      serviceId: input.serviceId,
      startedAt,
      resolvedAt: null,
      reason,
      durationSeconds: null,
      errorClass: input.errorClass ?? null,
      updateState: "investigating",
    };
  }

  function resolveIncident(id: string, resolvedAt = new Date().toISOString()): void {
    const row = db.prepare(`SELECT started_at, resolved_at FROM incidents WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row || row.resolved_at != null) {
      return;
    }

    const startedAt = new Date(String(row.started_at)).getTime();
    const resolvedTime = new Date(resolvedAt).getTime();
    const durationSeconds = Math.max(0, Math.round((resolvedTime - startedAt) / 1000));

    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE incidents SET resolved_at = ?, duration_seconds = ?, update_state = 'resolved' WHERE id = ?`,
      ).run(resolvedAt, durationSeconds, id);
      insertIncidentUpdate(id, "resolved", "Automatic: recovered", resolvedAt);
    });
    apply();
  }

  function listIncidents(serviceId: string): Incident[] {
    const rows = db.prepare(
      `SELECT * FROM incidents WHERE service_id = ? ORDER BY started_at DESC`,
    ).all(serviceId) as Array<Record<string, unknown>>;

    return rows.map((row) => mapIncident(row));
  }

  function getIncident(id: string): Incident | undefined {
    const row = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? mapIncident(row) : undefined;
  }

  function listOpenIncidents(groupId?: string): Array<Incident & {
    serviceName: string;
    groupId: string | null;
    groupName: string | null;
    role: ServiceRole;
  }> {
    const rows = db.prepare(
      `SELECT i.*, s.name AS service_name, s.group_id AS service_group_id, s.role AS service_role, g.name AS group_name
       FROM incidents i
       JOIN services s ON s.id = i.service_id
       LEFT JOIN groups g ON g.id = s.group_id
       WHERE i.resolved_at IS NULL AND (? IS NULL OR s.group_id = ?)
       ORDER BY i.started_at DESC`,
    ).all(groupId ?? null, groupId ?? null) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...mapIncident(row),
      serviceName: String(row.service_name),
      groupId: row.service_group_id == null ? null : String(row.service_group_id),
      groupName: row.group_name == null ? null : String(row.group_name),
      role: row.service_role === "dependency" ? "dependency" : "owned",
    }));
  }

  function listIncidentUpdates(incidentId: string): IncidentUpdate[] {
    const rows = db.prepare(
      `SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at ASC`,
    ).all(incidentId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      incidentId: String(row.incident_id),
      state: String(row.state),
      message: String(row.message),
      createdAt: String(row.created_at),
    }));
  }

  function listAcknowledgements(incidentId: string): Acknowledgement[] {
    const rows = db.prepare(
      `SELECT * FROM acknowledgements WHERE incident_id = ? ORDER BY created_at ASC`,
    ).all(incidentId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      incidentId: String(row.incident_id),
      note: String(row.note),
      actor: String(row.actor),
      createdAt: String(row.created_at),
    }));
  }

  function getLatestHealthCheck(serviceId: string): HealthCheck | undefined {
    return getRecentHealthChecks(serviceId, 1)[0];
  }

  function listHealthChecksSince(serviceId: string, sinceIso: string): HealthCheck[] {
    const rows = db.prepare(
      `SELECT * FROM health_checks WHERE service_id = ? AND checked_at >= ? ORDER BY checked_at ASC`,
    ).all(serviceId, sinceIso) as Array<Record<string, unknown>>;
    return rows.map((row) => mapHealthCheck(row));
  }

  function listRollupsSince(serviceId: string, sinceIso: string): CheckRollup[] {
    const rows = db.prepare(
      `SELECT * FROM check_rollups WHERE service_id = ? AND hour >= ? ORDER BY hour ASC`,
    ).all(serviceId, sinceIso) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      hour: String(row.hour),
      serviceId: String(row.service_id),
      checks: Number(row.checks),
      upChecks: Number(row.up_checks),
      degradedChecks: Number(row.degraded_checks),
      downChecks: Number(row.down_checks),
      avgResponseTimeMs: Number(row.avg_response_time_ms),
    }));
  }

  function setServicePaused(id: string, paused: boolean): void {
    db.prepare(`UPDATE services SET paused = ? WHERE id = ?`).run(Number(paused), id);
  }

  function isMaintenanceActive(serviceId: string, groupId: string | null, nowIso: string): boolean {
    const row = db.prepare(
      `SELECT id FROM maintenance_windows
       WHERE starts_at <= ? AND ends_at > ?
         AND (service_id = ? OR (? IS NOT NULL AND group_id = ?))
       LIMIT 1`,
    ).get(nowIso, nowIso, serviceId, groupId, groupId) as { id: string } | undefined;
    return Boolean(row);
  }

  function listGroups(): Group[] {
    const rows = db.prepare(
      `SELECT id, name, slug, created_at as createdAt FROM groups ORDER BY name`,
    ).all() as Array<Record<string, unknown>>;
    return rows.map(mapGroup);
  }

  function getGroup(id: string): Group | undefined {
    const row = db.prepare(
      `SELECT id, name, slug, created_at as createdAt FROM groups WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapGroup(row) : undefined;
  }

  function getGroupBySlug(slug: string): Group | undefined {
    const row = db.prepare(
      `SELECT id, name, slug, created_at as createdAt FROM groups WHERE slug = ?`,
    ).get(slug) as Record<string, unknown> | undefined;
    return row ? mapGroup(row) : undefined;
  }

  function createGroup(input: { name: string; slug: string }): Group {
    const group: Group = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      createdAt: new Date().toISOString(),
    };
    db.prepare(`INSERT INTO groups (id, name, slug, created_at) VALUES (?, ?, ?, ?)`).run(
      group.id,
      group.name,
      group.slug,
      group.createdAt,
    );
    return group;
  }

  function updateGroup(id: string, input: { name: string }): void {
    db.prepare(`UPDATE groups SET name = ? WHERE id = ?`).run(input.name, id);
  }

  function deleteGroup(id: string): void {
    db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
  }

  function countServicesInGroup(groupId: string): number {
    const row = db.prepare(`SELECT COUNT(*) as n FROM services WHERE group_id = ?`).get(groupId) as { n: number };
    return Number(row.n);
  }

  function countActiveKeysInGroup(groupId: string): number {
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM api_keys WHERE group_id = ? AND revoked_at IS NULL`,
    ).get(groupId) as { n: number };
    return Number(row.n);
  }

  function insertApiKey(input: {
    name: string;
    prefix: string;
    hash: string;
    scope: AuthScope;
    groupId: string | null;
  }): ApiKeyRecord {
    const record: ApiKeyRecord = {
      id: randomUUID(),
      name: input.name,
      prefix: input.prefix,
      hash: input.hash,
      scope: input.scope,
      groupId: input.groupId,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    db.prepare(
      `INSERT INTO api_keys (id, name, prefix, hash, scope, group_id, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(record.id, record.name, record.prefix, record.hash, record.scope, record.groupId, record.createdAt);
    return record;
  }

  function listApiKeysByPrefix(prefix: string): ApiKeyRecord[] {
    const rows = db.prepare(
      `SELECT id, name, prefix, hash, scope, group_id as groupId, created_at as createdAt, revoked_at as revokedAt
       FROM api_keys WHERE prefix = ? AND revoked_at IS NULL`,
    ).all(prefix) as Array<Record<string, unknown>>;
    return rows.map(mapApiKey);
  }

  function getApiKey(id: string): ApiKeyRecord | undefined {
    const row = db.prepare(
      `SELECT id, name, prefix, hash, scope, group_id as groupId, created_at as createdAt, revoked_at as revokedAt
       FROM api_keys WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapApiKey(row) : undefined;
  }

  function revokeApiKey(id: string): boolean {
    const result = db.prepare(
      `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  function createStatusPage(input: { groupId: string; slug: string; title: string; visibility: StatusVisibility }): StatusPage {
    const page: StatusPage = {
      id: randomUUID(),
      groupId: input.groupId,
      slug: input.slug,
      title: input.title,
      visibility: input.visibility,
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO status_pages (id, group_id, slug, title, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(page.id, page.groupId, page.slug, page.title, page.visibility, page.createdAt);
    return page;
  }

  function getStatusPage(id: string): StatusPage | undefined {
    const row = db.prepare(
      `SELECT id, group_id as groupId, slug, title, visibility, created_at as createdAt FROM status_pages WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapStatusPage(row) : undefined;
  }

  function getStatusPageBySlug(slug: string): StatusPage | undefined {
    const row = db.prepare(
      `SELECT id, group_id as groupId, slug, title, visibility, created_at as createdAt FROM status_pages WHERE slug = ?`,
    ).get(slug) as Record<string, unknown> | undefined;
    return row ? mapStatusPage(row) : undefined;
  }

  function addStatusComponent(input: { statusPageId: string; serviceId: string; displayName: string; sortOrder: number }): StatusComponent {
    const component: StatusComponent = {
      id: randomUUID(),
      statusPageId: input.statusPageId,
      serviceId: input.serviceId,
      displayName: input.displayName,
      sortOrder: input.sortOrder,
    };
    db.prepare(
      `INSERT INTO status_components (id, status_page_id, service_id, display_name, sort_order) VALUES (?, ?, ?, ?, ?)`,
    ).run(component.id, component.statusPageId, component.serviceId, component.displayName, component.sortOrder);
    return component;
  }

  function listStatusComponents(statusPageId: string): StatusComponent[] {
    const rows = db.prepare(
      `SELECT id, status_page_id as statusPageId, service_id as serviceId, display_name as displayName, sort_order as sortOrder
       FROM status_components WHERE status_page_id = ? ORDER BY sort_order ASC, display_name ASC`,
    ).all(statusPageId) as Array<Record<string, unknown>>;
    return rows.map(mapStatusComponent);
  }

  function findStatusComponent(statusPageId: string, serviceId: string): StatusComponent | undefined {
    const row = db.prepare(
      `SELECT id, status_page_id as statusPageId, service_id as serviceId, display_name as displayName, sort_order as sortOrder
       FROM status_components WHERE status_page_id = ? AND service_id = ?`,
    ).get(statusPageId, serviceId) as Record<string, unknown> | undefined;
    return row ? mapStatusComponent(row) : undefined;
  }

  function listPublicSlugsForService(serviceId: string): string[] {
    const rows = db.prepare(
      `SELECT p.slug as slug FROM status_pages p
       JOIN status_components c ON c.status_page_id = p.id
       WHERE c.service_id = ? AND p.visibility = 'public'
       ORDER BY p.created_at ASC`,
    ).all(serviceId) as Array<{ slug: string }>;
    return rows.map((row) => row.slug);
  }

  function createAlertRoute(input: {
    groupId: string | null;
    kind: AlertRouteKind;
    config: Record<string, unknown>;
    secretRef: string | null;
    enabled?: boolean;
  }): AlertRoute {
    const route: AlertRoute = {
      id: randomUUID(),
      groupId: input.groupId,
      kind: input.kind,
      config: input.config,
      secretRef: input.secretRef,
      enabled: input.enabled ?? true,
    };
    db.prepare(
      `INSERT INTO alert_routes (id, group_id, kind, config_json, secret_ref, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(route.id, route.groupId, route.kind, JSON.stringify(route.config), route.secretRef, Number(route.enabled));
    return route;
  }

  function listAlertRoutes(): AlertRoute[] {
    return queryAlertRoutes(`SELECT id, group_id as groupId, kind, config_json as configJson, secret_ref as secretRef, enabled FROM alert_routes ORDER BY id`);
  }

  function listEnabledAlertRoutes(): AlertRoute[] {
    return queryAlertRoutes(
      `SELECT id, group_id as groupId, kind, config_json as configJson, secret_ref as secretRef, enabled FROM alert_routes WHERE enabled = 1 ORDER BY id`,
    );
  }

  function queryAlertRoutes(sql: string): AlertRoute[] {
    const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
    return rows.map(mapAlertRoute);
  }

  function getAlertRoute(id: string): AlertRoute | undefined {
    const row = db.prepare(
      `SELECT id, group_id as groupId, kind, config_json as configJson, secret_ref as secretRef, enabled FROM alert_routes WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapAlertRoute(row) : undefined;
  }

  function deleteAlertRoute(id: string): boolean {
    const result = db.prepare(`DELETE FROM alert_routes WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  function insertAlertDelivery(input: {
    routeId: string;
    incidentId: string;
    kind: "opened" | "resolved";
    status: "sent" | "failed";
    error?: string | null;
  }): void {
    db.prepare(
      `INSERT INTO alert_deliveries (route_id, incident_id, kind, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.routeId, input.incidentId, input.kind, input.status, input.error ?? null, new Date().toISOString());
  }

  function listAlertDeliveries(incidentId: string): Array<{ routeId: string; incidentId: string; kind: string; status: string; error: string | null }> {
    const rows = db.prepare(
      `SELECT route_id as routeId, incident_id as incidentId, kind, status, error FROM alert_deliveries WHERE incident_id = ? ORDER BY id ASC`,
    ).all(incidentId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      routeId: String(row.routeId),
      incidentId: String(row.incidentId),
      kind: String(row.kind),
      status: String(row.status),
      error: row.error == null ? null : String(row.error),
    }));
  }

  function createMaintenanceWindow(input: {
    groupId: string | null;
    serviceId: string | null;
    startsAt: string;
    endsAt: string;
    note?: string | null;
  }): MaintenanceWindow {
    const window: MaintenanceWindow = {
      id: randomUUID(),
      groupId: input.groupId,
      serviceId: input.serviceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note ?? null,
    };
    db.prepare(
      `INSERT INTO maintenance_windows (id, group_id, service_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(window.id, window.groupId, window.serviceId, window.startsAt, window.endsAt, window.note);
    return window;
  }

  function listMaintenanceWindows(): MaintenanceWindow[] {
    const rows = db.prepare(
      `SELECT id, group_id as groupId, service_id as serviceId, starts_at as startsAt, ends_at as endsAt, note
       FROM maintenance_windows ORDER BY starts_at ASC`,
    ).all() as Array<Record<string, unknown>>;
    return rows.map(mapMaintenanceWindow);
  }

  function recordIncidentUpdate(input: { incidentId: string; state: string; message: string; createdAt?: string }): IncidentUpdate {
    const update: IncidentUpdate = {
      id: randomUUID(),
      incidentId: input.incidentId,
      state: input.state,
      message: input.message,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const apply = db.transaction(() => {
      db.prepare(
        `INSERT INTO incident_updates (id, incident_id, state, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(update.id, update.incidentId, update.state, update.message, update.createdAt);
      db.prepare(`UPDATE incidents SET update_state = ? WHERE id = ?`).run(update.state, update.incidentId);
    });
    apply();
    return update;
  }

  function insertHeartbeat(input: { serviceId: string; tokenHash: string; graceSeconds: number }): HeartbeatRow {
    const row: HeartbeatRow = {
      id: randomUUID(),
      serviceId: input.serviceId,
      tokenHash: input.tokenHash,
      graceSeconds: input.graceSeconds,
      lastPingAt: null,
    };
    db.prepare(
      `INSERT INTO heartbeats (id, service_id, token_hash, grace_seconds, last_ping_at) VALUES (?, ?, ?, ?, NULL)`,
    ).run(row.id, row.serviceId, row.tokenHash, row.graceSeconds);
    return row;
  }

  function getHeartbeat(serviceId: string): HeartbeatRow | undefined {
    const row = db.prepare(
      `SELECT id, service_id as serviceId, token_hash as tokenHash, grace_seconds as graceSeconds, last_ping_at as lastPingAt
       FROM heartbeats WHERE service_id = ?`,
    ).get(serviceId) as Record<string, unknown> | undefined;
    return row ? mapHeartbeat(row) : undefined;
  }

  function getHeartbeatByHash(tokenHash: string): HeartbeatRow | undefined {
    const row = db.prepare(
      `SELECT id, service_id as serviceId, token_hash as tokenHash, grace_seconds as graceSeconds, last_ping_at as lastPingAt
       FROM heartbeats WHERE token_hash = ?`,
    ).get(tokenHash) as Record<string, unknown> | undefined;
    return row ? mapHeartbeat(row) : undefined;
  }

  function touchHeartbeat(serviceId: string, lastPingAt: string): void {
    db.prepare(`UPDATE heartbeats SET last_ping_at = ? WHERE service_id = ?`).run(lastPingAt, serviceId);
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
    getIncident,
    listOpenIncidents,
    listIncidentUpdates,
    listAcknowledgements,
    getLatestHealthCheck,
    listHealthChecksSince,
    listRollupsSince,
    setServicePaused,
    isMaintenanceActive,
    listGroups,
    getGroup,
    getGroupBySlug,
    createGroup,
    updateGroup,
    deleteGroup,
    countServicesInGroup,
    countActiveKeysInGroup,
    insertApiKey,
    listApiKeysByPrefix,
    getApiKey,
    revokeApiKey,
    createStatusPage,
    getStatusPage,
    getStatusPageBySlug,
    addStatusComponent,
    listStatusComponents,
    findStatusComponent,
    listPublicSlugsForService,
    createAlertRoute,
    listAlertRoutes,
    listEnabledAlertRoutes,
    getAlertRoute,
    deleteAlertRoute,
    insertAlertDelivery,
    listAlertDeliveries,
    createMaintenanceWindow,
    listMaintenanceWindows,
    recordIncidentUpdate,
    insertHeartbeat,
    getHeartbeat,
    getHeartbeatByHash,
    touchHeartbeat,
    ping,
  };
}

function mapHeartbeat(row: Record<string, unknown>): HeartbeatRow {
  return {
    id: String(row.id),
    serviceId: String(row.serviceId),
    tokenHash: String(row.tokenHash),
    graceSeconds: Number(row.graceSeconds),
    lastPingAt: row.lastPingAt == null ? null : String(row.lastPingAt),
  };
}

function mapGroup(row: Record<string, unknown>): Group {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: String(row.createdAt),
  };
}

function mapStatusPage(row: Record<string, unknown>): StatusPage {
  return {
    id: String(row.id),
    groupId: String(row.groupId),
    slug: String(row.slug),
    title: String(row.title),
    visibility: row.visibility === "private" ? "private" : "public",
    createdAt: String(row.createdAt),
  };
}

function mapStatusComponent(row: Record<string, unknown>): StatusComponent {
  return {
    id: String(row.id),
    statusPageId: String(row.statusPageId),
    serviceId: String(row.serviceId),
    displayName: String(row.displayName),
    sortOrder: Number(row.sortOrder),
  };
}

function mapAlertRoute(row: Record<string, unknown>): AlertRoute {
  const kind = row.kind === "webhook" || row.kind === "slack" || row.kind === "email" ? row.kind : "log";
  return {
    id: String(row.id),
    groupId: row.groupId == null ? null : String(row.groupId),
    kind,
    config: parseConfig(row.configJson),
    secretRef: row.secretRef == null ? null : String(row.secretRef),
    enabled: Boolean(Number(row.enabled)),
  };
}

function mapMaintenanceWindow(row: Record<string, unknown>): MaintenanceWindow {
  return {
    id: String(row.id),
    groupId: row.groupId == null ? null : String(row.groupId),
    serviceId: row.serviceId == null ? null : String(row.serviceId),
    startsAt: String(row.startsAt),
    endsAt: String(row.endsAt),
    note: row.note == null ? null : String(row.note),
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKeyRecord {
  const scope = row.scope === "write" || row.scope === "admin" ? row.scope : "read";
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    hash: String(row.hash),
    scope,
    groupId: row.groupId == null ? null : String(row.groupId),
    createdAt: String(row.createdAt),
    revokedAt: row.revokedAt == null ? null : String(row.revokedAt),
  };
}

export function initializeDatabase(db: DatabaseApi): void {
  db.initialize();
}
