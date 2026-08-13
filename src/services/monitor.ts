import type { Service } from "../types/index.js";

export interface Monitor {
  start(): void;
  stop(): void;
  registerService(service: Service): void;
  unregisterService(serviceId: string): void;
  isRunning(): boolean;
  activeServiceCount(): number;
}

export class InMemoryMonitor implements Monitor {
  private readonly jobs = new Map<string, NodeJS.Timeout>();
  private running = false;

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    for (const timer of this.jobs.values()) {
      clearTimeout(timer);
    }
    this.jobs.clear();
  }

  registerService(service: Service): void {
    this.jobs.set(service.id, setTimeout(() => undefined, 0));
  }

  unregisterService(serviceId: string): void {
    const timer = this.jobs.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.jobs.delete(serviceId);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  activeServiceCount(): number {
    return this.jobs.size;
  }
}
