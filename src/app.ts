import express from "express";
import type { DatabaseApi } from "./db/database.js";
import type { AppConfig } from "./types/index.js";
import type { Monitor } from "./services/monitor.js";
import { AppError } from "./utils/errors.js";
import { createLogger, type Logger } from "./utils/logger.js";
import { createHealthRouter } from "./routes/health.js";
import { createServicesRouter } from "./routes/services.js";
import { createGroupsRouter } from "./routes/groups.js";
import { createApiKeysRouter } from "./routes/apiKeys.js";
import { createPublicStatusRouter } from "./routes/status.js";
import { createStatusPagesRouter } from "./routes/statusPages.js";
import { createAlertRoutesRouter } from "./routes/alertRoutes.js";
import { createMaintenanceRouter } from "./routes/maintenance.js";
import { createIncidentsRouter } from "./routes/incidents.js";
import { createMcpRouter } from "./mcp/http.js";
import { createAuthMiddleware } from "./auth/middleware.js";

export interface AppDependencies {
  db: DatabaseApi;
  config: AppConfig;
  logger?: Logger;
  monitor?: Monitor;
}

export function createApp({ db, config, logger, monitor }: AppDependencies) {
  const app = express();
  const appLogger = logger ?? createLogger({ NODE_ENV: config.NODE_ENV, LOG_LEVEL: config.LOG_LEVEL });

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", createHealthRouter({ db, monitor, logger: appLogger }));
  app.use("/status", createPublicStatusRouter({ db, config }));
  app.use(createAuthMiddleware({ db, config }));
  app.use("/services", createServicesRouter({ db, config, monitor, logger: appLogger }));
  app.use("/groups", createGroupsRouter({ db }));
  app.use("/api-keys", createApiKeysRouter({ db }));
  app.use("/status-pages", createStatusPagesRouter({ db }));
  app.use("/alert-routes", createAlertRoutesRouter({ db }));
  app.use("/maintenance-windows", createMaintenanceRouter({ db }));
  app.use("/incidents", createIncidentsRouter({ db }));
  if (config.MCP_ENABLED) {
    app.use("/mcp", createMcpRouter({ db, config, monitor, logger: appLogger }));
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      appLogger.warn({ code: error.code, message: error.message }, "application error");
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }

    appLogger.error({ err: error }, "unhandled application error");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  });

  return app;
}
