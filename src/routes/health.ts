import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import type { Monitor } from "../services/monitor.js";
import { buildHealth } from "../application/readModels.js";
import { createNoopLogger, type Logger } from "../utils/logger.js";

export function createHealthRouter({
  db,
  monitor,
  logger,
}: {
  db: DatabaseApi;
  monitor?: Pick<Monitor, "isRunning" | "activeServiceCount">;
  logger?: Logger;
}) {
  const appLogger = logger ?? createNoopLogger();
  const router = Router();

  router.get("/", (_req, res) => {
    const payload = buildHealth(db, monitor);
    appLogger.info({ database: payload.body.database, monitor: payload.body.monitor }, "health check");
    res.status(payload.httpStatus).json(payload.body);
  });

  return router;
}
