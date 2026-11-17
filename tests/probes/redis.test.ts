import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redisProbe } from "../../src/probes/redis.js";
import { closedPort, openContext, PASSWORD, runContainer, silentPort, waitForUp } from "./support.js";

describe("redis", () => {
  const box = { port: 0, stop: async () => undefined as void };

  beforeAll(async () => {
    const started = await runContainer({
      image: "redis:7-alpine",
      containerPort: 6379,
      command: ["redis-server", "--requirepass", PASSWORD],
    });
    box.port = started.port;
    box.stop = started.stop;
    await waitForUp(() => check(box.port, PASSWORD));
  });

  afterAll(async () => {
    await box.stop();
  });

  it("is up when PING is answered", async () => {
    expect(await check(box.port, PASSWORD)).toMatchObject({ ok: true, status: "UP" });
  });

  it("is auth when the password is wrong", async () => {
    const result = await check(box.port, "wrong-password");
    expect(result.errorClass).toBe("auth");
    expect(result.error).not.toContain(PASSWORD);
  });

  it("is network when the port is closed", async () => {
    const result = await check(await closedPort(), PASSWORD, 800);
    expect(result).toMatchObject({ status: "DOWN", errorClass: "network" });
  });

  it("times out when the server accepts and does not answer", async () => {
    const silent = await silentPort();
    try {
      const result = await check(silent.port, PASSWORD, 600);
      expect(result).toMatchObject({ status: "DOWN", errorClass: "timeout" });
    } finally {
      await silent.close();
    }
  });
});

async function check(port: number, secret: string, timeoutMs = 4000) {
  const ctx = openContext(timeoutMs, secret);
  try {
    return await redisProbe.check(
      { kind: "redis", address: `127.0.0.1:${port}`, config: { host: "127.0.0.1", port, tls: false } },
      ctx,
    );
  } finally {
    ctx.stop();
  }
}
