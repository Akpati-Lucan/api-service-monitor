import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { addIncidentUpdate } from "../application/incidentUpdates.js";
import { getIncidentView, listOpenIncidentViews } from "../application/readModels.js";
import { requireGroup } from "../auth/access.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const updateSchema = z.object({
  state: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  message: z.string().trim().min(1).max(2000),
});

export function createIncidentsRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      res.json(listOpenIncidentViews(db, auth.groupId ?? undefined));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      const view = getIncidentView(db, req.params.id);
      const service = view.serviceId ? db.getService(view.serviceId) : undefined;
      requireGroup(auth, service?.groupId ?? null);
      res.json({
        ...view,
        checks: db.getRecentHealthChecks(view.serviceId, 20),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/updates", (req, res, next) => {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      const update = addIncidentUpdate(db, requireAuth(res), req.params.id, parsed.data);
      const incident = db.getIncident(req.params.id);
      res.status(201).json({ update, incident });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
