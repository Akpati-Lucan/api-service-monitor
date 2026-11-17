import path from "node:path";
import type { Probe } from "./types.js";

export const sqliteProbe: Probe = {
  kind: "sqlite",
  async check(target) {
    const startedAt = Date.now();
    const file = typeof target.config.path === "string" ? target.config.path : "";
    const root = typeof target.config.sqliteRoot === "string" ? target.config.sqliteRoot : "";
    if (!file) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "invalid probe config" };
    }
    if (!root) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "unknown", error: "sqlite probe root is not configured" };
    }
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, file);
    const inside = resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    if (!inside || file.split(/[/\\]/).includes("..")) {
      return { ok: false, status: "DOWN", responseTimeMs: 0, errorClass: "auth", error: "sqlite path escapes the probe root" };
    }
    try {
      const driver = await import("better-sqlite3");
      const db = new driver.default(resolved, { readonly: true, fileMustExist: true });
      try {
        db.prepare("SELECT 1").get();
      } finally {
        db.close();
      }
      return { ok: true, status: "UP", responseTimeMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "sqlite check failed";
      return { ok: false, status: "DOWN", responseTimeMs: Date.now() - startedAt, errorClass: "query", error: message };
    }
  },
};
