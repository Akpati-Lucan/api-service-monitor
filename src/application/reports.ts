import type { DatabaseApi } from "../db/database.js";
import type { AuthContext } from "../types/index.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope } from "../auth/access.js";
import { durationUptimePercent } from "./metrics.js";

export function getGroupReport(db: DatabaseApi, auth: AuthContext, groupId: string, month: string, now = new Date()) {
  requireScope(auth, "read");
  const group = db.getGroup(groupId);
  if (!group) {
    throw notFound(`Group ${groupId} does not exist`);
  }
  requireGroup(auth, group.id);
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const monthIndex = match ? Number(match[2]) : 0;
  if (!match || monthIndex < 1 || monthIndex > 12) {
    throw validationError("month must be YYYY-MM", { month: ["month must be YYYY-MM"] });
  }
  const start = new Date(Date.UTC(Number(match[1]), monthIndex - 1, 1));
  const endOfMonth = new Date(Date.UTC(Number(match[1]), monthIndex, 1));
  if (start.getTime() > now.getTime()) {
    throw validationError("month is in the future", { month: ["month is in the future"] });
  }
  const end = new Date(Math.min(endOfMonth.getTime(), now.getTime()));
  const services = db.listServices().filter((service) => service.groupId === group.id);

  return {
    groupId: group.id,
    month,
    services: services.map((service) => {
      const incidents = db.listIncidents(service.id).filter((incident) => {
        const started = Date.parse(incident.startedAt);
        const resolved = incident.resolvedAt ? Date.parse(incident.resolvedAt) : end.getTime();
        return resolved > start.getTime() && started < end.getTime();
      });
      const checks = db.listHealthChecksSince(service.id, start.toISOString()).filter((check) => Date.parse(check.checkedAt) < end.getTime());
      const samples = checks.filter((check) => check.responseTimeMs != null);
      const avgResponseTimeMs = samples.length === 0
        ? null
        : samples.reduce((sum, check) => sum + (check.responseTimeMs ?? 0), 0) / samples.length;
      return {
        id: service.id,
        name: service.name,
        uptimePercentDuration: durationUptimePercent(service, incidents, start, end),
        avgResponseTimeMs,
        incidents: incidents.map((incident) => ({
          id: incident.id,
          startedAt: incident.startedAt,
          resolvedAt: incident.resolvedAt ?? null,
          reason: incident.reason,
          durationSeconds: incident.durationSeconds ?? null,
        })),
      };
    }),
  };
}
