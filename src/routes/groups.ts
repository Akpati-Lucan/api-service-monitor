import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { createGroup, getGroupView, listGroups, removeGroup, renameGroup } from "../application/groups.js";
import { getGroupReport } from "../application/reports.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).optional(),
});

const renameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export function createGroupsRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.get("/", (_req, res, next) => {
    try {
      res.json(listGroups(db, requireAuth(res)));
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
      const group = createGroup(db, requireAuth(res), parsed.data);
      res.status(201).json(group);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/report", (req, res, next) => {
    try {
      const month = typeof req.query.month === "string" ? req.query.month : "";
      res.json(getGroupReport(db, requireAuth(res), req.params.id, month));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      res.json(getGroupView(db, requireAuth(res), req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const parsed = renameSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      res.json(renameGroup(db, requireAuth(res), req.params.id, parsed.data.name));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      removeGroup(db, requireAuth(res), req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
