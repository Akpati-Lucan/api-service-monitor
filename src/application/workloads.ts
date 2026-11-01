import type { DatabaseApi } from "../db/database.js";
import type { AuthContext } from "../types/index.js";
import { listMonitorViews } from "./readModels.js";

export function listWorkloads(db: DatabaseApi, auth: AuthContext) {
  return listMonitorViews(db, { groupId: auth.groupId ?? undefined })
    .filter((service) => service.kind.startsWith("k8s."))
    .map((service) => {
      const latest = db.getLatestHealthCheck(service.id);
      const full = db.getService(service.id);
      return {
        id: service.id,
        name: service.name,
        kind: service.kind,
        status: service.status,
        namespace: typeof full?.config.namespace === "string" ? full.config.namespace : null,
        workload: typeof full?.config.name === "string" ? full.config.name : full?.config.ingressName ?? null,
        lastCheckedAt: service.lastCheckedAt,
        errorClass: latest?.errorClass ?? null,
        evidence: latest?.evidence ?? null,
      };
    });
}
