import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { issueApiKey, revokeApiKey } from "../application/apiKeys.js";
import { requireAuth } from "../auth/access.js";
import { validationError } from "../utils/errors.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "write", "admin"]),
  groupId: z.string().trim().min(1).nullable().optional(),
});

export function createApiKeysRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.post("/", (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed", parsed.error.flatten().fieldErrors as Record<string, string[]>);
      }
      const issued = issueApiKey(db, requireAuth(res), parsed.data);
      res.status(201).json(issued);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      revokeApiKey(db, requireAuth(res), req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
