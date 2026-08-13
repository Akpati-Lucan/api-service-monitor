export type ServiceStatus = "UP" | "DOWN";

export interface Service {
  id: string;
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  createdAt: string;
  isActive: boolean;
}

export interface HealthCheck {
  id: number;
  serviceId: string;
  status: ServiceStatus;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  error?: string | null;
  checkedAt: string;
}

export interface Incident {
  id: string;
  serviceId: string;
  startedAt: string;
  resolvedAt?: string | null;
  reason: string;
  durationSeconds?: number | null;
}

export interface CheckResult {
  ok: boolean;
  httpStatus?: number;
  responseTimeMs: number;
  error?: string;
}

export interface AlertEvent {
  service: Service;
  incident: Incident;
  kind: "opened" | "resolved";
}

export interface AppConfig {
  PORT: number;
  DB_PATH: string;
  DEFAULT_INTERVAL_SECONDS: number;
  DEFAULT_TIMEOUT_MS: number;
  DEFAULT_FAILURE_THRESHOLD: number;
  RETRY_COUNT: number;
  RETRY_BASE_DELAY_MS: number;
  RETRY_FACTOR: number;
  NODE_ENV: "development" | "test" | "production";
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  VERSION?: string;
}

export interface CreateServiceInput {
  name: string;
  url: string;
  intervalSeconds?: number;
  timeoutMs?: number;
  failureThreshold?: number;
}

export interface ServiceSummary {
  id: string;
  name: string;
  url: string;
  status: ServiceStatus;
  lastCheckedAt?: string;
  responseTimeMs?: number;
  uptime24h?: number;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  isActive: boolean;
  createdAt: string;
}

export interface HealthResponse {
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  monitor: "running" | "stopped";
  activeServices: number;
}
