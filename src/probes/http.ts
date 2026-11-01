import type { CheckResult, ErrorClass } from "../types/index.js";
import { scrubSecret } from "./secrets.js";
import type { Probe, ProbeContext, ProbeTarget } from "./types.js";

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

function classifyThrown(error: unknown, responseTimeMs: number, secret?: string): CheckResult {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = scrubSecret(rawMessage, secret);
  const aborted = error instanceof Error && error.name === "AbortError";

  if (aborted) {
    return {
      ok: false,
      status: "DOWN",
      responseTimeMs,
      errorClass: "timeout",
      error: message,
    };
  }

  const code = errorCode(error);
  let errorClass: ErrorClass = "unknown";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    errorClass = "dns";
  } else if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  ) {
    errorClass = "network";
  }

  return {
    ok: false,
    status: "DOWN",
    responseTimeMs,
    errorClass,
    error: message,
  };
}

export const httpProbe: Probe = {
  kind: "http",
  async check(target: ProbeTarget, ctx: ProbeContext): Promise<CheckResult> {
    const startedAt = Date.now();
    const secretHeader = target.config.secretHeader;
    if (typeof secretHeader === "string" && secretHeader.length > 0 && !ctx.secret) {
      return {
        ok: false,
        status: "DOWN",
        responseTimeMs: 0,
        errorClass: "auth",
        error: "secret not available",
      };
    }

    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
    if (typeof secretHeader === "string" && secretHeader.length > 0 && ctx.secret) {
      headers[secretHeader] = ctx.secret;
    }

    try {
      const response = await fetch(target.address, {
        method: "GET",
        headers,
        signal: ctx.signal,
        redirect: "follow",
      });
      const responseTimeMs = Date.now() - startedAt;

      if (response.ok) {
        const budget = target.config.latencyBudgetMs;
        if (typeof budget === "number" && responseTimeMs > budget) {
          return {
            ok: false,
            status: "DEGRADED",
            httpStatus: response.status,
            responseTimeMs,
            evidence: { latencyBudgetMs: budget },
          };
        }

        return {
          ok: true,
          status: "UP",
          httpStatus: response.status,
          responseTimeMs,
        };
      }

      return {
        ok: false,
        status: "DOWN",
        httpStatus: response.status,
        responseTimeMs,
        errorClass: "http_status",
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return classifyThrown(error, Date.now() - startedAt, ctx.secret);
    }
  },
};
