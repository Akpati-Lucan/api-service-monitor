import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retry } from "../src/utils/retry.js";

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries the expected number of times", async () => {
    const attempts: number[] = [];
    const operation = vi.fn(async () => {
      attempts.push(Date.now());
      throw new Error("fail");
    });

    const promise = retry(operation, { retries: 2, baseDelayMs: 100, factor: 2 });
    promise.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("fail");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("succeeds before exhausting retries", async () => {
    let count = 0;
    const operation = vi.fn(async () => {
      count += 1;
      if (count < 2) {
        throw new Error("retry");
      }
      return "ok";
    });

    const p = retry(operation, { retries: 3, baseDelayMs: 10, factor: 2 });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff", async () => {
    const delays: number[] = [];
    const operation = vi.fn(async () => {
      throw new Error("fail");
    });

    const p = retry(operation, {
      retries: 3,
      baseDelayMs: 100,
      factor: 2,
      onRetry: (delayMs) => delays.push(delayMs),
    });
    p.catch(() => undefined);

    await vi.runAllTimersAsync();

    await expect(p).rejects.toThrow();
    expect(delays).toEqual([100, 200, 400]);
  });
});
