import { randomBytes } from "node:crypto";
import type { DatabaseApi } from "../db/database.js";
import { hashToken } from "../auth/apiKeys.js";
import { validateProbeConfig } from "../probes/validate.js";
import type { AppConfig, Service, ServiceRole } from "../types/index.js";
import { conflict, notFound, notImplemented, validationError } from "../utils/errors.js";
import { retryBudgetFits, worstCaseRetryMs } from "../utils/retryBudget.js";
import { assertSecretRef } from "../probes/secrets.js";

export interface CreateMonitorInput {
  name: string;
  url?: string;
  intervalSeconds?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  successThreshold?: number;
  kind?: string;
  secretRef?: string;
  groupId?: string;
  role?: ServiceRole;
  config?: Record<string, unknown>;
  latencyBudgetMs?: number | null;
}

export interface CreatedMonitor extends Service {
  heartbeatToken?: string;
}

export function createMonitor(db: DatabaseApi, config: AppConfig, input: CreateMonitorInput): CreatedMonitor {
  const kind = input.kind ?? "http";
  if (!config.ENABLED_PROBES.includes(kind)) {
    throw notImplemented(`Probe kind ${kind} is not enabled`);
  }

  const intervalSeconds = input.intervalSeconds ?? config.DEFAULT_INTERVAL_SECONDS;
  const timeoutMs = input.timeoutMs ?? config.DEFAULT_TIMEOUT_MS;
  const failureThreshold = input.failureThreshold ?? config.DEFAULT_FAILURE_THRESHOLD;

  if (input.secretRef !== undefined) {
    assertSecretRef(input.secretRef);
  }

  if (input.groupId && !db.getGroup(input.groupId)) {
    throw notFound(`Group ${input.groupId} does not exist`);
  }

  const budgetInput = {
    timeoutMs,
    retries: config.RETRY_COUNT,
    baseDelayMs: config.RETRY_BASE_DELAY_MS,
    factor: config.RETRY_FACTOR,
    intervalSeconds,
  };

  if (!retryBudgetFits(budgetInput)) {
    const worstCase = Math.ceil(worstCaseRetryMs(budgetInput));
    throw validationError("Retry budget must finish inside the check interval", {
      intervalSeconds: [`worst case ${worstCase}ms does not fit in ${intervalSeconds}s`],
    });
  }

  const validated = validateProbeConfig({
    kind,
    url: input.url,
    config: input.config,
    latencyBudgetMs: input.latencyBudgetMs,
    intervalSeconds,
    nodeEnv: config.NODE_ENV,
  });

  const service = db.createService({
    name: input.name,
    url: validated.url,
    address: validated.address,
    intervalSeconds,
    timeoutMs,
    failureThreshold,
    successThreshold: input.successThreshold,
    kind,
    secretRef: input.secretRef ?? null,
    groupId: input.groupId,
    role: input.role,
    config: validated.config,
    latencyBudgetMs: validated.latencyBudgetMs,
  });

  if (kind !== "heartbeat") {
    return service;
  }

  const token = `hb_${randomBytes(32).toString("base64url")}`;
  const graceSeconds = Number(validated.config.graceSeconds);
  try {
    db.insertHeartbeat({ serviceId: service.id, tokenHash: hashToken(token), graceSeconds });
  } catch (error) {
    db.deactivateService(service.id);
    if (isConstraint(error)) {
      throw conflict("Heartbeat token is already in use");
    }
    throw error;
  }
  return { ...service, heartbeatToken: token };
}

function isConstraint(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && String(error.code).includes("CONSTRAINT"));
}
