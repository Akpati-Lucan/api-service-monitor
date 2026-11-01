import type { CheckResult } from "../types/index.js";

export function classifyCertificate(days: number, warnDays: number, downDays: number): CheckResult {
  const evidence = { daysRemaining: days };
  if (days < downDays) {
    const error = days < 0 ? "certificate expired" : `certificate has ${days} days remaining`;
    return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "expired_certificate", error, evidence };
  }
  if (days <= warnDays) {
    return { ok: false, status: "DEGRADED", responseTimeMs: 0, evidence };
  }
  return { ok: true, status: "UP", responseTimeMs: 0, evidence };
}

export function daysUntil(notAfter: Date, now: Date): number {
  return Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);
}

export interface ReplicaCounts {
  replicas: number;
  readyReplicas: number;
}

export function classifyReplicas(counts: ReplicaCounts | null, responseTimeMs: number): CheckResult {
  if (!counts || counts.replicas < 1 || counts.readyReplicas <= 0) {
    const ready = counts?.readyReplicas ?? 0;
    const wanted = counts?.replicas ?? 0;
    return {
      ok: false,
      status: "DOWN",
      responseTimeMs,
      errorClass: "not_ready",
      error: counts ? `ready replicas ${ready} of ${wanted}` : "workload not found",
      evidence: { readyReplicas: ready, replicas: wanted },
    };
  }
  if (counts.readyReplicas < counts.replicas) {
    return {
      ok: false,
      status: "DEGRADED",
      responseTimeMs,
      evidence: { readyReplicas: counts.readyReplicas, replicas: counts.replicas },
    };
  }
  return {
    ok: true,
    status: "UP",
    responseTimeMs,
    evidence: { readyReplicas: counts.readyReplicas, replicas: counts.replicas },
  };
}
