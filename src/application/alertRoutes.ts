import type { DatabaseApi } from "../db/database.js";
import type { AlertRoute, AlertRouteKind, AuthContext } from "../types/index.js";
import { notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope } from "../auth/access.js";
import { assertSecretRef } from "../probes/secrets.js";

export function createAlertRoute(
  db: DatabaseApi,
  auth: AuthContext,
  input: { kind: AlertRouteKind; groupId?: string | null; config?: Record<string, unknown>; secretRef?: string | null; enabled?: boolean },
): AlertRoute {
  requireScope(auth, "write");
  const groupId = auth.groupId ?? input.groupId ?? null;
  if (auth.groupId && input.groupId && input.groupId !== auth.groupId) {
    requireGroup(auth, input.groupId);
  }
  if (groupId && !db.getGroup(groupId)) {
    throw notFound(`Group ${groupId} does not exist`);
  }
  const config = validateConfig(input.kind, input.config ?? {});
  const secretRef = input.secretRef ?? null;
  if (secretRef) {
    assertSecretRef(secretRef);
  }
  if (input.kind === "slack" && !secretRef) {
    throw validationError("slack routes require secretRef", { secretRef: ["slack routes require secretRef"] });
  }
  return db.createAlertRoute({
    groupId,
    kind: input.kind,
    config,
    secretRef,
    enabled: input.enabled ?? true,
  });
}

export function listAlertRoutes(db: DatabaseApi, auth: AuthContext): AlertRoute[] {
  requireScope(auth, "read");
  return db.listAlertRoutes().filter((route) => !auth.groupId || route.groupId === auth.groupId);
}

export function removeAlertRoute(db: DatabaseApi, auth: AuthContext, id: string): void {
  requireScope(auth, "write");
  const route = db.getAlertRoute(id);
  if (!route) {
    throw notFound(`Alert route ${id} does not exist`);
  }
  requireGroup(auth, route.groupId);
  db.deleteAlertRoute(id);
}

function validateConfig(kind: AlertRouteKind, config: Record<string, unknown>): Record<string, unknown> {
  if (kind === "webhook") {
    const url = config.url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      throw validationError("webhook config.url must be an http(s) URL", {
        url: ["webhook config.url must be an http(s) URL"],
      });
    }
    return { url };
  }
  if (kind === "slack") {
    const channel = config.channel;
    if (channel != null && (typeof channel !== "string" || channel.length > 80)) {
      throw validationError("slack config.channel must be a string", { channel: ["slack config.channel must be a string"] });
    }
    return channel ? { channel } : {};
  }
  if (kind === "email") {
    const to = config.to;
    if (!Array.isArray(to) || to.length === 0 || to.some((item) => typeof item !== "string" || !item.includes("@"))) {
      throw validationError("email config.to must be a list of addresses", {
        to: ["email config.to must be a list of addresses"],
      });
    }
    return { to };
  }
  return {};
}
