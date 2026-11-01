import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { createMaintenanceWindow, listMaintenanceWindows } from "../application/maintenance.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const createSchema = z.object({
  serviceId: z.string().trim().min(1).nullable().optional(),
  groupId: z.string().trim().min(1).nullable().optional(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  note: z.string().max(500).nullable().optional(),
});

export function createMaintenanceRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.get("/", (_req, res, next) => {
    try {
      res.json(listMaintenanceWindows(db, requireAuth(res)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      res.status(201).json(createMaintenanceWindow(db, requireAuth(res), parsed.data));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
