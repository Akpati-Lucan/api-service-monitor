import express from "express";
import type { DatabaseApi } from "./db/database.js";
import type { AppConfig } from "./types/index.js";
import { AppError } from "./utils/errors.js";
import { createLogger, createNoopLogger, type Logger } from "./utils/logger.js";
import { createHealthRouter } from "./routes/health.js";
import { createServicesRouter } from "./routes/services.js";

export interface AppDependencies {
  db: DatabaseApi;
  config: AppConfig;
  logger?: Logger;
}

export function createApp({ db, config, logger }: AppDependencies) {
  const app = express();
  const appLogger = logger ?? createLogger({ NODE_ENV: config.NODE_ENV, LOG_LEVEL: config.LOG_LEVEL });

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", createHealthRouter({ db, logger: appLogger }));
  app.use("/services", createServicesRouter({ db, logger: appLogger }));

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
