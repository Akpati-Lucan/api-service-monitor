import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import { acceptHeartbeat } from "../application/heartbeats.js";

export function createHeartbeatsRouter({ db }: { db: DatabaseApi }) {
  const router = Router();

  router.post("/:token", (req, res, next) => {
    try {
      acceptHeartbeat(db, req.params.token);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
