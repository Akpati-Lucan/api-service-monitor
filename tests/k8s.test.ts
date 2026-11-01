import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../deploy/k8s/", import.meta.url);

describe("kubernetes manifests", () => {
  it("documents kubectl apply and the required secret names", () => {
    for (const name of ["00-namespace.yaml", "monitor.yaml", "mcp.yaml", "network-policy.yaml"]) {
      const text = readFileSync(new URL(name, root), "utf8");
      expect(text).toContain("kubectl apply -f deploy/k8s");
      expect(text).toContain("api-monitor-secrets");
      expect(text).toContain("api-monitor-mcp-token");
    }
    const monitor = readFileSync(new URL("monitor.yaml", root), "utf8");
    expect(monitor).toContain("replicas: 1");
    expect(monitor).toContain("Recreate");
    expect(monitor).toContain("claimName: api-monitor-data");
    const mcp = readFileSync(new URL("mcp.yaml", root), "utf8");
    expect(mcp).toContain('value: "true"');
    expect(mcp).toContain("MONITOR_BASE_URL");
    expect(mcp).not.toContain("DB_PATH");
    expect(mcp).toContain("minAvailable: 1");
  });
});
