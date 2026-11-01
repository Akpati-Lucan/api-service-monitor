import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, ComponentStatus, PageStatus, ServiceRole } from "../types/index.js";
import { notFound, unauthorized } from "../utils/errors.js";
import { requireGroup, requireScope } from "../auth/access.js";
import { durationUptimePercent } from "../application/metrics.js";
import { serviceStatus } from "../application/readModels.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = 14 * DAY_MS;

export interface StatusDocument {
  title: string;
  status: PageStatus;
  updatedAt: string;
  components: Array<{
    name: string;
    status: ComponentStatus;
    role: ServiceRole;
    uptime90d: number | null;
  }>;
  incidents: Array<{
    id: string;
    service: string;
    role: ServiceRole;
    reason: string;
    state: string | null;
    open: boolean;
    startedAt: string;
    resolvedAt: string | null;
    updates: Array<{ state: string; message: string; at: string }>;
  }>;
}

export function loadStatusDocument(db: DatabaseApi, auth: AuthContext | null, slug: string, now = new Date()): StatusDocument {
  return getStatusDocument(db, slug, auth, now);
}

export function getStatusDocument(
  db: DatabaseApi,
  slug: string,
  auth: AuthContext | null,
  now = new Date(),
): StatusDocument {
  const page = db.getStatusPageBySlug(slug);
  if (!page) {
    throw notFound(`Status page ${slug} does not exist`);
  }
  if (page.visibility === "private") {
    if (!auth) {
      throw unauthorized("Bearer token is required");
    }
    requireScope(auth, "read");
    requireGroup(auth, page.groupId);
  }

  const windowStart = new Date(now.getTime() - 90 * DAY_MS);
  const recentAfter = now.getTime() - RECENT_MS;
  let updatedAt = Date.parse(page.createdAt);
  const components: StatusDocument["components"] = [];
  const incidents: StatusDocument["incidents"] = [];

  for (const component of db.listStatusComponents(page.id)) {
    const service = db.getService(component.serviceId);
    const status: ComponentStatus = service ? mapStatus(serviceStatus(db, service)) : "unknown";
    const latest = service ? db.getLatestHealthCheck(service.id) : undefined;
    if (latest) {
      updatedAt = Math.max(updatedAt, Date.parse(latest.checkedAt));
    }
    const uptime = service ? durationUptimePercent(service, db.listIncidents(service.id), windowStart, now) : null;
    components.push({
      name: component.displayName,
      status,
      role: service?.role ?? "owned",
      uptime90d: uptime == null ? null : Math.round(uptime * 10) / 10,
    });
    if (!service) {
      continue;
    }
    for (const incident of db.listIncidents(service.id)) {
      const resolved = incident.resolvedAt ? Date.parse(incident.resolvedAt) : null;
      const open = resolved == null;
      if (!open && (resolved ?? 0) < recentAfter) {
        continue;
      }
      const updates = db.listIncidentUpdates(incident.id).map((update) => ({
        state: update.state,
        message: update.message,
        at: update.createdAt,
      }));
      for (const update of updates) {
        updatedAt = Math.max(updatedAt, Date.parse(update.at));
      }
      const reason = service.role === "dependency" ? `${service.name}: ${incident.reason}` : incident.reason;
      incidents.push({
        id: incident.id,
        service: component.displayName,
        role: service.role,
        reason,
        state: incident.updateState ?? null,
        open,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt ?? null,
        updates,
      });
    }
  }

  incidents.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  return {
    title: page.title,
    status: rollup(components),
    updatedAt: new Date(updatedAt).toISOString(),
    components,
    incidents,
  };
}

function rollup(components: StatusDocument["components"]): PageStatus {
  const owned = components.filter((component) => component.role === "owned" && component.status !== "unknown");
  if (owned.some((component) => component.status === "down")) {
    return "down";
  }
  if (owned.some((component) => component.status === "degraded")) {
    return "degraded";
  }
  return "operational";
}

function mapStatus(status: string): ComponentStatus {
  if (status === "UP") return "operational";
  if (status === "DEGRADED") return "degraded";
  if (status === "DOWN") return "down";
  return "unknown";
}
