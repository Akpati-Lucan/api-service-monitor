import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase } from "../src/db/database.js";

type TestGlobals = typeof globalThis & {
  __TEST_DB__?: ReturnType<typeof createDatabase>;
};

describe("api", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "monitor.db");
    const db = createDatabase({ dbPath, logger: undefined });
    initializeDatabase(db);
    (globalThis as TestGlobals).__TEST_DB__ = db;
  });

  afterEach(() => {
    const db = (globalThis as TestGlobals).__TEST_DB__;
    db?.close();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    delete (globalThis as TestGlobals).__TEST_DB__;
  });

  it("creates, lists, reads, and deletes services", async () => {
    const db = (globalThis as TestGlobals).__TEST_DB__!;
    const app = createApp({ db, config: { PORT: 3000, DB_PATH: "./data/test.db", DEFAULT_INTERVAL_SECONDS: 30, DEFAULT_TIMEOUT_MS: 5000, DEFAULT_FAILURE_THRESHOLD: 3, RETRY_COUNT: 3, RETRY_BASE_DELAY_MS: 250, RETRY_FACTOR: 2, NODE_ENV: "test", LOG_LEVEL: "info", VERSION: "1.0.0" }, logger: undefined });

    const createRes = await request(app)
      .post("/services")
      .send({
        name: "Payments API",
        url: "https://example.com/health",
        intervalSeconds: 30,
        timeoutMs: 5000,
        failureThreshold: 2,
      })
      .expect(201);

    expect(createRes.body.name).toBe("Payments API");

    await request(app).get("/services").expect(200);

    await request(app).get(`/services/${createRes.body.id}`).expect(200);

    await request(app).delete(`/services/${createRes.body.id}`).expect(204);
    await request(app).get(`/services/${createRes.body.id}`).expect(404);
  });

  it("returns health information and validation errors", async () => {
    const db = (globalThis as TestGlobals).__TEST_DB__!;
    const app = createApp({ db, config: { PORT: 3000, DB_PATH: "./data/test.db", DEFAULT_INTERVAL_SECONDS: 30, DEFAULT_TIMEOUT_MS: 5000, DEFAULT_FAILURE_THRESHOLD: 3, RETRY_COUNT: 3, RETRY_BASE_DELAY_MS: 250, RETRY_FACTOR: 2, NODE_ENV: "test", LOG_LEVEL: "info", VERSION: "1.0.0" }, logger: undefined });

    await request(app).get("/health").expect(200);

    const invalid = await request(app)
      .post("/services")
      .send({ name: "", url: "bad-url", intervalSeconds: 0, timeoutMs: 0, failureThreshold: 0 })
      .expect(400);

    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    await request(app).get("/services/does-not-exist").expect(404);
  });
});
