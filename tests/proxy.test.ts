import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import request from "supertest";
import { createProxyApp } from "../src/mcp/proxy.js";

describe("mcp proxy", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("answers health when the monitor answers and forwards tool calls with the read token", async () => {
    const seen: Array<{ authorization?: string; body?: string }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        seen.push({ authorization: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
        if (req.url === "/health") {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: "healthy" }));
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
      });
    });
    servers.push(upstream);
    const port = await new Promise<number>((resolve) => {
      upstream.listen(0, "127.0.0.1", () => {
        const address = upstream.address();
        resolve(address && typeof address === "object" ? address.port : 0);
      });
    });
    const app = createProxyApp({
      MONITOR_BASE_URL: `http://127.0.0.1:${port}`,
      MCP_TOKEN: "read-token",
    });

    const health = await request(app).get("/health").expect(200);
    expect(health.body.monitor).toBe("reachable");
    const forwarded = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(200);
    expect(forwarded.body.result.ok).toBe(true);
    const mcpCall = seen.find((item) => item.body?.includes("tools/list"));
    expect(mcpCall?.authorization).toBe("Bearer read-token");
  });

  it("reports unhealthy when the monitor does not answer", async () => {
    const app = createProxyApp({ MONITOR_BASE_URL: "http://127.0.0.1:9", MCP_TOKEN: "" });
    await request(app).get("/health").expect(503);
  });
});
