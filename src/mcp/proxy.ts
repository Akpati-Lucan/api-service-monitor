import express from "express";
import type { AppConfig } from "../types/index.js";
import type { Logger } from "../utils/logger.js";

export function createProxyApp(config: Pick<AppConfig, "MONITOR_BASE_URL" | "MCP_TOKEN">, logger?: Logger) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    if (!config.MONITOR_BASE_URL) {
      res.status(503).json({ status: "unhealthy", monitor: "unconfigured" });
      return;
    }
    try {
      const response = await fetch(new URL("/health", config.MONITOR_BASE_URL), { signal: AbortSignal.timeout(3000) });
      res.status(response.ok ? 200 : 503).json({
        status: response.ok ? "healthy" : "unhealthy",
        monitor: response.ok ? "reachable" : "unhealthy",
      });
    } catch (error) {
      logger?.warn({ err: error }, "monitor health check failed");
      res.status(503).json({ status: "unhealthy", monitor: "unreachable" });
    }
  });

  app.post("/mcp", async (req, res) => {
    if (!config.MONITOR_BASE_URL) {
      res.status(503).json({ error: { code: "UNAVAILABLE", message: "MONITOR_BASE_URL is not set" } });
      return;
    }
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.MCP_TOKEN) {
        headers.authorization = `Bearer ${config.MCP_TOKEN}`;
      }
      const response = await fetch(new URL("/mcp", config.MONITOR_BASE_URL), {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      res.status(response.status).type(response.headers.get("content-type") ?? "application/json").send(text);
    } catch (error) {
      logger?.error({ err: error }, "mcp proxy failed");
      res.status(502).json({ error: { code: "BAD_GATEWAY", message: "Monitor did not answer" } });
    }
  });

  return app;
}

export function startProxy(config: AppConfig, logger: Logger) {
  const app = createProxyApp(config, logger);
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, monitor: config.MONITOR_BASE_URL }, "mcp proxy started");
  });
  const shutdown = (signal: string) => {
    logger.warn({ signal }, "received shutdown signal");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
