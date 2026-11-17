import type { Probe } from "./types.js";
import { classifyDriverError, missingSecret, raceAbort } from "./driverError.js";

export const redisProbe: Probe = {
  kind: "redis",
  async check(target, ctx) {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return missingSecret(0);
    }
    const host = typeof target.config.host === "string" ? target.config.host : "";
    const port = typeof target.config.port === "number" ? target.config.port : 6379;
    if (!host) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }

    const { createClient } = await import("redis");
    const client = createClient({
      password: ctx.secret,
      socket: {
        host,
        port,
        tls: target.config.tls === true,
        connectTimeout: ctx.timeoutMs,
        reconnectStrategy: false,
      },
    });
    client.on("error", () => undefined);
    const stop = () => {
      void client.disconnect().catch(() => undefined);
    };
    ctx.signal.addEventListener("abort", stop, { once: true });
    try {
      await raceAbort(ctx.signal, client.connect());
      const reply = await raceAbort(ctx.signal, client.ping());
      if (reply !== "PONG") {
        return {
          ok: false,
          status: "DOWN",
          responseTimeMs: Date.now() - startedAt,
          errorClass: "query",
          error: "redis ping was not answered",
        };
      }
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      return classifyDriverError(error, Date.now() - startedAt, ctx.secret, ctx.signal);
    } finally {
      ctx.signal.removeEventListener("abort", stop);
      stop();
    }
  },
};
