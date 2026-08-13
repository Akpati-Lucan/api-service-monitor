import type { CheckResult } from "../types/index.js";

export interface CheckOptions {
  timeoutMs: number;
}

export async function performCheck(url: string, options: CheckOptions): Promise<CheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: controller.signal,
      redirect: "follow",
    });

    const responseTimeMs = Date.now() - startedAt;

    if (response.ok) {
      return {
        ok: true,
        httpStatus: response.status,
        responseTimeMs,
      };
    }

    return {
      ok: false,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status}`,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Unknown error";

    return {
      ok: false,
      responseTimeMs,
      error: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
