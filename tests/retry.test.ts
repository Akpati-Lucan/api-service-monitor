import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableCheck, retry, retryCheck } from "../src/utils/retry.js";

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

  it("retries a timeout result and keeps only the final check", async () => {
    const operation = vi.fn(async () => ({
      ok: false as const,
      status: "DOWN" as const,
      responseTimeMs: 5,
      errorClass: "timeout" as const,
      error: "timeout",
    }));

    const pending = retryCheck(operation, { retries: 2, baseDelayMs: 10, factor: 2 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(operation).toHaveBeenCalledTimes(3);
    expect(result.errorClass).toBe("timeout");
  });

  it("does not retry auth, assertion, or an HTTP 4xx", async () => {
    const auth = vi.fn(async () => ({
      ok: false as const,
      status: "DOWN" as const,
      responseTimeMs: 1,
      errorClass: "auth" as const,
      error: "secret not available",
    }));

    const pending = retryCheck(auth, { retries: 3, baseDelayMs: 10, factor: 2 });
    await vi.runAllTimersAsync();
    await pending;
    expect(auth).toHaveBeenCalledTimes(1);

    expect(isRetryableCheck({
      ok: false,
      status: "DOWN",
      responseTimeMs: 1,
      errorClass: "http_status",
      httpStatus: 500,
      error: "HTTP 500",
    })).toBe(true);
    expect(isRetryableCheck({
      ok: false,
      status: "DOWN",
      responseTimeMs: 1,
      errorClass: "http_status",
      httpStatus: 404,
      error: "HTTP 404",
    })).toBe(false);
    expect(isRetryableCheck({
      ok: false,
      status: "DEGRADED",
      responseTimeMs: 50,
      errorClass: "timeout",
    })).toBe(false);
  });
});
