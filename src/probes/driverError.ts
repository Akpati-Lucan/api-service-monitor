import type { CheckResult, ErrorClass } from "../types/index.js";
import { scrubSecret } from "./secrets.js";
import { thrownCheck } from "./thrown.js";

const AUTH_CODES = new Set([
  "28P01",
  "28000",
  "ER_ACCESS_DENIED_ERROR",
  "ER_ACCESS_DENIED_NO_PASSWORD_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "1044",
  "1045",
  "18",
  "13",
]);

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNABORTED",
  "EPIPE",
  "57P03",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
]);

export function abortError(): Error {
  const error = new Error("timeout");
  error.name = "AbortError";
  return error;
}

export function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      timer = setTimeout(() => finish(() => reject(abortError())), 75);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function missingSecret(responseTimeMs: number): CheckResult {
  return {
    ok: false,
    status: "DOWN",
    responseTimeMs,
    errorClass: "auth",
    error: "secret not available",
  };
}

export function classifyDriverError(
  error: unknown,
  responseTimeMs: number,
  secret?: string,
  signal?: AbortSignal,
): CheckResult {
  if (isAbort(error)) {
    return { ok: false, status: "DOWN", responseTimeMs, errorClass: "timeout", error: "timeout" };
  }

  const codes = new Set<string>();
  const messages: string[] = [];
  walk(error, (value) => {
    if ("code" in value && (typeof value.code === "string" || typeof value.code === "number")) {
      codes.add(String(value.code));
    }
    if ("errno" in value && (typeof value.errno === "string" || typeof value.errno === "number")) {
      codes.add(String(value.errno));
    }
    if ("codeName" in value && typeof value.codeName === "string") {
      codes.add(value.codeName);
    }
    if ("message" in value && typeof value.message === "string") {
      messages.push(value.message);
    }
  });

  const message = scrubSecret(messages[0] ?? "check failed", secret);
  const errorClass = classify(codes, messages.join(" "));
  if (errorClass === "auth" || errorClass === "query" || errorClass === "network" || errorClass === "dns" || errorClass === "tls") {
    return { ok: false, status: "DOWN", responseTimeMs, errorClass, error: message };
  }
  if (errorClass === "timeout" || signal?.aborted) {
    return { ok: false, status: "DOWN", responseTimeMs, errorClass: "timeout", error: message || "timeout" };
  }
  return thrownCheck(error, responseTimeMs, secret);
}

function classify(codes: Set<string>, message: string): ErrorClass | undefined {
  if (has(codes, AUTH_CODES) || /authentication failed|password authentication failed|WRONGPASS|NOAUTH|access denied/i.test(message)) {
    return "auth";
  }
  if (has(codes, NETWORK_CODES)) {
    return "network";
  }
  if (has(codes, TIMEOUT_CODES) || /timeout|timed out/i.test(message)) {
    return "timeout";
  }
  if ([...codes].some((code) => /^[0-9A-Z]{5}$/.test(code) || code.startsWith("ER_"))) {
    return "query";
  }
  return undefined;
}

function has(codes: Set<string>, expected: Set<string>): boolean {
  for (const code of codes) {
    if (expected.has(code)) return true;
  }
  return false;
}

function isAbort(error: unknown): boolean {
  return walkSome(error, (value) => value instanceof Error && value.name === "AbortError");
}

function walk(error: unknown, visit: (value: object) => void, seen = new Set<unknown>()): void {
  if (!error || typeof error !== "object" || seen.has(error)) return;
  seen.add(error);
  visit(error);
  if ("cause" in error) walk(error.cause, visit, seen);
  if ("reason" in error) walk(error.reason, visit, seen);
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const item of error.errors) walk(item, visit, seen);
  }
}

function walkSome(error: unknown, test: (value: object) => boolean, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  if (test(error)) return true;
  if ("cause" in error && walkSome(error.cause, test, seen)) return true;
  if ("reason" in error && walkSome(error.reason, test, seen)) return true;
  if ("errors" in error && Array.isArray(error.errors)) {
    return error.errors.some((item) => walkSome(item, test, seen));
  }
  return false;
}
