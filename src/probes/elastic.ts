import type { CheckResult } from "../types/index.js";
import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";

export const elasticProbe: Probe = {
  kind: "elastic",
  async check(target, ctx) {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return authMissing(target.config.variant);
    }
    const address = typeof target.config.address === "string" ? target.config.address.replace(/\/$/, "") : "";
    if (!address) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (ctx.secret) {
      headers.authorization = ctx.secret.includes(":")
        ? `Basic ${Buffer.from(ctx.secret).toString("base64")}`
        : `ApiKey ${ctx.secret}`;
    }
    try {
      const response = await fetch(`${address}/_cluster/health`, { headers, signal: ctx.signal });
      const responseTimeMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return label({ ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "auth", error: `HTTP ${response.status}` }, target.config.variant);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return label({ ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "query", error: `HTTP ${response.status}` }, target.config.variant);
      }
      const body = await response.json() as { status?: unknown };
      const cluster = body.status;
      if (cluster === "green") {
        return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs };
      }
      if (cluster === "yellow") {
        return { ok: false, status: "DEGRADED", httpStatus: response.status, responseTimeMs, evidence: { cluster: "yellow" } };
      }
      return label({
        ok: false,
        status: "DOWN",
        httpStatus: response.status,
        responseTimeMs,
        errorClass: "query",
        error: `cluster ${typeof cluster === "string" ? cluster : "unknown"}`,
      }, target.config.variant);
    } catch (error) {
      return label(thrownCheck(error, Date.now() - startedAt, ctx.secret), target.config.variant);
    }
  },
};

function authMissing(variant: unknown): CheckResult {
  return label({ ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret not available" }, variant);
}

function label(result: CheckResult, variant: unknown): CheckResult {
  if (!result.error || (variant !== "elasticsearch" && variant !== "opensearch")) return result;
  return { ...result, error: `${variant}: ${result.error}` };
}
