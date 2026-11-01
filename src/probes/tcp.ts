import net from "node:net";
import type { CheckResult } from "../types/index.js";
import { thrownCheck } from "./thrown.js";
import type { Probe, ProbeContext, ProbeTarget } from "./types.js";

export const tcpProbe: Probe = {
  kind: "tcp",
  check(target, ctx) {
    const host = typeof target.config.host === "string" ? target.config.host : "";
    const port = typeof target.config.port === "number" ? target.config.port : 0;
    const startedAt = Date.now();
    if (!host || port < 1 || port > 65535) {
      return Promise.resolve({
        ok: false,
        status: "DOWN",
        responseTimeMs: 0,
        errorClass: "unknown",
        error: "invalid probe config",
      });
    }
    if (ctx.signal.aborted) {
      return Promise.resolve({ ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "timeout", error: "timeout" });
    }

    return new Promise<CheckResult>((resolve) => {
      let settled = false;
      const socket = net.connect({ host, port });
      const finish = (result: CheckResult) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener("abort", onAbort);
        socket.destroy();
        resolve(result);
      };
      const onAbort = () => {
        finish({ ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "timeout", error: "timeout" });
      };
      ctx.signal.addEventListener("abort", onAbort);
      socket.setTimeout(ctx.timeoutMs);
      socket.once("timeout", onAbort);
      socket.once("connect", () => {
        socket.end();
        finish({ ok: true, status: "UP", responseTimeMs: Date.now() - startedAt });
      });
      socket.once("error", (error) => {
        if (settled) return;
        finish(thrownCheck(error, Date.now() - startedAt));
      });
    });
  },
};

export function tcpTarget(config: { host: string; port: number }): ProbeTarget {
  return { kind: "tcp", address: `${config.host}:${config.port}`, config };
}
