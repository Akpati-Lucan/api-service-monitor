import type { Service } from "../types/index.js";
import type { DatabaseApi } from "../db/database.js";
import type { ProbeRegistry } from "../probes/registry.js";
import type { AlertSink } from "./alert.js";
import type { Logger } from "../utils/logger.js";
import { runServiceCheck, type CheckCycleResult } from "../application/checks.js";
import { conflict, notFound } from "../utils/errors.js";
import { rebuildStreak } from "../incidents/evaluate.js";

export interface Monitor {
  start(): void;
  stop(): void;
  registerService(service: Service): void;
  unregisterService(serviceId: string): void;
  isRunning(): boolean;
  activeServiceCount(): number;
  runOnce(serviceId: string): Promise<CheckCycleResult>;
  waitForIdle(timeoutMs: number): Promise<void>;
}

export interface MonitorDependencies {
  db: DatabaseApi;
  registry: ProbeRegistry;
  alerts: AlertSink;
  logger: Logger;
  retry: { retries: number; baseDelayMs: number; factor: number };
}

export class InMemoryMonitor implements Monitor {
  private readonly jobs = new Map<string, NodeJS.Timeout>();
  private readonly active = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly streaks = new Map<string, number>();
  private readonly idleWaiters: Array<() => void> = [];
  private running = false;
  private inflight = 0;

  constructor(private readonly deps: MonitorDependencies) {}

  start(): void {
    this.running = true;
    for (const service of this.deps.db.listServices()) {
      if (service.paused) {
        continue;
      }
      this.streaks.set(service.id, rebuildStreak(this.deps.db.getRecentHealthChecks(service.id, 50)));
      this.registerService(service);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.jobs.values()) {
      clearTimeout(timer);
    }
    this.jobs.clear();
  }

  registerService(service: Service): void {
    this.cancelled.delete(service.id);
    this.active.add(service.id);
    if (!this.streaks.has(service.id)) {
      this.streaks.set(service.id, rebuildStreak(this.deps.db.getRecentHealthChecks(service.id, 50)));
    }
    this.clearTimer(service.id);
    void this.execute(service.id);
  }

  unregisterService(serviceId: string): void {
    this.cancelled.add(serviceId);
    this.active.delete(serviceId);
    this.streaks.delete(serviceId);
    this.clearTimer(serviceId);
  }

  isRunning(): boolean {
    return this.running;
  }

  activeServiceCount(): number {
    return this.active.size;
  }

  async runOnce(serviceId: string): Promise<CheckCycleResult> {
    if (this.pending.has(serviceId)) {
      throw conflict("A check is already running for this service");
    }
    this.cancelled.delete(serviceId);
    this.active.add(serviceId);
    const outcome = await this.execute(serviceId, true);
    if (!outcome) {
      throw notFound(`Service ${serviceId} does not exist`);
    }
    return outcome;
  }

  waitForIdle(timeoutMs: number): Promise<void> {
    if (this.inflight === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.idleWaiters.indexOf(finish);
        if (index >= 0) {
          this.idleWaiters.splice(index, 1);
        }
        resolve();
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      this.idleWaiters.push(finish);
    });
  }

  private async execute(serviceId: string, force = false): Promise<CheckCycleResult | undefined> {
    if (this.pending.has(serviceId)) {
      return undefined;
    }
    if (!force && (!this.running || this.cancelled.has(serviceId))) {
      return undefined;
    }

    const service = this.deps.db.getService(serviceId);
    if (!service || !service.isActive || (service.paused && !force)) {
      this.unregisterService(serviceId);
      return undefined;
    }

    this.pending.add(serviceId);
    this.inflight += 1;
    try {
      const outcome = await runServiceCheck({
        service,
        streak: this.streaks.get(serviceId) ?? 0,
        db: this.deps.db,
        registry: this.deps.registry,
        alerts: this.deps.alerts,
        logger: this.deps.logger,
        retry: this.deps.retry,
      });
      this.streaks.set(serviceId, outcome.streak);
      return outcome;
    } finally {
      this.pending.delete(serviceId);
      this.inflight -= 1;
      this.flushIdle();
      if (this.running && !this.cancelled.has(serviceId)) {
        const fresh = this.deps.db.getService(serviceId);
        if (fresh && fresh.isActive && !fresh.paused) {
          this.schedule(fresh);
        }
      }
    }
  }

  private schedule(service: Service): void {
    this.clearTimer(service.id);
    const timer = setTimeout(() => {
      this.jobs.delete(service.id);
      void this.execute(service.id);
    }, service.intervalSeconds * 1000);
    this.jobs.set(service.id, timer);
  }

  private clearTimer(serviceId: string): void {
    const timer = this.jobs.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.jobs.delete(serviceId);
    }
  }

  private flushIdle(): void {
    if (this.inflight > 0) {
      return;
    }
    const waiters = this.idleWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}
