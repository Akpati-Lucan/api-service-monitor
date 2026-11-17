import type { DatabaseApi } from "../db/database.js";
import type { Acknowledgement, AuthContext } from "../types/index.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope } from "../auth/access.js";

export function acknowledgeIncident(
  db: DatabaseApi,
  auth: AuthContext,
  incidentId: string,
  note: string,
): Acknowledgement {
  requireScope(auth, "write");
  const incident = db.getIncident(incidentId);
  if (!incident) {
    throw notFound(`Incident ${incidentId} does not exist`);
  }
  const service = db.getService(incident.serviceId);
  if (!service) {
    throw notFound(`Service ${incident.serviceId} does not exist`);
  }
  requireGroup(auth, service.groupId);
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  }
  return db.insertAcknowledgement({ incidentId, note: trimmed, actor: auth.name });
}
