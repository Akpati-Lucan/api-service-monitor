import { validationError } from "../utils/errors.js";
import { isK8sKind } from "./k8s.js";

export interface ValidatedProbe {
  config: Record<string, unknown>;
  address: string;
  url: string;
  latencyBudgetMs: number | null;
}

const DNS_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const STATUS_SPEC = /^(\d{3}(-\d{3})?)(,\d{3}(-\d{3})?)*$/;
const JSON_PATH = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;

export function validateProbeConfig(input: {
  kind: string;
  url?: string;
  config?: Record<string, unknown>;
  latencyBudgetMs?: number | null;
  intervalSeconds: number;
  nodeEnv: string;
}): ValidatedProbe {
  const raw = input.config ?? {};
  if (input.kind === "http") return validateHttp(input.url, raw, input.latencyBudgetMs ?? null, input.nodeEnv);
  if (input.kind === "tcp") return validateTcp(raw);
  if (input.kind === "tls") return validateTls(raw);
  if (input.kind === "heartbeat") return validateHeartbeat(raw, input.intervalSeconds);
  if (input.kind === "postgres") return validatePostgres(raw, input.nodeEnv);
  if (input.kind === "mysql") return validateMysql(raw);
  if (input.kind === "mongodb") return validateMongodb(raw);
  if (input.kind === "redis") return validateRedis(raw);
  if (input.kind === "dns") return validateDns(raw);
  if (input.kind === "domain") return validateDomain(raw);
  if (input.kind === "s3") return validateS3(raw);
  if (input.kind === "elastic") return validateElastic(raw);
  if (input.kind === "rabbitmq") return validateRabbit(raw);
  if (input.kind === "sqlite") return validateSqlite(raw);
  if (input.kind === "memcached") return validateMemcached(raw);
  if (input.kind === "etcd") return validateEtcd(raw);
  if (input.kind === "http.flow") return validateFlow(raw);
  if (isK8sKind(input.kind)) return validateK8s(input.kind, raw);
  throw validationError("Unsupported probe config", { kind: [`${input.kind} has no config schema`] });
}

function validateHttp(url: string | undefined, raw: Record<string, unknown>, latencyBudgetMs: number | null, nodeEnv: string): ValidatedProbe {
  if (!url || !isAbsoluteHttpUrl(url)) {
    throw validationError("Validation failed", { url: ["must be a valid absolute URL"] });
  }
  const method = raw.method === undefined ? "GET" : raw.method;
  if (method !== "GET" && method !== "POST") {
    throw validationError("Validation failed", { method: ["method must be GET or POST"] });
  }
  const headers = raw.headers === undefined ? {} : raw.headers;
  if (!isStringMap(headers)) {
    throw validationError("Validation failed", { headers: ["headers must be an object of strings"] });
  }
  const secretHeader = optionalString(raw.secretHeader, "secretHeader");
  if (secretHeader && !HEADER_NAME.test(secretHeader)) {
    throw validationError("Validation failed", { secretHeader: ["secretHeader must be a header name"] });
  }
  const expectedStatus = raw.expectedStatus === undefined ? "200-299" : raw.expectedStatus;
  if (typeof expectedStatus !== "string" || !STATUS_SPEC.test(expectedStatus)) {
    throw validationError("Validation failed", { expectedStatus: ["expectedStatus must be codes or ranges such as 200-299"] });
  }
  const bodyIncludes = optionalString(raw.bodyIncludes, "bodyIncludes");
  const jsonPath = optionalString(raw.jsonPath, "jsonPath");
  const jsonEquals = optionalString(raw.jsonEquals, "jsonEquals");
  if (jsonPath && !JSON_PATH.test(jsonPath)) {
    throw validationError("Validation failed", { jsonPath: ["jsonPath must be a dot path"] });
  }
  if (jsonEquals != null && !jsonPath) {
    throw validationError("Validation failed", { jsonPath: ["jsonPath is required when jsonEquals is set"] });
  }
  const followRedirects = raw.followRedirects === undefined ? true : raw.followRedirects;
  if (typeof followRedirects !== "boolean") {
    throw validationError("Validation failed", { followRedirects: ["followRedirects must be a boolean"] });
  }
  const tlsSkipVerify = raw.tlsSkipVerify === undefined ? false : raw.tlsSkipVerify;
  if (typeof tlsSkipVerify !== "boolean") {
    throw validationError("Validation failed", { tlsSkipVerify: ["tlsSkipVerify must be a boolean"] });
  }
  if (tlsSkipVerify && nodeEnv !== "development") {
    throw validationError("Validation failed", { tlsSkipVerify: ["tlsSkipVerify is only allowed when NODE_ENV is development"] });
  }
  if (tlsSkipVerify && !url.startsWith("https:")) {
    throw validationError("Validation failed", { tlsSkipVerify: ["tlsSkipVerify applies to https URLs"] });
  }
  return {
    url,
    address: url,
    latencyBudgetMs,
    config: {
      method,
      headers,
      secretHeader: secretHeader ?? null,
      expectedStatus,
      bodyIncludes: bodyIncludes ?? null,
      jsonPath: jsonPath ?? null,
      jsonEquals: jsonEquals ?? null,
      followRedirects,
      tlsSkipVerify,
    },
  };
}

function validateTcp(raw: Record<string, unknown>): ValidatedProbe {
  const host = requireString(raw.host, "host");
  const port = requirePort(raw.port);
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port } };
}

function validateTls(raw: Record<string, unknown>): ValidatedProbe {
  const host = requireString(raw.host, "host");
  const port = raw.port === undefined ? 443 : requirePort(raw.port);
  const warnDays = raw.warnDays === undefined ? 21 : requirePositiveInt(raw.warnDays, "warnDays");
  const downDays = raw.downDays === undefined ? 3 : requirePositiveInt(raw.downDays, "downDays");
  if (warnDays <= downDays) {
    throw validationError("Validation failed", { warnDays: ["warnDays must be greater than downDays"] });
  }
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port, warnDays, downDays } };
}

function validateHeartbeat(raw: Record<string, unknown>, intervalSeconds: number): ValidatedProbe {
  const graceSeconds = requirePositiveInt(raw.graceSeconds, "graceSeconds");
  if (graceSeconds < intervalSeconds) {
    throw validationError("Validation failed", { graceSeconds: ["graceSeconds must be at least the check interval"] });
  }
  return { url: "heartbeat", address: "heartbeat", latencyBudgetMs: null, config: { graceSeconds } };
}

function validatePostgres(raw: Record<string, unknown>, nodeEnv: string): ValidatedProbe {
  const host = requireHost(raw.host);
  const port = raw.port === undefined ? 5432 : requirePort(raw.port);
  const database = requireString(raw.database, "database");
  const user = requireString(raw.user, "user");
  const ssl = raw.ssl === undefined ? (nodeEnv === "development" ? "disable" : "require") : raw.ssl;
  if (ssl !== "disable" && ssl !== "require") {
    throw validationError("Validation failed", { ssl: ["ssl must be disable or require"] });
  }
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port, database, user, ssl } };
}

function validateMysql(raw: Record<string, unknown>): ValidatedProbe {
  const host = requireHost(raw.host);
  const port = raw.port === undefined ? 3306 : requirePort(raw.port);
  const user = requireString(raw.user, "user");
  const database = optionalString(raw.database, "database");
  const variant = raw.variant === undefined ? null : raw.variant;
  if (variant !== null && variant !== "mysql" && variant !== "mariadb") {
    throw validationError("Validation failed", { variant: ["variant must be mysql or mariadb"] });
  }
  const ssl = raw.ssl === undefined ? "disable" : raw.ssl;
  if (ssl !== "disable" && ssl !== "require") {
    throw validationError("Validation failed", { ssl: ["ssl must be disable or require"] });
  }
  const address = `${host}:${port}`;
  return {
    url: address,
    address,
    latencyBudgetMs: null,
    config: { host, port, user, database, variant, ssl },
  };
}

function validateMongodb(raw: Record<string, unknown>): ValidatedProbe {
  const uri = requireString(raw.uri, "uri");
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw validationError("Validation failed", { uri: ["uri must be a mongodb URI"] });
  }
  if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") {
    throw validationError("Validation failed", { uri: ["uri must be a mongodb URI"] });
  }
  if (parsed.password) {
    throw validationError("Validation failed", { uri: ["uri must not contain a password; use secretRef"] });
  }
  return { url: uri, address: uri, latencyBudgetMs: null, config: { uri } };
}

function validateRedis(raw: Record<string, unknown>): ValidatedProbe {
  const host = requireHost(raw.host);
  const port = raw.port === undefined ? 6379 : requirePort(raw.port);
  const tls = raw.tls === undefined ? false : raw.tls;
  if (typeof tls !== "boolean") {
    throw validationError("Validation failed", { tls: ["tls must be a boolean"] });
  }
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port, tls } };
}

function validateDns(raw: Record<string, unknown>): ValidatedProbe {
  const name = requireDnsName(raw.name, "name");
  const type = raw.type;
  if (type !== "A" && type !== "AAAA" && type !== "CNAME" && type !== "MX" && type !== "TXT") {
    throw validationError("Validation failed", { type: ["type must be A, AAAA, CNAME, MX, or TXT"] });
  }
  const expected = optionalString(raw.expected, "expected");
  return { url: name, address: name, latencyBudgetMs: null, config: { name, type, expected } };
}

function validateDomain(raw: Record<string, unknown>): ValidatedProbe {
  const domain = requireDnsName(raw.domain, "domain");
  const warnDays = raw.warnDays === undefined ? 30 : requirePositiveInt(raw.warnDays, "warnDays");
  const downDays = raw.downDays === undefined ? 7 : requirePositiveInt(raw.downDays, "downDays");
  if (warnDays <= downDays) {
    throw validationError("Validation failed", { warnDays: ["warnDays must be greater than downDays"] });
  }
  return { url: domain, address: domain, latencyBudgetMs: null, config: { domain, warnDays, downDays } };
}

function validateS3(raw: Record<string, unknown>): ValidatedProbe {
  const bucket = requireString(raw.bucket, "bucket");
  const region = requireString(raw.region, "region");
  const endpoint = raw.endpoint == null || raw.endpoint === "" ? null : requireString(raw.endpoint, "endpoint");
  if (endpoint && !isAbsoluteHttpUrl(endpoint)) {
    throw validationError("Validation failed", { endpoint: ["endpoint must be an absolute http(s) URL"] });
  }
  const address = endpoint ? `${endpoint.replace(/\/$/, "")}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com/`;
  return { url: address, address, latencyBudgetMs: null, config: { endpoint, region, bucket } };
}

function validateElastic(raw: Record<string, unknown>): ValidatedProbe {
  const address = requireString(raw.address, "address");
  if (!isAbsoluteHttpUrl(address)) {
    throw validationError("Validation failed", { address: ["address must be an absolute http(s) URL"] });
  }
  const variant = raw.variant === undefined ? "elasticsearch" : raw.variant;
  if (variant !== "elasticsearch" && variant !== "opensearch") {
    throw validationError("Validation failed", { variant: ["variant must be elasticsearch or opensearch"] });
  }
  return { url: address, address, latencyBudgetMs: null, config: { address, variant } };
}

function validateRabbit(raw: Record<string, unknown>): ValidatedProbe {
  const managementUrl = optionalString(raw.managementUrl, "managementUrl");
  if (managementUrl) {
    if (!isAbsoluteHttpUrl(managementUrl)) {
      throw validationError("Validation failed", { managementUrl: ["managementUrl must be an absolute http(s) URL"] });
    }
    const user = requireString(raw.user, "user");
    return { url: managementUrl, address: managementUrl, latencyBudgetMs: null, config: { managementUrl, user } };
  }
  const host = requireHost(raw.host);
  const port = raw.port === undefined ? 5672 : requirePort(raw.port);
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port } };
}

function validateSqlite(raw: Record<string, unknown>): ValidatedProbe {
  const file = requireString(raw.path, "path");
  if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file) || file.split(/[/\\]/).includes("..")) {
    throw validationError("Validation failed", { path: ["path must stay inside the sqlite probe root"] });
  }
  return { url: file, address: file, latencyBudgetMs: null, config: { path: file } };
}

function validateMemcached(raw: Record<string, unknown>): ValidatedProbe {
  const host = requireHost(raw.host);
  const port = raw.port === undefined ? 11211 : requirePort(raw.port);
  const address = `${host}:${port}`;
  return { url: address, address, latencyBudgetMs: null, config: { host, port } };
}

function validateEtcd(raw: Record<string, unknown>): ValidatedProbe {
  const url = requireString(raw.url, "url");
  if (!isAbsoluteHttpUrl(url)) {
    throw validationError("Validation failed", { url: ["url must be an absolute http(s) URL"] });
  }
  return { url, address: url, latencyBudgetMs: null, config: { url } };
}

function validateFlow(raw: Record<string, unknown>): ValidatedProbe {
  const steps = raw.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 5) {
    throw validationError("Validation failed", { steps: ["steps must contain 1 to 5 HTTP steps"] });
  }
  const normalized = steps.map((step, index) => normalizeFlowStep(step, index));
  const firstUrl = normalized[0]?.url;
  const first = typeof firstUrl === "string" ? firstUrl : "";
  return { url: first, address: first, latencyBudgetMs: null, config: { steps: normalized } };
}

function normalizeFlowStep(step: unknown, index: number): Record<string, unknown> {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw validationError("Validation failed", { steps: [`step ${index + 1} must be an object`] });
  }
  const raw = step as Record<string, unknown>;
  const url = requireString(raw.url, "url");
  if (!isAbsoluteHttpUrl(url)) {
    throw validationError("Validation failed", { url: [`step ${index + 1} url must be absolute`] });
  }
  const method = raw.method === undefined ? "GET" : raw.method;
  if (method !== "GET" && method !== "POST") {
    throw validationError("Validation failed", { method: [`step ${index + 1} method must be GET or POST`] });
  }
  return {
    url,
    method,
    headers: raw.headers === undefined ? {} : raw.headers,
    headerTemplate: raw.headerTemplate === undefined ? {} : raw.headerTemplate,
    expectedStatus: optionalString(raw.expectedStatus, "expectedStatus"),
    bodyIncludes: optionalString(raw.bodyIncludes, "bodyIncludes"),
    jsonPath: optionalString(raw.jsonPath, "jsonPath"),
    jsonEquals: optionalString(raw.jsonEquals, "jsonEquals"),
    saveJsonPath: optionalString(raw.saveJsonPath, "saveJsonPath"),
  };
}

function requireHost(value: unknown): string {
  const host = requireString(value, "host");
  if (host.length > 253 || /[\s/]/.test(host)) {
    throw validationError("Validation failed", { host: ["host must be a hostname or address"] });
  }
  return host;
}

function validateK8s(kind: string, raw: Record<string, unknown>): ValidatedProbe {
  const namespace = requireDnsName(raw.namespace, "namespace");
  if (kind === "k8s.ingressCert") {
    const ingressName = requireDnsName(raw.ingressName, "ingressName");
    const warnDays = raw.warnDays === undefined ? 21 : requirePositiveInt(raw.warnDays, "warnDays");
    const downDays = raw.downDays === undefined ? 3 : requirePositiveInt(raw.downDays, "downDays");
    if (warnDays <= downDays) {
      throw validationError("Validation failed", { warnDays: ["warnDays must be greater than downDays"] });
    }
    return {
      url: `${namespace}/${ingressName}`,
      address: `${namespace}/${ingressName}`,
      latencyBudgetMs: null,
      config: { namespace, ingressName, warnDays, downDays },
    };
  }
  const name = requireDnsName(raw.name, "name");
  if (kind === "k8s.cronjob") {
    const maxAgeSeconds = requirePositiveInt(raw.maxAgeSeconds, "maxAgeSeconds");
    return {
      url: `${namespace}/${name}`,
      address: `${namespace}/${name}`,
      latencyBudgetMs: null,
      config: { namespace, name, maxAgeSeconds },
    };
  }
  return {
    url: `${namespace}/${name}`,
    address: `${namespace}/${name}`,
    latencyBudgetMs: null,
    config: { namespace, name },
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) => HEADER_NAME.test(key) && typeof entry === "string");
}

function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("Validation failed", { [field]: [`${field} must be a string`] });
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  const text = optionalString(value, field);
  if (!text) throw validationError("Validation failed", { [field]: [`${field} is required`] });
  return text;
}

function requireDnsName(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (text.length > 253 || text.split(".").some((label) => label.length < 1 || label.length > 63 || !DNS_NAME.test(label))) {
    throw validationError("Validation failed", { [field]: [`${field} must be a DNS name`] });
  }
  return text;
}

function requirePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw validationError("Validation failed", { port: ["port must be an integer from 1 to 65535"] });
  }
  return value;
}

function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw validationError("Validation failed", { [field]: [`${field} must be a positive integer`] });
  }
  return value;
}
