import type { CheckRollup, HealthCheck, Incident, Service } from "../types/index.js";
import type { DatabaseApi } from "../db/database.js";
import { notFound, validationError } from "../utils/errors.js";

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export interface ServiceMetrics {
  window: string;
  totalChecks: number;
  upChecks: number;
  degradedChecks: number;
  downChecks: number;
  uptimePercent: number | null;
  uptimePercentCheckRatio: number | null;
  uptimePercentDuration: number | null;
  avgResponseTimeMs: number | null;
  incidentCount: number;
  openIncidentCount: number;
  mttrSeconds?: number;
}

export function getServiceMetrics(
  db: DatabaseApi,
  serviceId: string,
  window = "24h",
  now = new Date(),
): ServiceMetrics {
  if (!WINDOWS[window]) {
    throw validationError("window must be 1h, 24h, 7d, or 30d", {
      window: ["window must be 1h, 24h, 7d, or 30d"],
    });
  }

  const service = db.getService(serviceId);
  if (!service) {
    throw notFound(`Service ${serviceId} does not exist`);
  }

  const start = new Date(now.getTime() - WINDOWS[window]);
  const sinceIso = start.toISOString();
  const checks = db.listHealthChecksSince(serviceId, sinceIso);
  const coveredHours = new Set(checks.map((check) => hourKey(check.checkedAt)));
  const rollups = db.listRollupsSince(serviceId, sinceIso).filter((rollup) => !coveredHours.has(hourKey(rollup.hour)));

  const counts = countChecks(checks, rollups);
  const ratio = counts.total === 0 ? null : (counts.up / counts.total) * 100;
  const duration = durationUptimePercent(service, db.listIncidents(serviceId), start, now);
  const latency = averageLatency(checks, rollups);
  const overlapping = db.listIncidents(serviceId).filter((incident) => overlaps(incident, start, now));
  const resolvedInside = overlapping.filter((incident) => {
    if (!incident.resolvedAt || incident.durationSeconds == null) {
      return false;
    }
    const started = new Date(incident.startedAt).getTime();
    const resolved = new Date(incident.resolvedAt).getTime();
    return started >= start.getTime() && resolved <= now.getTime();
  });

  const metrics: ServiceMetrics = {
    window,
    totalChecks: counts.total,
    upChecks: counts.up,
    degradedChecks: counts.degraded,
    downChecks: counts.down,
    uptimePercent: ratio,
    uptimePercentCheckRatio: ratio,
    uptimePercentDuration: duration,
    avgResponseTimeMs: latency,
    incidentCount: overlapping.length,
    openIncidentCount: overlapping.filter((incident) => !incident.resolvedAt).length,
  };

  if (resolvedInside.length > 0) {
    const total = resolvedInside.reduce((sum, incident) => sum + (incident.durationSeconds ?? 0), 0);
    metrics.mttrSeconds = total / resolvedInside.length;
  }

  return metrics;
}

function countChecks(checks: HealthCheck[], rollups: CheckRollup[]) {
  const counts = { total: 0, up: 0, degraded: 0, down: 0 };
  for (const check of checks) {
    counts.total += 1;
    if (check.status === "UP") counts.up += 1;
    else if (check.status === "DEGRADED") counts.degraded += 1;
    else counts.down += 1;
  }
  for (const rollup of rollups) {
    counts.total += rollup.checks;
    counts.up += rollup.upChecks;
    counts.degraded += rollup.degradedChecks;
    counts.down += rollup.downChecks;
  }
  return counts;
}

function averageLatency(checks: HealthCheck[], rollups: CheckRollup[]): number | null {
  let weighted = 0;
  let samples = 0;
  for (const check of checks) {
    if (check.responseTimeMs == null) continue;
    weighted += check.responseTimeMs;
    samples += 1;
  }
  for (const rollup of rollups) {
    weighted += rollup.avgResponseTimeMs * rollup.checks;
    samples += rollup.checks;
  }
  return samples === 0 ? null : weighted / samples;
}

export function durationUptimePercent(service: Service, incidents: Incident[], windowStart: Date, now: Date): number | null {
  const created = new Date(service.createdAt).getTime();
  const start = Math.max(windowStart.getTime(), created);
  const end = now.getTime();
  if (end <= start) {
    return null;
  }

  let downMs = 0;
  for (const incident of incidents) {
    const incidentStart = new Date(incident.startedAt).getTime();
    const incidentEnd = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : end;
    const clippedStart = Math.max(incidentStart, start);
    const clippedEnd = Math.min(incidentEnd, end);
    if (clippedEnd > clippedStart) {
      downMs += clippedEnd - clippedStart;
    }
  }

  const span = end - start;
  return ((span - Math.min(downMs, span)) / span) * 100;
}

function overlaps(incident: Incident, start: Date, now: Date): boolean {
  const incidentStart = new Date(incident.startedAt).getTime();
  const incidentEnd = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now.getTime();
  return incidentEnd > start.getTime() && incidentStart <= now.getTime();
}

function hourKey(value: string): string {
  return value.slice(0, 13);
}
