export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  factor: number;
  onRetry?: (delayMs: number, attempt: number) => void;
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
