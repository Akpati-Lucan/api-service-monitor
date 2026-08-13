import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { performCheck } from "../src/services/checker.js";

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer(handler);

  return new Promise<{ port: number; server: http.Server }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        resolve({ port: address.port, server });
      }
    });
  });
}

describe("checker", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server = undefined;
    }
  });

  it("returns ok for a successful request", async () => {
    const fixture = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    server = fixture.server;

    const result = await performCheck(`http://127.0.0.1:${fixture.port}/ok`, { timeoutMs: 3000 });
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failed for an HTTP 500", async () => {
    const fixture = await startServer((_req, res) => {
      res.statusCode = 500;
      res.end("server error");
    });
    server = fixture.server;

    const result = await performCheck(`http://127.0.0.1:${fixture.port}/err`, { timeoutMs: 3000 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(500);
  });

  it("returns failed on timeout", async () => {
    const fixture = await startServer((_req, res) => {
      setTimeout(() => {
        res.end("late");
      }, 800);
    });
    server = fixture.server;

    const result = await performCheck(`http://127.0.0.1:${fixture.port}/slow`, { timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout|Abort/i);
  });

  it("returns failed on network error", async () => {
    const result = await performCheck("http://127.0.0.1:1", { timeoutMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
