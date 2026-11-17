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
  ENABLED_PROBES: z
    .string()
    .default("http")
    .transform((value) => value.split(",").map((item) => item.trim()).filter((item) => item.length > 0)),
  MCP_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value !== "false" && value !== "0"),
  AUTH_MODE: z.enum(["disabled", "enabled"]).default("disabled"),
  MCP_ONLY: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  MONITOR_BASE_URL: z.string().default(""),
  MCP_TOKEN: z.string().default(""),
  SMTP_URL: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  STATUS_BASE_URL: z.string().default("http://localhost:3000"),
  RETENTION_RAW_DAYS: z.coerce.number().int().min(1).max(3650).default(14),
  SQLITE_PROBE_ROOT: z.string().default(""),
  VISION_MARKETPLACE_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  VISION_STAFF_TOKEN: z.string().default(""),
  VISION_PUBLIC_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(60),
  VISION_PUBLISHER_PORTAL_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  VISION_BILLING_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  VISION_BILLING_WEBHOOK_SECRET: z.string().default(""),
  VISION_STRIPE_SECRET_KEY: z.string().default(""),
  VISION_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),
  VISION_BILLING_COUNTRIES: z
    .string()
    .default("US,CA,GB,AU,JP,DE,FR,NL,IE")
    .transform((value) => value.split(",").map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z]{2}$/.test(item))),
  VISION_BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(0),
  VISION_INTEGRATIONS_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  VISION_GATEWAY_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  VISION_INTEGRATION_KEY: z.string().default(""),
  VISION_INTEGRATION_KEY_VERSION: z.coerce.number().int().min(1).max(1000).default(1),
  VISION_INTEGRATION_KEY_PREVIOUS: z.string().default(""),
  VISION_EXAMPLE_AUTHORIZE_URL: z.string().default(""),
  VISION_EXAMPLE_TOKEN_URL: z.string().default(""),
  VISION_EXAMPLE_HEALTH_URL: z.string().default(""),
  VISION_EXAMPLE_CLIENT_ID: z.string().default(""),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = configSchema.parse(env);

  return {
    ...parsed,
    VERSION: "1.0.0",
  };
}
