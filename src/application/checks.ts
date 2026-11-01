import type { ProbeRegistry } from "../probes/registry.js";
import { resolveSecret } from "../probes/secrets.js";
import type { AlertSink } from "../services/alert.js";
import type { CheckResult, Service } from "../types/index.js";
import type { DatabaseApi } from "../db/database.js";
import type { Logger } from "../utils/logger.js";
import { retryCheck } from "../utils/retry.js";
import { evaluateIncident, type IncidentEffect } from "../incidents/evaluate.js";

export interface CheckCycleResult {
  result: CheckResult;
  effect: IncidentEffect;
  streak: number;
  incidentId?: string;
}

export async function runServiceCheck(input: {
  service: Service;
  streak: number;
  db: DatabaseApi;
  registry: ProbeRegistry;
  alerts: AlertSink;
  logger: Logger;
  retry: { retries: number; baseDelayMs: number; factor: number };
  now?: Date;
}): Promise<CheckCycleResult> {
  const now = input.now ?? new Date();
  const maintenance = input.db.isMaintenanceActive(input.service.id, input.service.groupId, now.toISOString());
  const result = await probeWithRetry(input);
  const saved = input.db.insertHealthCheck({
    serviceId: input.service.id,
    status: result.status,
    httpStatus: result.httpStatus ?? null,
    responseTimeMs: result.responseTimeMs,
    error: result.error ?? null,
    errorClass: result.errorClass ?? null,
    evidence: result.evidence ?? null,
    checkedAt: now.toISOString(),
  });

  if (maintenance) {
    return { result, effect: "none", streak: input.streak };
  }

  const open = input.db.getOpenIncident(input.service.id);
  const evaluation = evaluateIncident({
    streak: input.streak,
    incidentOpen: Boolean(open),
    status: result.status,
    failureThreshold: input.service.failureThreshold,
    successThreshold: input.service.successThreshold,
  });

  if (evaluation.effect === "open") {
    const reason = result.error ?? result.errorClass ?? "check failed";
    const incident = input.db.openIncident({
      serviceId: input.service.id,
      reason,
      startedAt: saved.checkedAt,
      errorClass: result.errorClass ?? null,
    });
    await input.alerts.notify({ service: input.service, incident, kind: "opened" });
    return { result, effect: "open", streak: evaluation.streak, incidentId: incident.id };
  }

  if (evaluation.effect === "resolve" && open) {
    input.db.resolveIncident(open.id, saved.checkedAt);
    const incident = input.db.getIncident(open.id) ?? { ...open, resolvedAt: saved.checkedAt };
    await input.alerts.notify({ service: input.service, incident, kind: "resolved" });
    return { result, effect: "resolve", streak: evaluation.streak, incidentId: open.id };
  }

  return { result, effect: "none", streak: evaluation.streak };
}

async function probeWithRetry(input: {
  service: Service;
  db: DatabaseApi;
  now?: Date;
  registry: ProbeRegistry;
  logger: Logger;
  retry: { retries: number; baseDelayMs: number; factor: number };
}): Promise<CheckResult> {
  const probe = input.registry.get(input.service.kind);
  if (!probe) {
    return {
      ok: false,
      status: "DOWN",
      responseTimeMs: 0,
      errorClass: "unknown",
      error: "invalid probe config",
    };
  }

  const secret = resolveSecret(input.service.secretRef);
  let lastClass: string | undefined;
  const config = probeConfig(input);

  return retryCheck(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.service.timeoutMs);
    try {
      const result = await probe.check(
        {
          kind: input.service.kind,
          address: input.service.address || input.service.url,
          config,
        },
        {
          timeoutMs: input.service.timeoutMs,
          signal: controller.signal,
          secret,
          log: input.logger,
        },
      );
      lastClass = result.errorClass;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }, {
    retries: input.retry.retries,
    baseDelayMs: input.retry.baseDelayMs,
    factor: input.retry.factor,
    onRetry: (delayMs, attempt) => {
      input.logger.debug(
        { serviceId: input.service.id, attempt, delayMs, errorClass: lastClass },
        "retrying check",
      );
    },
  });
}

function probeConfig(input: { service: Service; db: DatabaseApi; now?: Date }): Record<string, unknown> {
  const config: Record<string, unknown> = { ...input.service.config };
  if (input.service.latencyBudgetMs != null) {
    config.latencyBudgetMs = input.service.latencyBudgetMs;
  }
  if (input.service.kind !== "heartbeat") {
    return config;
  }
  const beat = input.db.getHeartbeat(input.service.id);
  return {
    graceSeconds: beat?.graceSeconds ?? config.graceSeconds,
    lastPingAt: beat?.lastPingAt ?? null,
    createdAt: input.service.createdAt,
    now: (input.now ?? new Date()).toISOString(),
  };
}
