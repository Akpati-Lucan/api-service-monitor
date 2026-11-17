import type { Probe } from "./types.js";
import { tcpProbe } from "./tcp.js";
import { thrownCheck } from "./thrown.js";

export const rabbitmqProbe: Probe = {
  kind: "rabbitmq",
  async check(target, ctx) {
    const startedAt = Date.now();
    const managementUrl = typeof target.config.managementUrl === "string" ? target.config.managementUrl : "";
    if (!managementUrl) {
      return tcpProbe.check(target, ctx);
    }
    if (target.config.secretExpected === true && !ctx.secret) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret not available" };
    }
    const user = typeof target.config.user === "string" ? target.config.user : "";
    const headers: Record<string, string> = { accept: "application/json" };
    if (user && ctx.secret) {
      headers.authorization = `Basic ${Buffer.from(`${user}:${ctx.secret}`).toString("base64")}`;
    }
    const url = managementUrl.replace(/\/$/, "");
    const health = url.includes("/api/health/checks/alarms") ? url : `${url}/api/health/checks/alarms`;
    try {
      const response = await fetch(health, { headers, signal: ctx.signal });
      const responseTimeMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "auth", error: `HTTP ${response.status}` };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "query", error: `HTTP ${response.status}` };
      }
      const body = await response.json() as { status?: unknown };
      if (body.status === "ok") {
        return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs };
      }
      return {
        ok: false,
        status: "DOWN",
        httpStatus: response.status,
        responseTimeMs,
        errorClass: "query",
        error: "rabbitmq reported an alarm",
      };
    } catch (error) {
      return thrownCheck(error, Date.now() - startedAt, ctx.secret);
    }
  },
};
