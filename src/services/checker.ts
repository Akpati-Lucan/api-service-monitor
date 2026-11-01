import type { CheckResult } from "../types/index.js";
import { httpProbe } from "../probes/http.js";
import { createNoopLogger } from "../utils/logger.js";

export interface CheckOptions {
  timeoutMs: number;
}

export async function performCheck(url: string, options: CheckOptions): Promise<CheckResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    return await httpProbe.check(
      { kind: "http", address: url, config: {} },
      {
        timeoutMs: options.timeoutMs,
        signal: controller.signal,
        log: createNoopLogger(),
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
