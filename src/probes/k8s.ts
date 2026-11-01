import https from "node:https";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { CheckResult } from "../types/index.js";
import type { Probe, ProbeContext } from "./types.js";
import { classifyCertificate, classifyReplicas, daysUntil, type ReplicaCounts } from "./windows.js";

export class K8sRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "K8sRequestError";
  }
}

export interface CronJobSnapshot {
  createdAt: string;
  lastSuccessfulTime: string | null;
  lastRunFailed: boolean;
}

export interface EndpointSnapshot {
  serviceExists: boolean;
  readyAddresses: number;
  notReadyAddresses: number;
  sliceCount: number;
}

export interface IngressCertSnapshot {
  missing: boolean;
  notAfter?: string;
}

export interface K8sClient {
  getDeployment(namespace: string, name: string, ctx: ProbeContext): Promise<ReplicaCounts | null>;
  getStatefulSet(namespace: string, name: string, ctx: ProbeContext): Promise<ReplicaCounts | null>;
  getCronJob(namespace: string, name: string, ctx: ProbeContext): Promise<CronJobSnapshot | null>;
  getEndpoints(namespace: string, name: string, ctx: ProbeContext): Promise<EndpointSnapshot | null>;
  getIngressCert(namespace: string, ingressName: string, ctx: ProbeContext): Promise<IngressCertSnapshot | null>;
}

export function classifyCronJob(snapshot: CronJobSnapshot | null, maxAgeSeconds: number, now: Date): CheckResult {
  if (!snapshot) {
    return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "not_ready", error: "workload not found" };
  }
  const maxAgeMs = maxAgeSeconds * 1000;
  const successAt = snapshot.lastSuccessfulTime ? Date.parse(snapshot.lastSuccessfulTime) : Number.NaN;
  const successInside = Number.isFinite(successAt) && now.getTime() - successAt <= maxAgeMs;
  if (successInside && !snapshot.lastRunFailed) {
    return { ok: true, status: "UP", responseTimeMs: 0, evidence: { maxAgeSeconds } };
  }
  if (successInside && snapshot.lastRunFailed) {
    return { ok: false, status: "DEGRADED", responseTimeMs: 0, evidence: { maxAgeSeconds } };
  }
  const createdAt = Date.parse(snapshot.createdAt);
  if (!Number.isFinite(successAt) && Number.isFinite(createdAt) && now.getTime() - createdAt <= maxAgeMs) {
    return { ok: true, status: "UP", responseTimeMs: 0, evidence: { maxAgeSeconds } };
  }
  return {
    ok: false,
    status: "DOWN",
    responseTimeMs: 0,
    errorClass: "not_ready",
    error: "no successful run inside the age",
    evidence: { maxAgeSeconds },
  };
}

export function classifyEndpoints(snapshot: EndpointSnapshot | null): CheckResult {
  if (!snapshot || !snapshot.serviceExists) {
    return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "not_ready", error: "workload not found" };
  }
  if (snapshot.readyAddresses > 0) {
    return {
      ok: true,
      status: "UP",
      responseTimeMs: 0,
      evidence: { readyAddresses: snapshot.readyAddresses },
    };
  }
  return {
    ok: false,
    status: "DOWN",
    responseTimeMs: 0,
    errorClass: "not_ready",
    error: snapshot.sliceCount === 0 ? "endpoint slices missing" : "no ready addresses",
    evidence: { readyAddresses: 0, notReadyAddresses: snapshot.notReadyAddresses },
  };
}

const KINDS = ["k8s.deployment", "k8s.statefulset", "k8s.cronjob", "k8s.endpoints", "k8s.ingressCert"] as const;
export type K8sKind = (typeof KINDS)[number];

export function isK8sKind(kind: string): kind is K8sKind {
  return (KINDS as readonly string[]).includes(kind);
}

export function createK8sProbe(kind: K8sKind, client: K8sClient): Probe {
  return {
    kind,
    async check(target, ctx) {
      const startedAt = Date.now();
      const namespace = typeof target.config.namespace === "string" ? target.config.namespace : "";
      const name = typeof target.config.name === "string" ? target.config.name : "";
      const ingressName = typeof target.config.ingressName === "string" ? target.config.ingressName : name;
      try {
        if (kind === "k8s.deployment" || kind === "k8s.statefulset") {
          const counts = kind === "k8s.deployment"
            ? await client.getDeployment(namespace, name, ctx)
            : await client.getStatefulSet(namespace, name, ctx);
          return withTime(classifyReplicas(counts, 0), startedAt);
        }
        if (kind === "k8s.cronjob") {
          const maxAgeSeconds = typeof target.config.maxAgeSeconds === "number" ? target.config.maxAgeSeconds : 0;
          const snapshot = await client.getCronJob(namespace, name, ctx);
          return withTime(classifyCronJob(snapshot, maxAgeSeconds, new Date()), startedAt);
        }
        if (kind === "k8s.endpoints") {
          return withTime(classifyEndpoints(await client.getEndpoints(namespace, name, ctx)), startedAt);
        }
        const cert = await client.getIngressCert(namespace, ingressName, ctx);
        if (!cert || cert.missing || !cert.notAfter) {
          return {
            ok: false,
            status: "DOWN",
            responseTimeMs: Date.now() - startedAt,
            errorClass: "expired_certificate",
            error: "certificate secret missing",
          };
        }
        const notAfter = new Date(cert.notAfter);
        const warnDays = typeof target.config.warnDays === "number" ? target.config.warnDays : 21;
        const downDays = typeof target.config.downDays === "number" ? target.config.downDays : 3;
        return withTime(classifyCertificate(daysUntil(notAfter, new Date()), warnDays, downDays), startedAt);
      } catch (error) {
        const responseTimeMs = Date.now() - startedAt;
        if (error instanceof K8sRequestError && error.status === 403) {
          return { ok: false, status: "DOWN", responseTimeMs, errorClass: "auth", error: "kubernetes rbac denied" };
        }
        if (error instanceof Error && error.name === "AbortError") {
          return { ok: false, status: "DOWN", responseTimeMs, errorClass: "timeout", error: "timeout" };
        }
        return {
          ok: false,
          status: "DOWN",
          responseTimeMs,
          errorClass: "network",
          error: "kubernetes api unavailable",
        };
      }
    },
  };
}

function withTime(result: CheckResult, startedAt: number): CheckResult {
  return { ...result, responseTimeMs: Date.now() - startedAt };
}

interface ApiResult {
  status: number;
  json: unknown;
}

export function createInClusterK8sClient(): K8sClient {
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
  const caPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

  async function get(path: string, ctx: ProbeContext): Promise<ApiResult> {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
    if (!host) {
      throw new Error("kubernetes api unavailable");
    }
    let token = "";
    let ca: Buffer;
    try {
      token = readFileSync(tokenPath, "utf8");
      ca = readFileSync(caPath);
    } catch {
      throw new Error("kubernetes api unavailable");
    }
    const result = await new Promise<ApiResult>((resolve, reject) => {
      const request = https.request({
        host,
        port: Number(port),
        path,
        method: "GET",
        ca,
        headers: { Authorization: `Bearer ${token}` },
        timeout: ctx.timeoutMs,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          if (text.length > 0) {
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      });
      const abort = () => {
        const error = new Error("timeout");
        error.name = "AbortError";
        request.destroy(error);
      };
      ctx.signal.addEventListener("abort", abort, { once: true });
      request.on("timeout", abort);
      request.on("error", reject);
      request.end();
    });
    if (result.status === 404) {
      return result;
    }
    if (result.status === 403) {
      throw new K8sRequestError(403, "kubernetes rbac denied");
    }
    if (result.status < 200 || result.status >= 300) {
      throw new K8sRequestError(result.status, "kubernetes api unavailable");
    }
    return result;
  }

  function replicas(body: unknown): ReplicaCounts {
    const record = body && typeof body === "object" ? body as { spec?: { replicas?: number }; status?: { readyReplicas?: number } } : {};
    return {
      replicas: record.spec?.replicas ?? 0,
      readyReplicas: record.status?.readyReplicas ?? 0,
    };
  }

  return {
    async getDeployment(namespace, name, ctx) {
      const result = await get(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, ctx);
      return result.status === 404 ? null : replicas(result.json);
    },
    async getStatefulSet(namespace, name, ctx) {
      const result = await get(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/statefulsets/${encodeURIComponent(name)}`, ctx);
      return result.status === 404 ? null : replicas(result.json);
    },
    async getCronJob(namespace, name, ctx) {
      const result = await get(`/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/cronjobs/${encodeURIComponent(name)}`, ctx);
      if (result.status === 404) return null;
      const body = result.json as {
        metadata?: { creationTimestamp?: string };
        status?: { lastSuccessfulTime?: string; lastScheduleTime?: string; active?: unknown[] };
      };
      const lastSuccessfulTime = body.status?.lastSuccessfulTime ?? null;
      const lastScheduleTime = body.status?.lastScheduleTime;
      const active = body.status?.active?.length ?? 0;
      return {
        createdAt: body.metadata?.creationTimestamp ?? new Date(0).toISOString(),
        lastSuccessfulTime,
        lastRunFailed: Boolean(lastScheduleTime) && lastScheduleTime !== lastSuccessfulTime && active === 0,
      };
    },
    async getEndpoints(namespace, name, ctx) {
      const service = await get(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}`, ctx);
      if (service.status === 404) {
        return { serviceExists: false, readyAddresses: 0, notReadyAddresses: 0, sliceCount: 0 };
      }
      const slices = await get(
        `/apis/discovery.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/endpointslices?labelSelector=${encodeURIComponent(`kubernetes.io/service-name=${name}`)}`,
        ctx,
      );
      const items = (slices.json as { items?: Array<{ endpoints?: Array<{ conditions?: { ready?: boolean } }> }> })?.items ?? [];
      let readyAddresses = 0;
      let notReadyAddresses = 0;
      for (const item of items) {
        for (const endpoint of item.endpoints ?? []) {
          if (endpoint.conditions?.ready) readyAddresses += 1;
          else notReadyAddresses += 1;
        }
      }
      return { serviceExists: true, readyAddresses, notReadyAddresses, sliceCount: items.length };
    },
    async getIngressCert(namespace, ingressName, ctx) {
      const ingress = await get(`/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/ingresses/${encodeURIComponent(ingressName)}`, ctx);
      if (ingress.status === 404) return null;
      const secretName = (ingress.json as { spec?: { tls?: Array<{ secretName?: string }> } }).spec?.tls?.find((item) => item.secretName)?.secretName;
      if (!secretName) return { missing: true };
      const secret = await get(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(secretName)}`, ctx);
      const crt = (secret.json as { data?: { "tls.crt"?: string } }).data?.["tls.crt"];
      if (secret.status === 404 || !crt) return { missing: true };
      const certificate = new X509Certificate(Buffer.from(crt, "base64"));
      return { missing: false, notAfter: new Date(certificate.validTo).toISOString() };
    },
  };
}
