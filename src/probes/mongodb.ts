import type { Probe } from "./types.js";
import { classifyDriverError, missingSecret, raceAbort } from "./driverError.js";

export const mongodbProbe: Probe = {
  kind: "mongodb",
  async check(target, ctx) {
    const startedAt = Date.now();
    if (target.config.secretExpected === true && !ctx.secret) {
      return missingSecret(0);
    }
    const uri = typeof target.config.uri === "string" ? target.config.uri : "";
    if (!uri) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }

    const { MongoClient } = await import("mongodb");
    let client: InstanceType<typeof MongoClient> | undefined;
    const stop = () => {
      void client?.close().catch(() => undefined);
    };
    ctx.signal.addEventListener("abort", stop, { once: true });
    try {
      const username = decodeURIComponent(new URL(uri).username);
      const limit = Math.max(100, ctx.timeoutMs - 150);
      client = new MongoClient(uri, {
        auth: ctx.secret ? { username, password: ctx.secret } : undefined,
        serverSelectionTimeoutMS: limit,
        connectTimeoutMS: limit,
        socketTimeoutMS: limit,
        monitorCommands: false,
      });
      await raceAbort(ctx.signal, client.db("admin").command({ ping: 1 }));
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      return classifyDriverError(error, Date.now() - startedAt, ctx.secret, ctx.signal);
    } finally {
      ctx.signal.removeEventListener("abort", stop);
      stop();
    }
  },
};
