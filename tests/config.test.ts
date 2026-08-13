import { describe, expect, it } from "vitest";
import { configSchema, loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads valid configuration", () => {
    const parsed = configSchema.parse({
      PORT: "3000",
      DB_PATH: "./data/test.db",
      DEFAULT_INTERVAL_SECONDS: "60",
      DEFAULT_TIMEOUT_MS: "5000",
      DEFAULT_FAILURE_THRESHOLD: "3",
      RETRY_COUNT: "3",
      RETRY_BASE_DELAY_MS: "250",
      RETRY_FACTOR: "2",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
    });

    expect(parsed.PORT).toBe(3000);
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("fails invalid configuration", () => {
    expect(() =>
      configSchema.parse({
        PORT: "abc",
        DB_PATH: "",
        DEFAULT_INTERVAL_SECONDS: "0",
        DEFAULT_TIMEOUT_MS: "5000",
        DEFAULT_FAILURE_THRESHOLD: "3",
        RETRY_COUNT: "3",
        RETRY_BASE_DELAY_MS: "250",
        RETRY_FACTOR: "2",
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      }),
    ).toThrow();
  });

  it("loads env values from process.env", () => {
    expect(loadConfig({
      PORT: "3010",
      DB_PATH: "./data/test-load.db",
      DEFAULT_INTERVAL_SECONDS: "15",
      DEFAULT_TIMEOUT_MS: "2000",
      DEFAULT_FAILURE_THRESHOLD: "2",
      RETRY_COUNT: "2",
      RETRY_BASE_DELAY_MS: "100",
      RETRY_FACTOR: "1.5",
      NODE_ENV: "test",
      LOG_LEVEL: "debug",
    })).toMatchObject({
      PORT: 3010,
      DB_PATH: "./data/test-load.db",
      LOG_LEVEL: "debug",
    });
  });
});
