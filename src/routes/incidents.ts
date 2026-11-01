import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { addIncidentUpdate } from "../application/incidentUpdates.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const updateSchema = z.object({
  state: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  message: z.string().trim().min(1).max(2000),
});

export function createIncidentsRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

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
