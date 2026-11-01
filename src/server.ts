import { loadConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";

const config = loadConfig(process.env);
const logger = createLogger(config);

if (config.MCP_ONLY) {
  const { startProxy } = await import("./mcp/proxy.js");
  startProxy(config, logger);
} else {
  const { startMonitor } = await import("./monitorMain.js");
  startMonitor(config, logger);
}
