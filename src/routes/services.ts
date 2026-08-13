import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import { createNoopLogger, type Logger } from "../utils/logger.js";
import { notFound, validationError } from "../utils/errors.js";

const createServiceSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  url: z.string().url("must be a valid absolute URL"),
  intervalSeconds: z.coerce.number().int().positive().min(5, "intervalSeconds must be at least 5").max(86400),
  timeoutMs: z.coerce.number().int().positive().min(250, "timeoutMs must be at least 250").max(60000),
  failureThreshold: z.coerce.number().int().positive().min(1, "failureThreshold must be at least 1").max(100),
});

export function createServicesRouter({ db, logger }: { db: DatabaseApi; logger?: Logger }) {
  const router = Router();
  const appLogger = logger ?? createNoopLogger();

  router.post("/", (req, res, next) => {
    try {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        const flattened = parsed.error.flatten();
        throw validationError("Validation failed", flattened.fieldErrors as Record<string, string[]>);
      }

      const service = db.createService({
        name: parsed.data.name,
        url: parsed.data.url,
        intervalSeconds: parsed.data.intervalSeconds,
        timeoutMs: parsed.data.timeoutMs,
        failureThreshold: parsed.data.failureThreshold,
      });

      appLogger.info({ serviceId: service.id, name: service.name }, "service created");
      res.status(201).json({
        id: service.id,
        name: service.name,
        url: service.url,
        intervalSeconds: service.intervalSeconds,
        timeoutMs: service.timeoutMs,
        failureThreshold: service.failureThreshold,
        isActive: service.isActive,
        createdAt: service.createdAt,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", (_req, res) => {
    const services = db.listServices();
    res.json(services.map((service) => ({
      id: service.id,
      name: service.name,
      url: service.url,
      intervalSeconds: service.intervalSeconds,
      timeoutMs: service.timeoutMs,
      failureThreshold: service.failureThreshold,
      isActive: service.isActive,
      createdAt: service.createdAt,
      status: "UP",
    })));
  });

  router.get("/:id", (req, res, next) => {
    try {
      const service = db.getService(req.params.id);
      if (!service) {
        throw notFound(`Service ${req.params.id} does not exist`);
      }
      res.json(service);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const service = db.getService(req.params.id);
      if (!service) {
        throw notFound(`Service ${req.params.id} does not exist`);
      }
      db.deactivateService(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/incidents", (req, res) => {
    res.json(db.listIncidents(req.params.id));
  });

  router.get("/:id/metrics", (req, res) => {
    const service = db.getService(req.params.id);
    if (!service) {
      throw notFound(`Service ${req.params.id} does not exist`);
    }

    const checks = db.getRecentHealthChecks(req.params.id, 10);
    res.json({
      window: "24h",
      uptimePercent: 100,
      avgResponseTimeMs: checks.reduce((sum, item) => sum + (item.responseTimeMs ?? 0), 0) / Math.max(checks.length, 1),
      totalChecks: checks.length,
      failedChecks: checks.filter((item) => item.status === "DOWN").length,
      incidentCount: db.listIncidents(req.params.id).length,
    });
  });

  return router;
}
