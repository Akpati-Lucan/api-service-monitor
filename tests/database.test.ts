import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase, initializeDatabase } from "../src/db/database.js";

describe("database", () => {
  const tempDirs: string[] = [];
  let db: ReturnType<typeof createDatabase> | undefined;

  afterEach(() => {
    db?.close();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    db = undefined;
  });

  it("runs migrations and stores a service", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-db-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "monitor.db");
    db = createDatabase({ dbPath, logger: undefined });

    initializeDatabase(db);

    const created = db.createService({
      name: "Payments API",
      url: "https://api.example.com/health",
      intervalSeconds: 30,
      timeoutMs: 5000,
      failureThreshold: 2,
      isActive: true,
    });

    expect(created.name).toBe("Payments API");
    expect(created.kind).toBe("http");
    expect(created.groupId).toBe("grp_default");
    expect(created.address).toBe("https://api.example.com/health");
    expect(db.getService(created.id)).toMatchObject({
      id: created.id,
      name: "Payments API",
      kind: "http",
    });
    expect(db.listServices()).toHaveLength(1);

    const check = db.insertHealthCheck({
      serviceId: created.id,
      status: "DEGRADED",
      responseTimeMs: 1200,
      errorClass: "timeout",
      evidence: { latencyBudgetMs: 800 },
    });

    expect(db.getRecentHealthChecks(created.id, 1)[0]).toMatchObject({
      id: check.id,
      status: "DEGRADED",
      errorClass: "timeout",
      evidence: { latencyBudgetMs: 800 },
    });
  });
});
