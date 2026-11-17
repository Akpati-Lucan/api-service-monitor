import type { DatabaseApi } from "../db/database.js";
import type { AuthContext } from "../types/index.js";
import { requireScope } from "../auth/access.js";
import { listMonitorViews, listOpenIncidentViews } from "./readModels.js";

export function getSummary(db: DatabaseApi, auth: AuthContext, now = Date.now()) {
  requireScope(auth, "read");
  const groupId = auth.groupId ?? undefined;
  const monitors = listMonitorViews(db, { groupId });
  const openIncidents = listOpenIncidentViews(db, groupId, now).map((incident) => ({
    id: incident.id,
    serviceId: incident.serviceId,
    serviceName: incident.serviceName,
    reason: incident.reason,
    errorClass: incident.errorClass,
    ageSeconds: incident.ageSeconds,
    responseTimeMs: db.getLatestHealthCheck(incident.serviceId)?.responseTimeMs ?? null,
  }));
  return {
    downCount: monitors.filter((monitor) => monitor.status === "DOWN").length,
    degradedCount: monitors.filter((monitor) => monitor.status === "DEGRADED").length,
    openIncidents,
  };
}
