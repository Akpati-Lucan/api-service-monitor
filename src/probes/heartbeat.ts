import type { CheckResult } from "../types/index.js";
import type { Probe } from "./types.js";

export const heartbeatProbe: Probe = {
  kind: "heartbeat",
  async check(target): Promise<CheckResult> {
    const graceSeconds = typeof target.config.graceSeconds === "number" ? target.config.graceSeconds : 0;
    const createdAt = typeof target.config.createdAt === "string" ? Date.parse(target.config.createdAt) : Number.NaN;
    const now = typeof target.config.now === "string" ? Date.parse(target.config.now) : Date.now();
    const lastPing = typeof target.config.lastPingAt === "string" ? Date.parse(target.config.lastPingAt) : null;
    if (!Number.isFinite(graceSeconds) || graceSeconds < 1 || !Number.isFinite(createdAt) || !Number.isFinite(now)) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }

    const graceMs = graceSeconds * 1000;
    const missed = lastPing == null
      ? now > createdAt + graceMs
      : now > lastPing + graceMs;
    if (missed) {
      return {
        ok: false,
        status: "DOWN",
        responseTimeMs: 0,
        errorClass: "missed_heartbeat",
        error: "missed heartbeat",
        evidence: { graceSeconds },
      };
    }
    return { ok: true, status: "UP", responseTimeMs: 0, evidence: { graceSeconds } };
  },
};
