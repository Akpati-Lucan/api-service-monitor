import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, MaintenanceWindow } from "../types/index.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope, visibleService } from "../auth/access.js";

export function createMaintenanceWindow(
  db: DatabaseApi,
  auth: AuthContext,
  input: { serviceId?: string | null; groupId?: string | null; startsAt: string; endsAt: string; note?: string | null },
): MaintenanceWindow {
  requireScope(auth, "write");
  const serviceId = input.serviceId ?? null;
  const groupId = input.groupId ?? null;
  if (!serviceId && !groupId) {
    throw validationError("serviceId or groupId is required", {
      serviceId: ["serviceId or groupId is required"],
    });
  }
  const starts = Date.parse(input.startsAt);
  const ends = Date.parse(input.endsAt);
  if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) {
    throw validationError("endsAt must be after startsAt", { endsAt: ["endsAt must be after startsAt"] });
  }
  if (serviceId) {
    visibleService(db, auth, serviceId);
  }
  if (groupId) {
    if (!db.getGroup(groupId)) {
      throw notFound(`Group ${groupId} does not exist`);
    }
    requireGroup(auth, groupId);
  }
  const note = input.note?.trim() ?? "";
  if (note.length > 500) {
    throw validationError("note must be at most 500 characters", { note: ["note must be at most 500 characters"] });
  }
  return db.createMaintenanceWindow({
    serviceId,
    groupId,
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(ends).toISOString(),
    note: note.length > 0 ? note : null,
  });
}

export function listMaintenanceWindows(db: DatabaseApi, auth: AuthContext): MaintenanceWindow[] {
  requireScope(auth, "read");
  return db.listMaintenanceWindows().filter((window) => {
    if (!auth.groupId) return true;
    if (window.groupId === auth.groupId) return true;
    if (!window.serviceId) return false;
    return db.getService(window.serviceId)?.groupId === auth.groupId;
  });
}
