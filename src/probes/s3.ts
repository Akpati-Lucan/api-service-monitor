import { createHash, createHmac } from "node:crypto";
import type { CheckResult } from "../types/index.js";
import type { Probe } from "./types.js";
import { thrownCheck } from "./thrown.js";

const EMPTY_PAYLOAD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const s3Probe: Probe = {
  kind: "s3",
  async check(target, ctx) {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return missing();
    }
    const bucket = typeof target.config.bucket === "string" ? target.config.bucket : "";
    const region = typeof target.config.region === "string" ? target.config.region : "";
    const endpoint = typeof target.config.endpoint === "string" ? target.config.endpoint : "";
    if (!bucket || !region) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    const credentials = ctx.secret ? readKeys(ctx.secret) : undefined;
    if (ctx.secret && !credentials) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret is not s3 credentials" };
    }

    const url = endpoint
      ? new URL(`${endpoint.replace(/\/$/, "")}/${encodeURIComponent(bucket)}`)
      : new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
    const headers: Record<string, string> = credentials
      ? signHead({
        host: url.host,
        path: url.pathname,
        region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        now: new Date(),
      })
      : {};

    try {
      const response = await fetch(url, { method: "HEAD", headers, signal: ctx.signal });
      const responseTimeMs = Date.now() - startedAt;
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 403) {
        return { ok: false, status: "DOWN", httpStatus: 403, responseTimeMs, errorClass: "auth", error: "HTTP 403" };
      }
      if (response.status === 404) {
        return { ok: false, status: "DOWN", httpStatus: 404, responseTimeMs, errorClass: "query", error: "HTTP 404" };
      }
      if (response.ok) {
        return { ok: true, status: "UP", httpStatus: response.status, responseTimeMs };
      }
      return {
        ok: false,
        status: "DOWN",
        httpStatus: response.status,
        responseTimeMs,
        errorClass: "query",
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return thrownCheck(error, Date.now() - startedAt, ctx.secret);
    }
  },
};

function missing(): CheckResult {
  return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "secret not available" };
}

function readKeys(secret: string): { accessKeyId: string; secretAccessKey: string } | undefined {
  try {
    const parsed = JSON.parse(secret) as { accessKeyId?: unknown; secretAccessKey?: unknown };
    if (typeof parsed.accessKeyId !== "string" || typeof parsed.secretAccessKey !== "string") return undefined;
    if (!parsed.accessKeyId || !parsed.secretAccessKey) return undefined;
    return { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey };
  } catch {
    return undefined;
  }
}

function signHead(input: {
  host: string;
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const canonicalHeaders = `host:${input.host}\nx-amz-content-sha256:${EMPTY_PAYLOAD}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = ["HEAD", input.path, "", canonicalHeaders, signedHeaders, EMPTY_PAYLOAD].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    "x-amz-content-sha256": EMPTY_PAYLOAD,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
