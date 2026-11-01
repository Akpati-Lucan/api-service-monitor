import { Router } from "express";
import { z } from "zod";
import type { DatabaseApi } from "../db/database.js";
import type { AppConfig } from "../types/index.js";
import type { Monitor } from "../services/monitor.js";
import { createMonitor } from "../application/monitors.js";
import { getServiceMetrics } from "../application/metrics.js";
import { getMonitorView, listMonitorViews } from "../application/readModels.js";
import { createNoopLogger, type Logger } from "../utils/logger.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireAuth, requireGroup, requireScope, visibleService } from "../auth/access.js";

const optionalBoundedInt = (min: number, max: number, message: string) =>
  z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? undefined : value),
    z.coerce.number().int().min(min, message).max(max).optional(),
  );

const createServiceSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  url: z.string().url("must be a valid absolute URL"),
  intervalSeconds: optionalBoundedInt(5, 86400, "intervalSeconds must be at least 5"),
  timeoutMs: optionalBoundedInt(250, 60000, "timeoutMs must be at least 250"),
  failureThreshold: optionalBoundedInt(1, 100, "failureThreshold must be at least 1"),
  successThreshold: optionalBoundedInt(1, 100, "successThreshold must be at least 1"),
  kind: z.string().trim().min(1).optional(),
  role: z.enum(["owned", "dependency"]).optional(),
  secretRef: z.string().regex(/^[A-Z0-9_]+$/, "secretRef must match [A-Z0-9_]").optional(),
  groupId: z.string().trim().min(1).optional(),
});

export function createServicesRouter({
  db,
  config,
  monitor,
  logger,
}: {
  db: DatabaseApi;
  config: AppConfig;
  monitor?: Pick<Monitor, "registerService" | "unregisterService">;
  logger?: Logger;
}) {
  const router = Router();
  const appLogger = logger ?? createNoopLogger();

  router.post("/", (req, res, next) => {
    try {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        const flattened = parsed.error.flatten();
        throw validationError("Validation failed", flattened.fieldErrors as Record<string, string[]>);
      }

      const auth = requireAuth(res);
      requireScope(auth, "write");
      const groupId = auth.groupId ?? parsed.data.groupId;
      if (auth.groupId && parsed.data.groupId && parsed.data.groupId !== auth.groupId) {
        requireGroup(auth, parsed.data.groupId);
      }
      const service = createMonitor(db, config, { ...parsed.data, groupId });
      monitor?.registerService(service);

      appLogger.info({ serviceId: service.id, name: service.name, kind: service.kind }, "service created");
      res.status(201).json(getMonitorView(db, service.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/", (_req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "read");
      res.json(listMonitorViews(db, { groupId: auth.groupId ?? undefined }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/pause", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "write");
      const service = visibleService(db, auth, req.params.id);
      db.setServicePaused(service.id, true);
      monitor?.unregisterService(service.id);
      res.json(getMonitorView(db, service.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/resume", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "write");
      const service = visibleService(db, auth, req.params.id);
      db.setServicePaused(service.id, false);
      const resumed = db.getService(service.id);
      if (!resumed) {
        throw notFound(`Service ${service.id} does not exist`);
      }
      monitor?.registerService(resumed);
      res.json(getMonitorView(db, service.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/incidents", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "read");
      const service = visibleService(db, auth, req.params.id);
      res.json(db.listIncidents(service.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/metrics", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "read");
      const service = visibleService(db, auth, req.params.id);
      const window = typeof req.query.window === "string" ? req.query.window : "24h";
      res.json(getServiceMetrics(db, service.id, window));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "read");
      visibleService(db, auth, req.params.id);
      res.json(getMonitorView(db, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const auth = requireAuth(res);
      requireScope(auth, "write");
      const service = visibleService(db, auth, req.params.id);
      db.deactivateService(service.id);
      monitor?.unregisterService(service.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
