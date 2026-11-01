import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { createAlertRoute, listAlertRoutes, removeAlertRoute } from "../application/alertRoutes.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const createSchema = z.object({
  kind: z.enum(["log", "webhook", "slack", "email"]),
  groupId: z.string().trim().min(1).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  secretRef: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});

export function createAlertRoutesRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.get("/", (_req, res, next) => {
    try {
      res.json(listAlertRoutes(db, requireAuth(res)));
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
      res.status(201).json(createAlertRoute(db, requireAuth(res), parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      removeAlertRoute(db, requireAuth(res), req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
