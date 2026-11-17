import path from "node:path";
import { mkdirSync } from "node:fs";
import { createApp } from "./app.js";
import { createDatabase, initializeDatabase } from "./db/database.js";
import { InMemoryMonitor } from "./services/monitor.js";
import { LoggingAlertSink, LoggingPushSink } from "./services/alert.js";
import { RoutingAlertSink } from "./alerts/routing.js";
import { createDefaultProbeRegistry } from "./probes/registry.js";
import type { AppConfig } from "./types/index.js";
import type { Logger } from "./utils/logger.js";

export function startMonitor(config: AppConfig, logger: Logger) {
  const dataDir = path.dirname(config.DB_PATH);
  mkdirSync(dataDir, { recursive: true });

  const db = createDatabase({ dbPath: config.DB_PATH, logger });
  initializeDatabase(db);

  const monitor = new InMemoryMonitor({
    db,
    registry: createDefaultProbeRegistry(config.ENABLED_PROBES),
    alerts: new RoutingAlertSink({
      db,
      logger,
      statusBaseUrl: config.STATUS_BASE_URL,
      smtpUrl: config.SMTP_URL,
      smtpFrom: config.SMTP_FROM,
      fallback: new LoggingAlertSink(logger),
    }),
    logger,
    push: new LoggingPushSink(logger),
    retry: {
      retries: config.RETRY_COUNT,
      baseDelayMs: config.RETRY_BASE_DELAY_MS,
      factor: config.RETRY_FACTOR,
    },
    sqliteRoot: config.SQLITE_PROBE_ROOT,
  });
  monitor.start();
  const retention = setInterval(() => {
    const cutoff = new Date(Date.now() - config.RETENTION_RAW_DAYS * 24 * 60 * 60 * 1000);
    try {
      const result = db.compactHealthChecks(cutoff.toISOString());
      logger.info(result, "retention compacted raw checks");
    } catch (error) {
      logger.error({ err: error }, "retention failed");
    }
  }, 24 * 60 * 60 * 1000);
  retention.unref();

  const app = createApp({ db, config, logger, monitor });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "api monitoring service started");
  });

  const shutdown = (signal: string) => {
    logger.warn({ signal }, "received shutdown signal");
    clearInterval(retention);
    const timeouts = db.listServices().map((service) => service.timeoutMs);
    const capMs = Math.max(config.DEFAULT_TIMEOUT_MS, ...timeouts, 0) + 1000;

    server.close(() => {
      monitor.stop();
      void monitor.waitForIdle(capMs).then(() => {
        db.close();
        logger.info("http server closed");
        process.exit(0);
      });
    });

    setTimeout(() => {
      logger.warn("shutdown timeout exceeded, forcing exit");
      process.exit(1);
    }, capMs).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
