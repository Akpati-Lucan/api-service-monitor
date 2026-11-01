import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { addStatusComponent, createStatusPage } from "../application/statusPages.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const pageSchema = z.object({
  groupId: z.string().trim().min(1),
  slug: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(80),
  visibility: z.enum(["public", "private"]),
});

const componentSchema = z.object({
  serviceId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export function createStatusPagesRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.post("/", (req, res, next) => {
    try {
      const parsed = pageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      res.status(201).json(createStatusPage(db, requireAuth(res), parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/components", (req, res, next) => {
    try {
      const parsed = componentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      res.status(201).json(addStatusComponent(db, requireAuth(res), req.params.id, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
