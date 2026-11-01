import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, IncidentUpdate } from "../types/index.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope, visibleService } from "../auth/access.js";

const STATES = new Set(["investigating", "identified", "monitoring", "resolved"]);

export function addIncidentUpdate(
  db: DatabaseApi,
  auth: AuthContext,
  incidentId: string,
  input: { state: string; message: string },
): IncidentUpdate {
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
  visibleService(db, auth, service.id);
  if (!STATES.has(input.state)) {
    throw validationError("state must be investigating, identified, monitoring, or resolved", {
      state: ["state must be investigating, identified, monitoring, or resolved"],
    });
  }
  const message = input.message.trim();
  if (message.length === 0 || message.length > 2000) {
    throw validationError("message must be 1 to 2000 characters", {
      message: ["message must be 1 to 2000 characters"],
    });
  }
  return db.recordIncidentUpdate({ incidentId, state: input.state, message });
}
