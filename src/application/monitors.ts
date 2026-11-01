import type { DatabaseApi } from "../db/database.js";
import type { AppConfig, Service, ServiceRole } from "../types/index.js";
import { notFound, notImplemented, validationError } from "../utils/errors.js";
import { retryBudgetFits, worstCaseRetryMs } from "../utils/retryBudget.js";
import { assertSecretRef } from "../probes/secrets.js";

export interface CreateMonitorInput {
  name: string;
  url: string;
  intervalSeconds?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  successThreshold?: number;
  kind?: string;
  secretRef?: string;
  groupId?: string;
  role?: ServiceRole;
}

export function createMonitor(db: DatabaseApi, config: AppConfig, input: CreateMonitorInput): Service {
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

  return db.createService({
    name: input.name,
    url: input.url,
    intervalSeconds,
    timeoutMs,
    failureThreshold,
    successThreshold: input.successThreshold,
    kind,
    secretRef: input.secretRef ?? null,
    groupId: input.groupId,
    role: input.role,
  });
}
