import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./db/database.js";
import { createLogger } from "./utils/logger.js";
import { InMemoryMonitor } from "./services/monitor.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";

const config = loadConfig(process.env);
const logger = createLogger(config);

const dataDir = path.dirname(config.DB_PATH);
mkdirSync(dataDir, { recursive: true });

const db = createDatabase({ dbPath: config.DB_PATH, logger });
initializeDatabase(db);

const monitor = new InMemoryMonitor();
monitor.start();

const app = createApp({ db, config, logger });
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "api monitoring service started");
});

const shutdown = (signal: string) => {
  logger.warn({ signal }, "received shutdown signal");

  server.close(() => {
    monitor.stop();
    db.close();
    logger.info("http server closed");
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn("shutdown timeout exceeded, forcing exit");
    process.exit(1);
  }, 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { app, config, db, monitor, logger };
