import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/types/index.js";
import { createNoopLogger } from "../src/utils/logger.js";
import { createDefaultProbeRegistry, createProbeRegistry } from "../src/probes/registry.js";
import { httpProbe } from "../src/probes/http.js";
import type { Probe } from "../src/probes/types.js";

const down: CheckResult = {
  ok: false,
  status: "DOWN",
  responseTimeMs: 0,
  errorClass: "unknown",
  error: "fake",
};

describe("probe registry", () => {
  it("loads http only when it is enabled", () => {
    expect(createDefaultProbeRegistry(["http"]).kinds()).toEqual(["http"]);
    expect(createDefaultProbeRegistry([]).get("http")).toBeUndefined();
  });

  it("registers an extra probe kind", async () => {
    const registry = createProbeRegistry();
    const fake: Probe = {
      kind: "fake",
      async check() {
        return down;
      },
    };

    registry.register(fake);
    expect(registry.get("fake")).toBe(fake);
    await expect(registry.get("fake")!.check(
      { kind: "fake", address: "unused", config: {} },
      { timeoutMs: 1000, signal: new AbortController().signal, log: createNoopLogger() },
    )).resolves.toEqual(down);

    expect(() => registry.register(fake)).toThrow(/already registered/);
    expect(httpProbe.kind).toBe("http");
  });

  it("fails closed when an HTTP secret header is configured without a secret", async () => {
    const result = await httpProbe.check(
      { kind: "http", address: "http://127.0.0.1:9/unused", config: { secretHeader: "Authorization" } },
      { timeoutMs: 200, signal: new AbortController().signal, log: createNoopLogger() },
    );

    expect(result).toMatchObject({
      ok: false,
      status: "DOWN",
      errorClass: "auth",
      error: "secret not available",
    });
  });
});
