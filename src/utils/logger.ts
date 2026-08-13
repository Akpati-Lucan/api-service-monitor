import pino from "pino";
import type { AppConfig } from "../types/index.js";

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(config: Pick<AppConfig, "NODE_ENV" | "LOG_LEVEL">) {
  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      error: (error) => ({
        message: error.message,
        stack: config.NODE_ENV === "development" ? error.stack : undefined,
      }),
    },
  });
}

export function createNoopLogger(): Logger {
  return {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}
