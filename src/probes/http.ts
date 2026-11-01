import https from "node:https";
import type { CheckResult } from "../types/index.js";
import { thrownCheck } from "./thrown.js";
import type { Probe, ProbeContext, ProbeTarget } from "./types.js";

const BODY_LIMIT = 64 * 1024;

export function statusAllowed(status: number, spec: string | undefined): boolean {
  const source = spec && spec.trim().length > 0 ? spec : "200-299";
  return source.split(",").some((part) => {
    const piece = part.trim();
    const range = /^(\d{3})-(\d{3})$/.exec(piece);
    if (range) {
      return status >= Number(range[1]) && status <= Number(range[2]);
    }
    return /^\d{3}$/.test(piece) && status === Number(piece);
  });
}

export function readJsonPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || String(index) !== segment || current[index] === undefined) {
        return { found: false };
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function comparable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
  return JSON.stringify(value);
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < BODY_LIMIT) {
    const step = await reader.read();
    if (step.done) break;
    const slice = step.value.subarray(0, BODY_LIMIT - total);
    chunks.push(slice);
    total += slice.byteLength;
    if (total >= BODY_LIMIT) {
      await reader.cancel();
      break;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function insecureFetch(address: string, method: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      rejectUnauthorized: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        if (total >= 64 * 1024) return;
        const slice = chunk.subarray(0, 64 * 1024 - total);
        chunks.push(slice);
        total += slice.byteLength;
      });
      response.on("end", () => {
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0 }));
      });
    });
    const abort = () => {
      const error = new Error("timeout");
      error.name = "AbortError";
      request.destroy(error);
    };
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.end();
  });
}

function stringHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") headers[key] = entry;
  }
  return headers;
}

export const httpProbe: Probe = {
  kind: "http",
  async check(target: ProbeTarget, ctx: ProbeContext): Promise<CheckResult> {
    const startedAt = Date.now();
    const secretHeader = target.config.secretHeader;
    if (typeof secretHeader === "string" && secretHeader.length > 0 && !ctx.secret) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret not available" };
    }

    const method = target.config.method === "POST" ? "POST" : "GET";
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      ...stringHeaders(target.config.headers),
    };
    if (typeof secretHeader === "string" && secretHeader.length > 0 && ctx.secret) {
      headers[secretHeader] = ctx.secret;
    }

    const expected = typeof target.config.expectedStatus === "string" ? target.config.expectedStatus : undefined;
    const follow = target.config.followRedirects !== false;
    const skipVerify = target.config.tlsSkipVerify === true;

    try {
      const response = skipVerify
        ? await insecureFetch(target.address, method, headers, ctx.signal)
        : await fetch(target.address, {
          method,
          headers,
          signal: ctx.signal,
          redirect: follow ? "follow" : "manual",
        });
      const responseTimeMs = Date.now() - startedAt;
      if (!statusAllowed(response.status, expected)) {
        await response.body?.cancel();
        return {
          ok: false,
          status: "DOWN",
          httpStatus: response.status,
          responseTimeMs,
          errorClass: "http_status",
          error: `HTTP ${response.status}`,
        };
      }

      const needsBody = typeof target.config.bodyIncludes === "string" || typeof target.config.jsonPath === "string";
      if (needsBody) {
        const body = await readLimited(response);
        const included = target.config.bodyIncludes;
        if (typeof included === "string" && !body.includes(included)) {
          return {
            ok: false,
            status: "DOWN",
            httpStatus: response.status,
            responseTimeMs,
            errorClass: "assertion",
            error: "response body did not include the expected text",
          };
        }
        const jsonPath = target.config.jsonPath;
        if (typeof jsonPath === "string") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return {
              ok: false,
              status: "DOWN",
              httpStatus: response.status,
              responseTimeMs,
              errorClass: "assertion",
              error: "response body was not json",
            };
          }
          const found = readJsonPath(parsed, jsonPath);
          if (!found.found) {
            return {
              ok: false,
              status: "DOWN",
              httpStatus: response.status,
              responseTimeMs,
              errorClass: "assertion",
              error: "json path was not found",
            };
          }
          if (typeof target.config.jsonEquals === "string" && comparable(found.value) !== target.config.jsonEquals) {
            return {
              ok: false,
              status: "DOWN",
              httpStatus: response.status,
              responseTimeMs,
              errorClass: "assertion",
              error: "json value did not match",
            };
          }
        }
      } else {
        await response.body?.cancel();
      }

      const budget = target.config.latencyBudgetMs;
      if (typeof budget === "number" && responseTimeMs > budget) {
        return {
          ok: false,
          status: "DEGRADED",
          httpStatus: response.status,
          responseTimeMs,
          evidence: { latencyBudgetMs: budget },
        };
      }

      return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs };
    } catch (error) {
      return thrownCheck(error, Date.now() - startedAt, ctx.secret);
    }
  },
};
