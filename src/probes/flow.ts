import type { CheckResult } from "../types/index.js";
import { readJsonPath, statusAllowed } from "./http.js";
import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";

export const httpFlowProbe: Probe = {
  kind: "http.flow",
  async check(target, ctx) {
    const startedAt = Date.now();
    const deadline = startedAt + ctx.timeoutMs;
    const steps = Array.isArray(target.config.steps) ? target.config.steps : [];
    const saved: Record<string, string> = {};
    let last: CheckResult = { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (!step || typeof step !== "object") {
        return scrubbed({ ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "unknown", error: "invalid probe config" }, saved);
      }
      const record = step as Record<string, unknown>;
      const remaining = deadline - Date.now();
      if (remaining <= 0 || ctx.signal.aborted) {
        return scrubbed({ ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "timeout", error: "timeout" }, saved);
      }
      last = await runStep(record, saved, ctx.signal, remaining);
      if (!last.ok || last.status !== "UP") {
        return scrubbed({ ...last, error: last.error ? `step ${index + 1}: ${last.error}` : last.error }, saved);
      }
      const savePath = record.saveJsonPath;
      if (typeof savePath === "string" && last.evidence && typeof last.evidence.saved === "string") {
        saved[savePath] = last.evidence.saved;
      }
      delete last.evidence;
    }

    return scrubbed({ ...last, responseTimeMs: Date.now() - startedAt }, saved);
  },
};

async function runStep(
  step: Record<string, unknown>,
  saved: Record<string, string>,
  parent: AbortSignal,
  remainingMs: number,
): Promise<CheckResult & { evidence?: { saved?: string } }> {
  const startedAt = Date.now();
  const url = typeof step.url === "string" ? step.url : "";
  if (!url) {
    return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);
  const onAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  const headers = applyTemplates(step.headers, step.headerTemplate, saved);
  try {
    const response = await fetch(url, {
      method: step.method === "POST" ? "POST" : "GET",
      headers,
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - startedAt;
    const expected = typeof step.expectedStatus === "string" ? step.expectedStatus : undefined;
    if (!statusAllowed(response.status, expected)) {
      await response.body?.cancel();
      return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "http_status", error: `HTTP ${response.status}` };
    }
    const body = await response.text();
    if (typeof step.bodyIncludes === "string" && !body.includes(step.bodyIncludes)) {
      return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "assertion", error: "response body did not include the expected text" };
    }
    let savedValue: string | undefined;
    if (typeof step.jsonPath === "string" || typeof step.saveJsonPath === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "assertion", error: "response body was not json" };
      }
      if (typeof step.jsonPath === "string") {
        const found = readJsonPath(parsed, step.jsonPath);
        if (!found.found) {
          return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "assertion", error: "json path was not found" };
        }
        if (typeof step.jsonEquals === "string" && String(found.value) !== step.jsonEquals) {
          return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "assertion", error: "json value did not match" };
        }
      }
      if (typeof step.saveJsonPath === "string") {
        const found = readJsonPath(parsed, step.saveJsonPath);
        if (!found.found || (typeof found.value !== "string" && typeof found.value !== "number")) {
          return { ok: false, status: "DOWN", httpStatus: response.status, responseTimeMs, errorClass: "assertion", error: "saved json path was not found" };
        }
        savedValue = String(found.value);
      }
    }
    return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs, evidence: savedValue ? { saved: savedValue } : undefined };
  } catch (error) {
    return thrownCheck(error, Date.now() - startedAt);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
  }
}

function applyTemplates(
  headers: unknown,
  templates: unknown,
  saved: Record<string, string>,
): Record<string, string> {
  const source = { ...(isStringMap(headers) ? headers : {}), ...(isStringMap(templates) ? templates : {}) };
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    next[key] = value.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (_match, name: string) => saved[name] ?? "");
  }
  return next;
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function scrubbed(result: CheckResult, saved: Record<string, string>): CheckResult {
  if (!result.error) {
    const { evidence: _evidence, ...rest } = result;
    return rest;
  }
  let error = result.error;
  for (const value of Object.values(saved)) {
    if (value) error = error.split(value).join("[redacted]");
  }
  const { evidence: _evidence, ...rest } = result;
  return { ...rest, error };
}
