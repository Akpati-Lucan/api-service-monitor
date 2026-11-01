export type CheckStatus = "UP" | "DEGRADED" | "DOWN";
export type ServiceStatus = CheckStatus | "UNKNOWN";
export type ServiceRole = "owned" | "dependency";

export type ErrorClass =
  | "timeout"
  | "network"
  | "dns"
  | "tls"
  | "http_status"
  | "auth"
  | "query"
  | "assertion"
  | "not_ready"
  | "missed_heartbeat"
  | "expired_certificate"
  | "expired_domain"
  | "unknown";

export interface Service {
  id: string;
  name: string;
  url: string;
  address: string;
  kind: string;
  role: ServiceRole;
  groupId: string | null;
  secretRef: string | null;
  config: Record<string, unknown>;
  latencyBudgetMs: number | null;
  successThreshold: number;
  paused: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  createdAt: string;
  isActive: boolean;
}

export interface HealthCheck {
  id: number;
  serviceId: string;
  status: CheckStatus;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  error?: string | null;
  errorClass?: ErrorClass | null;
  evidence?: Record<string, string | number | boolean> | null;
  region?: string | null;
  checkedAt: string;
}

export interface Incident {
  id: string;
  serviceId: string;
  startedAt: string;
  resolvedAt?: string | null;
  reason: string;
  durationSeconds?: number | null;
  errorClass?: ErrorClass | null;
  updateState?: string | null;
}

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  state: string;
  message: string;
  createdAt: string;
}

export interface Acknowledgement {
  id: string;
  incidentId: string;
  note: string;
  actor: string;
  createdAt: string;
}

export interface CheckRollup {
  hour: string;
  serviceId: string;
  checks: number;
  upChecks: number;
  degradedChecks: number;
  downChecks: number;
  avgResponseTimeMs: number;
}

export interface CheckResult {
  ok: boolean;
  status: CheckStatus;
  responseTimeMs: number;
  httpStatus?: number;
  errorClass?: ErrorClass;
  error?: string;
  evidence?: Record<string, string | number | boolean>;
}

export interface AlertEvent {
  service: Service;
  incident: Incident;
  kind: "opened" | "resolved";
}

export type AuthScope = "read" | "write" | "admin";
export type AuthMode = "disabled" | "enabled";

export interface Group {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scope: AuthScope;
  groupId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface AuthContext {
  keyId: string | null;
  name: string;
  scope: AuthScope;
  groupId: string | null;
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
  ENABLED_PROBES: string[];
  MCP_ENABLED: boolean;
  AUTH_MODE: AuthMode;
  MCP_ONLY: boolean;
  MONITOR_BASE_URL: string;
  MCP_TOKEN: string;
  SMTP_URL: string;
  SMTP_FROM: string;
  STATUS_BASE_URL: string;
  VERSION?: string;
}

export type StatusVisibility = "public" | "private";
export type PageStatus = "operational" | "degraded" | "down";
export type ComponentStatus = PageStatus | "unknown";
export type AlertRouteKind = "log" | "webhook" | "slack" | "email";

export interface StatusPage {
  id: string;
  groupId: string;
  slug: string;
  title: string;
  visibility: StatusVisibility;
  createdAt: string;
}

export interface StatusComponent {
  id: string;
  statusPageId: string;
  serviceId: string;
  displayName: string;
  sortOrder: number;
}

export interface AlertRoute {
  id: string;
  groupId: string | null;
  kind: AlertRouteKind;
  config: Record<string, unknown>;
  secretRef: string | null;
  enabled: boolean;
}

export interface MaintenanceWindow {
  id: string;
  groupId: string | null;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  note: string | null;
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
