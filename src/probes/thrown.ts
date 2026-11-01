import type { CheckResult, ErrorClass } from "../types/index.js";
import { scrubSecret } from "./secrets.js";

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  if ("cause" in error) {
    return errorCode(error.cause);
  }
  return undefined;
}

export function thrownCheck(error: unknown, responseTimeMs: number, secret?: string): CheckResult {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = scrubSecret(rawMessage, secret);
  const aborted = error instanceof Error && (error.name === "AbortError" || message === "aborted");
  if (aborted) {
    return { ok: false, status: "DOWN", responseTimeMs, errorClass: "timeout", error: message || "timeout" };
  }

  const code = errorCode(error) ?? "";
  let errorClass: ErrorClass = "unknown";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    errorClass = "dns";
  } else if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ECONNABORTED") {
    errorClass = "network";
  } else if (code.startsWith("ERR_TLS") || code.includes("CERT") || code.startsWith("UNABLE_TO_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR") {
    errorClass = "tls";
  }

  return { ok: false, status: "DOWN", responseTimeMs, errorClass, error: message };
}
