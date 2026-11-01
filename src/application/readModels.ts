import type { DatabaseApi } from "../db/database.js";
import type { Monitor } from "../services/monitor.js";
import type { Service, ServiceStatus } from "../types/index.js";
import { notFound } from "../utils/errors.js";

const SECRET_KEY = /secret|password|token|authorization|api[-_]?key/i;

export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    redacted[key] = SECRET_KEY.test(key) ? "[redacted]" : value;
  }
  return redacted;
}

export function serviceStatus(db: DatabaseApi, service: Service): ServiceStatus {
  return db.getLatestHealthCheck(service.id)?.status ?? "UNKNOWN";
}

export function listMonitorViews(db: DatabaseApi, filter?: { groupId?: string; kind?: string; status?: ServiceStatus }) {
  return db.listServices()
    .filter((service) => !filter?.groupId || service.groupId === filter.groupId)
    .filter((service) => !filter?.kind || service.kind === filter.kind)
    .map((service) => summarize(db, service))
    .filter((service) => !filter?.status || service.status === filter.status);
}

export function getMonitorView(db: DatabaseApi, id: string) {
  const service = db.getService(id);
  if (!service) {
    throw notFound(`Service ${id} does not exist`);
  }
  const summary = summarize(db, service);
  return {
    ...summary,
    secretRef: service.secretRef,
    config: redactConfig(service.config),
    address: service.address,
    url: service.url,
    latencyBudgetMs: service.latencyBudgetMs,
    createdAt: service.createdAt,
  };
}

export function listOpenIncidentViews(db: DatabaseApi, groupId?: string, now = Date.now()) {
  return db.listOpenIncidents(groupId).map((incident) => ({
    id: incident.id,
    serviceId: incident.serviceId,
    serviceName: incident.serviceName,
    groupId: incident.groupId,
    groupName: incident.groupName,
    role: incident.role,
    reason: incident.reason,
    errorClass: incident.errorClass ?? null,
    startedAt: incident.startedAt,
    ageSeconds: Math.max(0, Math.round((now - Date.parse(incident.startedAt)) / 1000)),
    updateState: incident.updateState ?? null,
  }));
}

export function getIncidentView(db: DatabaseApi, id: string) {
  const incident = db.getIncident(id);
  if (!incident) {
    throw notFound(`Incident ${id} does not exist`);
  }
  const service = db.getService(incident.serviceId);
  return {
    ...incident,
    serviceName: service?.name ?? null,
    updates: db.listIncidentUpdates(id),
    acknowledgements: db.listAcknowledgements(id),
  };
}

export function buildHealth(db: DatabaseApi, monitor?: Pick<Monitor, "isRunning" | "activeServiceCount">) {
  const databaseOk = db.ping();
  const running = monitor?.isRunning() ?? false;
  const healthy = databaseOk && running;
  return {
    httpStatus: healthy ? 200 : 503,
    body: {
      status: healthy ? "healthy" as const : "unhealthy" as const,
      database: databaseOk ? "connected" as const : "disconnected" as const,
      monitor: running ? "running" as const : "stopped" as const,
      activeServices: monitor?.activeServiceCount() ?? 0,
    },
  };
}

function summarize(db: DatabaseApi, service: Service) {
  const latest = db.getLatestHealthCheck(service.id);
  return {
    id: service.id,
    name: service.name,
    kind: service.kind,
    role: service.role,
    groupId: service.groupId,
    url: service.url,
    status: (latest?.status ?? "UNKNOWN") as ServiceStatus,
    lastCheckedAt: latest?.checkedAt ?? null,
    responseTimeMs: latest?.responseTimeMs ?? null,
    intervalSeconds: service.intervalSeconds,
    timeoutMs: service.timeoutMs,
    failureThreshold: service.failureThreshold,
    successThreshold: service.successThreshold,
    paused: service.paused,
    isActive: service.isActive,
    createdAt: service.createdAt,
  };
}
