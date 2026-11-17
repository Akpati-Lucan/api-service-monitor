import { describe, expect, it } from "vitest";
import { createDefaultProbeRegistry } from "../src/probes/registry.js";
import { postgresProbe } from "../src/probes/postgres.js";
import { mysqlProbe } from "../src/probes/mysql.js";
import { mongodbProbe } from "../src/probes/mongodb.js";
import { redisProbe } from "../src/probes/redis.js";
import { validateProbeConfig } from "../src/probes/validate.js";
import { AppError } from "../src/utils/errors.js";
import { createNoopLogger } from "../src/utils/logger.js";

describe("data engine registration", () => {
  it("keeps postgres, mysql, mongodb, and redis out of the default registry", () => {
    expect(createDefaultProbeRegistry(["http"]).kinds()).toEqual(["http"]);
    expect(createDefaultProbeRegistry(["postgres", "mysql", "mongodb", "redis"]).kinds()).toEqual([
      "postgres",
      "mysql",
      "mongodb",
      "redis",
    ]);
  });

  it("rejects a MongoDB URI that contains a password and requires postgres outside development", () => {
    expect(() => validateProbeConfig({
      kind: "mongodb",
      config: { uri: "mongodb://probe:secret@127.0.0.1:27017/admin" },
      intervalSeconds: 60,
      nodeEnv: "test",
    })).toThrow(AppError);
    try {
      validateProbeConfig({
        kind: "mongodb",
        config: { uri: "mongodb://probe:secret@127.0.0.1:27017/admin" },
        intervalSeconds: 60,
        nodeEnv: "test",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details?.uri?.join(" ")).toMatch(/password/);
    }

    expect(validateProbeConfig({
      kind: "postgres",
      config: { host: "db.internal", database: "app", user: "probe" },
      intervalSeconds: 60,
      nodeEnv: "production",
    }).config).toMatchObject({ port: 5432, ssl: "require" });

    expect(validateProbeConfig({
      kind: "mysql",
      config: { host: "db.internal", user: "probe", variant: "mariadb" },
      intervalSeconds: 60,
      nodeEnv: "test",
    }).config).toMatchObject({ port: 3306, variant: "mariadb", database: null });
  });

  it("fails closed when a secret is required and missing", async () => {
    const ctx = { timeoutMs: 200, signal: new AbortController().signal, log: createNoopLogger() };
    await expect(postgresProbe.check(
      { kind: "postgres", address: "db:5432", config: { host: "db", port: 5432, database: "app", user: "probe", secretExpected: true } },
      ctx,
    )).resolves.toMatchObject({ errorClass: "auth", error: "secret not available" });
    await expect(mysqlProbe.check(
      { kind: "mysql", address: "db:3306", config: { host: "db", port: 3306, user: "probe", variant: "mariadb", secretExpected: true } },
      ctx,
    )).resolves.toMatchObject({ errorClass: "auth", error: "mariadb: secret not available" });
    await expect(mongodbProbe.check(
      { kind: "mongodb", address: "mongodb://db/admin", config: { uri: "mongodb://db/admin", secretExpected: true } },
      ctx,
    )).resolves.toMatchObject({ errorClass: "auth", error: "secret not available" });
    await expect(redisProbe.check(
      { kind: "redis", address: "db:6379", config: { host: "db", port: 6379, tls: false, secretExpected: true } },
      ctx,
    )).resolves.toMatchObject({ errorClass: "auth", error: "secret not available" });
  });
});