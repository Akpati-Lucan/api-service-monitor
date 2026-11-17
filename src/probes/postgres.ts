import type { CheckResult } from "../types/index.js";
import { classifyDriverError, missingSecret, raceAbort } from "./driverError.js";
import type { Probe } from "./types.js";

export const postgresProbe: Probe = {
  kind: "postgres",
  async check(target, ctx): Promise<CheckResult> {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return missingSecret(0);
    }
    const host = typeof target.config.host === "string" ? target.config.host : "";
    const port = typeof target.config.port === "number" ? target.config.port : 5432;
    const database = typeof target.config.database === "string" ? target.config.database : "";
    const user = typeof target.config.user === "string" ? target.config.user : "";
    if (!host || !database || !user) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }

    const { Client } = await import("pg");
    const client = new Client({
      host,
      port,
      database,
      user,
      password: ctx.secret,
      ssl: target.config.ssl === "require" ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: ctx.timeoutMs,
      query_timeout: ctx.timeoutMs,
    });
    const stop = () => {
      void client.end().catch(() => undefined);
    };
    ctx.signal.addEventListener("abort", stop, { once: true });
    try {
      await raceAbort(ctx.signal, (async () => {
        await client.connect();
        await client.query("SELECT 1");
      })());
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      return classifyDriverError(error, Date.now() - startedAt, ctx.secret, ctx.signal);
    } finally {
      ctx.signal.removeEventListener("abort", stop);
      stop();
    }
  },
};
