import net from "node:net";
import type { Probe } from "./types.js";

export const memcachedProbe: Probe = {
  kind: "memcached",
  check(target, ctx) {
    const host = typeof target.config.host === "string" ? target.config.host : "";
    const port = typeof target.config.port === "number" ? target.config.port : 11211;
    const startedAt = Date.now();
    if (!host) {
      return Promise.resolve({ ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" });
    }
    if (ctx.signal.aborted) {
      return Promise.resolve({ ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "timeout", error: "timeout" });
    }
    return new Promise((resolve) => {
      let settled = false;
      const socket = net.connect({ host, port });
      const finish = (result: { ok: boolean; status: "UP" | "DOWN"; responseTimeMs: number; errorClass?: "network" | "timeout" | "query"; error?: string }) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener("abort", onAbort);
        socket.destroy();
        resolve(result);
      };
      const onAbort = () => finish({ ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "timeout", error: "timeout" });
      ctx.signal.addEventListener("abort", onAbort);
      socket.setTimeout(ctx.timeoutMs);
      socket.once("timeout", onAbort);
      socket.once("error", (error: NodeJS.ErrnoException) => {
        const refused = error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "EHOSTUNREACH";
        finish({
          ok: false,
          status: "DOWN",
          responseTimeMs: Date.now() - startedAt,
          errorClass: refused ? "network" : "query",
          error: refused ? "connection refused" : "memcached version failed",
        });
      });
      socket.once("data", (chunk) => {
        const text = chunk.toString("utf8");
        if (text.startsWith("VERSION ")) {
          finish({ ok: true, status: "UP", responseTimeMs: Date.now() - startedAt });
          return;
        }
        finish({ ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "query", error: "memcached version failed" });
      });
      socket.once("connect", () => socket.write("version\r\n"));
    });
  },
};
