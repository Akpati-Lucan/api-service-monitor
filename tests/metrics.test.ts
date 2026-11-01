import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDatabase, initializeDatabase } from "../src/db/database.js";
import { getServiceMetrics } from "../src/application/metrics.js";

describe("metrics", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("computes check ratio, duration uptime, and mean time to resolve", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-metrics-"));
    tempDirs.push(dir);
    const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
    initializeDatabase(db);
    const now = new Date("2026-10-31T12:00:00.000Z");
    const service = db.createService({
      name: "Payments",
      url: "https://example.com/health",
      intervalSeconds: 60,
      timeoutMs: 1000,
      failureThreshold: 3,
    });
    db.insertHealthCheck({
      serviceId: service.id,
      status: "UP",
      responseTimeMs: 100,
      checkedAt: "2026-10-31T11:00:00.000Z",
    });
    db.insertHealthCheck({
      serviceId: service.id,
      status: "DOWN",
      responseTimeMs: 300,
      errorClass: "http_status",
      checkedAt: "2026-10-31T11:30:00.000Z",
    });
    const incident = db.openIncident({
      serviceId: service.id,
      reason: "HTTP 500",
      startedAt: "2026-10-31T11:30:00.000Z",
      errorClass: "http_status",
    });
    db.resolveIncident(incident.id, "2026-10-31T11:40:00.000Z");

    const raw = new Database(path.join(dir, "monitor.db"));
    raw.prepare(`UPDATE services SET created_at = ? WHERE id = ?`).run("2026-10-30T00:00:00.000Z", service.id);
    raw.prepare(
      `INSERT INTO check_rollups (hour, service_id, checks, up_checks, degraded_checks, down_checks, avg_response_time_ms)
       VALUES (?, ?, 4, 4, 0, 0, 50)`,
    ).run("2026-10-31T10:00:00.000Z", service.id);
    raw.close();

    const metrics = getServiceMetrics(db, service.id, "24h", now);
    expect(metrics.totalChecks).toBe(6);
    expect(metrics.upChecks).toBe(5);
    expect(metrics.downChecks).toBe(1);
    expect(metrics.uptimePercentCheckRatio).toBeCloseTo((5 / 6) * 100);
    expect(metrics.uptimePercentDuration).toBeCloseTo(((24 * 60 * 60 * 1000 - 10 * 60 * 1000) / (24 * 60 * 60 * 1000)) * 100);
    expect(metrics.avgResponseTimeMs).toBeCloseTo((100 + 300 + 50 * 4) / 6);
    expect(metrics.incidentCount).toBe(1);
    expect(metrics.openIncidentCount).toBe(0);
    expect(metrics.mttrSeconds).toBe(600);
    db.close();
  });
});
