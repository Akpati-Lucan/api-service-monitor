import type { CheckResult } from "../types/index.js";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  factor: number;
  onRetry?: (delayMs: number, attempt: number) => void;
}

const RETRYABLE_CLASSES = new Set(["timeout", "network", "dns"]);

export function isRetryableCheck(result: CheckResult): boolean {
  if (result.status !== "DOWN" || !result.errorClass) {
    return false;
  }

  if (RETRYABLE_CLASSES.has(result.errorClass)) {
    return true;
  }

  return result.errorClass === "http_status" && (result.httpStatus ?? 0) >= 500;
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= options.retries) {
        throw error;
      }

      const delayMs = options.baseDelayMs * Math.pow(options.factor, attempt);
      options.onRetry?.(delayMs, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Retry operation failed");
}

export async function retryCheck(
  operation: () => Promise<CheckResult>,
  options: RetryOptions,
): Promise<CheckResult> {
  let last: CheckResult | undefined;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    last = await operation();
    if (!isRetryableCheck(last) || attempt >= options.retries) {
      return last;
    }

    const delayMs = options.baseDelayMs * options.factor ** attempt;
    options.onRetry?.(delayMs, attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!last) {
    throw new Error("Retry operation failed");
  }

  return last;
}
