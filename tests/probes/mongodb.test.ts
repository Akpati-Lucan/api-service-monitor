import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mongodbProbe } from "../../src/probes/mongodb.js";
import { closedPort, openContext, PASSWORD, runContainer, silentPort, waitForUp } from "./support.js";

describe("mongodb", () => {
  const box = { port: 0, stop: async () => undefined as void };

  beforeAll(async () => {
    const started = await runContainer({
      image: "mongo:7",
      containerPort: 27017,
      env: [`MONGO_INITDB_ROOT_USERNAME=probe`, `MONGO_INITDB_ROOT_PASSWORD=${PASSWORD}`],
    });
    box.port = started.port;
    box.stop = started.stop;
    await waitForUp(() => check(box.port, PASSWORD));
  });

  afterAll(async () => {
    await box.stop();
  });

  it("is up when the admin ping succeeds", async () => {
    const result = await check(box.port, PASSWORD);
    expect(result).toMatchObject({ ok: true, status: "UP" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("is auth when the password is wrong", async () => {
    const result = await check(box.port, "wrong-password");
    expect(result.errorClass).toBe("auth");
    expect(result.error).not.toContain(PASSWORD);
    expect(result.error).not.toContain("wrong-password");
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

function uri(port: number): string {
  return `mongodb://probe@127.0.0.1:${port}/admin?authSource=admin`;
}

async function check(port: number, secret: string, timeoutMs = 4000) {
  const ctx = openContext(timeoutMs, secret);
  try {
    return await mongodbProbe.check(
      { kind: "mongodb", address: uri(port), config: { uri: uri(port) } },
      ctx,
    );
  } finally {
    ctx.stop();
  }
}
