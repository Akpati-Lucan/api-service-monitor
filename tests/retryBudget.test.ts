import { describe, expect, it } from "vitest";
import { retryBudgetFits, worstCaseRetryMs } from "../src/utils/retryBudget.js";

describe("retry budget", () => {
  it("adds every attempt and the exponential delays", () => {
    expect(worstCaseRetryMs({
      timeoutMs: 5000,
      retries: 2,
      baseDelayMs: 1000,
      factor: 2,
    })).toBe(18000);

    expect(worstCaseRetryMs({
      timeoutMs: 1000,
      retries: 3,
      baseDelayMs: 250,
      factor: 1,
    })).toBe(4750);
  });

  it("requires the worst case to finish inside the interval", () => {
    const tight = {
      timeoutMs: 5000,
      retries: 3,
      baseDelayMs: 250,
      factor: 2,
      intervalSeconds: 5,
    };
    const roomy = { ...tight, intervalSeconds: 30 };

    expect(retryBudgetFits(tight)).toBe(false);
    expect(retryBudgetFits(roomy)).toBe(true);
  });
});