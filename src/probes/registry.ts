import { dnsProbe } from "./dns.js";
import { domainProbe } from "./domain.js";
import { elasticProbe } from "./elastic.js";
import { etcdProbe } from "./etcd.js";
import { httpFlowProbe } from "./flow.js";
import { heartbeatProbe } from "./heartbeat.js";
import { httpProbe } from "./http.js";
import { createInClusterK8sClient, createK8sProbe, isK8sKind, type K8sClient } from "./k8s.js";
import { memcachedProbe } from "./memcached.js";
import { mongodbProbe } from "./mongodb.js";
import { mysqlProbe } from "./mysql.js";
import { postgresProbe } from "./postgres.js";
import { rabbitmqProbe } from "./rabbitmq.js";
import { redisProbe } from "./redis.js";
import { s3Probe } from "./s3.js";
import { sqliteProbe } from "./sqlite.js";
import { tcpProbe } from "./tcp.js";
import { tlsProbe } from "./tls.js";

// These catalog rows are not loaded in the default image.
// mssql is not loaded.
// oracle is not loaded.
// kafka is not loaded.
// dynamodb is not loaded.
// cosmos is not loaded.
// sqs is not loaded.
// pubsub is not loaded.
// servicebus is not loaded.
// azureblob is not loaded.
// gcs is not loaded.
// azureSearch is not loaded.
// googleSearch is not loaded.
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
  postgres: postgresProbe,
  mysql: mysqlProbe,
  mongodb: mongodbProbe,
  redis: redisProbe,
  dns: dnsProbe,
  domain: domainProbe,
  s3: s3Probe,
  elastic: elasticProbe,
  rabbitmq: rabbitmqProbe,
  sqlite: sqliteProbe,
  memcached: memcachedProbe,
  etcd: etcdProbe,
  "http.flow": httpFlowProbe,
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
