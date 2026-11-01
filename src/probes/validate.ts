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
