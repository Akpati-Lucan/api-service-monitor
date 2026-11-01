export interface RetryBudgetInput {
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  factor: number;
}

export function worstCaseRetryMs(input: RetryBudgetInput): number {
  const requestTime = input.timeoutMs * (input.retries + 1);
  const delay =
    input.factor === 1
      ? input.baseDelayMs * input.retries
      : input.baseDelayMs * ((input.factor ** input.retries - 1) / (input.factor - 1));

  return requestTime + delay;
}

export function retryBudgetFits(input: RetryBudgetInput & { intervalSeconds: number }): boolean {
  return worstCaseRetryMs(input) < input.intervalSeconds * 1000;
}
