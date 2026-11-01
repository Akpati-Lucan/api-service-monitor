import net from "node:net";
import tls from "node:tls";
import type { CheckResult } from "../types/index.js";
import { thrownCheck } from "./thrown.js";
import type { Probe, ProbeContext, ProbeTarget } from "./types.js";
import { classifyCertificate, daysUntil } from "./windows.js";

export interface TlsProbeOptions {
  rejectUnauthorized?: boolean;
}

export function createTlsProbe(options: TlsProbeOptions = {}): Probe {
  const rejectUnauthorized = options.rejectUnauthorized !== false;
  return {
    kind: "tls",
    check(target, ctx) {
      const host = typeof target.config.host === "string" ? target.config.host : "";
      const port = typeof target.config.port === "number" ? target.config.port : 443;
      const warnDays = typeof target.config.warnDays === "number" ? target.config.warnDays : 21;
      const downDays = typeof target.config.downDays === "number" ? target.config.downDays : 3;
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
        const socket = tls.connect({
          host,
          port,
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized,
        });
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
        socket.once("secureConnect", () => {
          const certificate = socket.getPeerCertificate();
          const notAfter = certificate.valid_to ? new Date(certificate.valid_to) : null;
          if (!notAfter || Number.isNaN(notAfter.getTime())) {
            finish({
              ok: false,
              status: "DOWN",
              responseTimeMs: Date.now() - startedAt,
              errorClass: "tls",
              error: "peer certificate missing",
            });
            return;
          }
          const judged = classifyCertificate(daysUntil(notAfter, new Date()), warnDays, downDays);
          finish({ ...judged, responseTimeMs: Date.now() - startedAt });
        });
        socket.once("error", (error) => {
          if (settled) return;
          finish(thrownCheck(error, Date.now() - startedAt));
        });
      });
    },
  };
}

export const tlsProbe = createTlsProbe();
