import type { CheckResult } from "../types/index.js";
import type { Logger } from "../utils/logger.js";

export interface ProbeContext {
  timeoutMs: number;
  signal: AbortSignal;
  secret?: string;
  log: Logger;
}

export interface ProbeTarget {
  kind: string;
  address: string;
  config: Record<string, unknown>;
}

export interface Probe {
  kind: string;
  check(target: ProbeTarget, ctx: ProbeContext): Promise<CheckResult>;
}
