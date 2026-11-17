import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import { getSummary } from "../application/summary.js";
import { requireAuth } from "../auth/access.js";

export function createSummaryRouter({ db }: { db: DatabaseApi }) {
  const router = Router();
  router.get("/", (_req, res, next) => {
    try {
      res.json(getSummary(db, requireAuth(res)));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
