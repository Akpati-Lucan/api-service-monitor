import { z } from "zod";
import type { AppConfig } from "./types/index.js";

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DB_PATH: z.string().min(1, "DB_PATH is required").default("./data/api-monitor.db"),
  DEFAULT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(86400).default(60),
  DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000),
  DEFAULT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  RETRY_COUNT: z.coerce.number().int().min(0).max(20).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).max(30000).default(250),
  RETRY_FACTOR: z.coerce.number().min(1).max(10).default(2),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = configSchema.parse(env);

  return {
    ...parsed,
    VERSION: "1.0.0",
  };
}
