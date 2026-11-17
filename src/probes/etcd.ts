import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";

export const etcdProbe: Probe = {
  kind: "etcd",
  async check(target, ctx) {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret not available" };
    }
    const address = typeof target.config.url === "string" ? target.config.url.replace(/\/$/, "") : "";
    if (!address) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (ctx.secret) headers.authorization = `Bearer ${ctx.secret}`;
    try {
      const response = await fetch(`${address}/health`, { headers, signal: ctx.signal });
      const responseTimeMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "auth", error: `HTTP ${response.status}` };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "query", error: `HTTP ${response.status}` };
      }
      const body = await response.json() as { health?: unknown };
      if (body.health === true || body.health === "true") {
        return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs };
      }
      return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "query", error: "etcd is not healthy" };
    } catch (error) {
      return thrownCheck(error, Date.now() - startedAt, ctx.secret);
    }
  },
};
