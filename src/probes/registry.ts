import { httpProbe } from "./http.js";
import type { Probe } from "./types.js";

export interface ProbeRegistry {
  register(probe: Probe): void;
  get(kind: string): Probe | undefined;
  kinds(): string[];
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

export function createDefaultProbeRegistry(enabled: readonly string[]): ProbeRegistry {
  const registry = createProbeRegistry();
  if (enabled.includes(httpProbe.kind)) {
    registry.register(httpProbe);
  }
  return registry;
}
