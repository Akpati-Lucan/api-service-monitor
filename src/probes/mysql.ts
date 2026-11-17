import type { CheckResult } from "../types/index.js";
import { classifyDriverError, missingSecret, raceAbort } from "./driverError.js";
import type { Probe } from "./types.js";

// MariaDB uses this module. `config.variant` is only prefixed onto the incident text.
export const mysqlProbe: Probe = {
  kind: "mysql",
  async check(target, ctx): Promise<CheckResult> {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return label(missingSecret(0), target.config.variant);
    }
    const host = typeof target.config.host === "string" ? target.config.host : "";
    const port = typeof target.config.port === "number" ? target.config.port : 3306;
    const user = typeof target.config.user === "string" ? target.config.user : "";
    const database = typeof target.config.database === "string" ? target.config.database : undefined;
    if (!host || !user) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }

    const mysql = await import("mysql2/promise");
    let connection: Awaited<ReturnType<typeof mysql.createConnection>> | undefined;
    const stop = () => connection?.destroy();
    ctx.signal.addEventListener("abort", stop, { once: true });
    try {
      connection = await raceAbort(ctx.signal, mysql.createConnection({
        host,
        port,
        user,
        password: ctx.secret,
        database,
        connectTimeout: ctx.timeoutMs,
        ssl: target.config.ssl === "require" ? { rejectUnauthorized: true } : undefined,
      }));
      await raceAbort(ctx.signal, connection.query("SELECT 1"));
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      return label(classifyDriverError(error, Date.now() - startedAt, ctx.secret, ctx.signal), target.config.variant);
    } finally {
      ctx.signal.removeEventListener("abort", stop);
      stop();
    }
  },
};

function label(result: CheckResult, variant: unknown): CheckResult {
  if (!result.error || (variant !== "mysql" && variant !== "mariadb")) return result;
  return { ...result, error: `${variant}: ${result.error}` };
}
