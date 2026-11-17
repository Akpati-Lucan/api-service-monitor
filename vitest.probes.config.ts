import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/probes/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
