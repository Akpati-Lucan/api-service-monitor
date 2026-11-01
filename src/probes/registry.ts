import { heartbeatProbe } from "./heartbeat.js";
import { httpProbe } from "./http.js";
import { createInClusterK8sClient, createK8sProbe, isK8sKind, type K8sClient } from "./k8s.js";
import { tcpProbe } from "./tcp.js";
import { tlsProbe } from "./tls.js";
import type { Probe } from "./types.js";

export interface ProbeRegistry {
  register(probe: Probe): void;
  get(kind: string): Probe | undefined;
  kinds(): string[];
}

export interface ProbeRegistryOptions {
  k8s?: K8sClient;
}

export function createProbeRegistry(): ProbeRegistry {
  const probes = new Map<string, Probe>();

  return {
    register(probe: Probe) {
      if (probes.has(probe.kind)) {
        throw new Error(`Probe kind already registered: ${probe.kind}`);
      }
      probes.set(probe.kind, probe);
    },
    get(kind: string) {
      return probes.get(kind);
    },
    kinds() {
      return [...probes.keys()];
    },
  };
}

const STATIC: Record<string, Probe> = {
  http: httpProbe,
  tcp: tcpProbe,
  tls: tlsProbe,
  heartbeat: heartbeatProbe,
};

export function createDefaultProbeRegistry(enabled: readonly string[], options: ProbeRegistryOptions = {}): ProbeRegistry {
  const registry = createProbeRegistry();
  let k8s = options.k8s;
  for (const kind of enabled) {
    const probe = STATIC[kind];
    if (probe) {
      registry.register(probe);
      continue;
    }
    if (isK8sKind(kind)) {
      k8s ??= createInClusterK8sClient();
      registry.register(createK8sProbe(kind, k8s));
    }
  }
  return registry;
}
