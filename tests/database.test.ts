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
    expect(db.getService(created.id)).toMatchObject({
      id: created.id,
      name: "Payments API",
    });
    expect(db.listServices()).toHaveLength(1);
  });
});
