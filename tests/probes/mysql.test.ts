import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mysqlProbe } from "../../src/probes/mysql.js";
import { closedPort, openContext, PASSWORD, runContainer, silentPort, waitForUp } from "./support.js";

describe("mysql", () => {
  const mysql = { port: 0, stop: async () => undefined as void };
  const mariadb = { port: 0, stop: async () => undefined as void };

  beforeAll(async () => {
    const [mysqlBox, mariaBox] = await Promise.all([
      runContainer({
        image: "mysql:8.4",
        containerPort: 3306,
        env: [`MYSQL_ROOT_PASSWORD=${PASSWORD}`, "MYSQL_DATABASE=probe", "MYSQL_ROOT_HOST=%"],
      }),
      runContainer({
        image: "mariadb:11",
        containerPort: 3306,
        env: [`MARIADB_ROOT_PASSWORD=${PASSWORD}`, "MARIADB_DATABASE=probe", "MARIADB_ROOT_HOST=%"],
      }),
    ]);
    mysql.port = mysqlBox.port;
    mysql.stop = mysqlBox.stop;
    mariadb.port = mariaBox.port;
    mariadb.stop = mariaBox.stop;
    await Promise.all([
      waitForUp(() => check(mysql.port, "mysql")),
      waitForUp(() => check(mariadb.port, "mariadb")),
    ]);
  });

  afterAll(async () => {
    await Promise.all([mysql.stop(), mariadb.stop()]);
  });

  it("is up when SELECT 1 succeeds on MySQL", async () => {
    expect(await check(mysql.port, "mysql")).toMatchObject({ ok: true, status: "UP" });
  });

  it("is up when SELECT 1 succeeds on MariaDB", async () => {
    expect(await check(mariadb.port, "mariadb")).toMatchObject({ ok: true, status: "UP" });
  });

  it("labels a MariaDB auth failure in the incident text", async () => {
    const result = await check(mariadb.port, "mariadb", "wrong-password");
    expect(result.errorClass).toBe("auth");
    expect(result.error?.startsWith("mariadb:")).toBe(true);
    expect(result.error).not.toContain(PASSWORD);
  });

  it("is network when the port is closed", async () => {
    const result = await check(await closedPort(), "mysql", PASSWORD, 800);
    expect(result).toMatchObject({ status: "DOWN", errorClass: "network" });
  });

  it("times out when the server accepts and does not answer", async () => {
    const silent = await silentPort();
    try {
      const result = await check(silent.port, "mysql", PASSWORD, 600);
      expect(result).toMatchObject({ status: "DOWN", errorClass: "timeout" });
    } finally {
      await silent.close();
    }
  });
});

async function check(port: number, variant: "mysql" | "mariadb", secret = PASSWORD, timeoutMs = 4000) {
  const ctx = openContext(timeoutMs, secret);
  try {
    return await mysqlProbe.check(
      {
        kind: "mysql",
        address: `127.0.0.1:${port}`,
        config: { host: "127.0.0.1", port, user: "root", database: "probe", variant, ssl: "disable" },
      },
      ctx,
    );
  } finally {
    ctx.stop();
  }
}
