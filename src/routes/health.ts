import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import { createNoopLogger, type Logger } from "../utils/logger.js";

export function createHealthRouter({ db, logger }: { db: DatabaseApi; logger?: Logger }) {
  const appLogger = logger ?? createNoopLogger();
  const router = Router();

  router.get("/", (_req, res) => {
    const healthy = db.ping();
    const payload = {
      status: healthy ? "healthy" : "unhealthy",
      database: healthy ? "connected" : "disconnected",
      monitor: "running",
      activeServices: db.listServices().length,
    };

    appLogger.info({ database: healthy ? "connected" : "disconnected" }, "health check");
    res.status(healthy ? 200 : 503).json(payload);
  });

  return router;
}
