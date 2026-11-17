import { Resolver } from "node:dns/promises";
import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";

const TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT"]);

export const dnsProbe: Probe = {
  kind: "dns",
  async check(target, ctx) {
    const startedAt = Date.now();
    const name = typeof target.config.name === "string" ? target.config.name : "";
    const type = typeof target.config.type === "string" ? target.config.type : "";
    if (!name || !TYPES.has(type)) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    if (ctx.signal.aborted) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "timeout", error: "timeout" };
    }

    const resolver = new Resolver();
    const timer = setTimeout(() => resolver.cancel(), ctx.timeoutMs);
    const onAbort = () => resolver.cancel();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const records = await resolver.resolve(name, type);
      const rendered = JSON.stringify(records);
      const expected = target.config.expected;
      if (typeof expected === "string" && expected.length > 0 && !rendered.includes(expected)) {
        return {
          ok: false,
          status: "DOWN",
          responseTimeMs: Date.now() - startedAt,
          errorClass: "query",
          error: "dns answer did not match",
        };
      }
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ECANCELLED" || ctx.signal.aborted) {
        return { ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "timeout", error: "timeout" };
      }
      if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL" || code === "ENOTIMP") {
        return { ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "query", error: "dns lookup failed" };
      }
      if (code === "ETIMEOUT") {
        return { ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "timeout", error: "timeout" };
      }
      return thrownCheck(error, Date.now() - startedAt, ctx.secret);
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
};
