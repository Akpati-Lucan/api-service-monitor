import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";
import { daysUntil } from "./windows.js";

export const domainProbe: Probe = {
  kind: "domain",
  async check(target, ctx) {
    const startedAt = Date.now();
    const domain = typeof target.config.domain === "string" ? target.config.domain : "";
    const warnDays = typeof target.config.warnDays === "number" ? target.config.warnDays : 30;
    const downDays = typeof target.config.downDays === "number" ? target.config.downDays : 7;
    if (!domain) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    const base = typeof target.config.rdapBase === "string" && target.config.rdapBase.length > 0
      ? target.config.rdapBase.replace(/\/$/, "")
      : "https://rdap.org/domain";
    try {
      const response = await fetch(`${base}/${encodeURIComponent(domain)}`, {
        headers: { accept: "application/rdap+json, application/json" },
        signal: ctx.signal,
      });
      const responseTimeMs = Date.now() - startedAt;
      if (response.status === 404) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", responseTimeMs, errorClass: "query", error: "domain was not found" };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, status: "DOWN", responseTimeMs, errorClass: "query", error: `rdap status ${response.status}` };
      }
      const body = await response.json() as { events?: Array<{ eventAction?: string; eventDate?: string }> };
      const expiry = expiryDate(body.events ?? []);
      if (!expiry) {
        return { ok: false, status: "DOWN", responseTimeMs, errorClass: "query", error: "expiry date was not found" };
      }
      const days = daysUntil(expiry, new Date());
      const evidence = { daysRemaining: days };
      if (days < downDays) {
        return {
          ok: false,
          status: "DOWN",
          responseTimeMs,
          errorClass: "expired_domain",
          error: days < 0 ? "domain expired" : `domain has ${days} days remaining`,
          evidence,
        };
      }
      if (days <= warnDays) {
        return { ok: false, status: "DEGRADED", responseTimeMs, evidence };
      }
      return { ok: true, status: "UP", responseTimeMs, evidence };
    } catch (error) {
      return thrownCheck(error, Date.now() - startedAt);
    }
  },
};

function expiryDate(events: Array<{ eventAction?: string; eventDate?: string }>): Date | undefined {
  const dates = events
    .filter((event) => /expiration/i.test(event.eventAction ?? "") && event.eventDate)
    .map((event) => new Date(event.eventDate ?? ""))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) return undefined;
  return dates.sort((left, right) => left.getTime() - right.getTime())[0];
}
