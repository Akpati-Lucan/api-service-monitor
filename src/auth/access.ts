import type { Response } from "express";
import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, AuthScope, Service } from "../types/index.js";
import { forbidden, notFound, unauthorized } from "../utils/errors.js";

const SCOPE_RANK: Record<AuthScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export const UNRESTRICTED_AUTH: AuthContext = {
  keyId: null,
  name: "disabled",
  scope: "admin",
  groupId: null,
};

export function requireAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) {
    throw unauthorized("Bearer token is required");
  }
  return auth;
}

export function requireScope(auth: AuthContext, scope: AuthScope): void {
  if (SCOPE_RANK[auth.scope] < SCOPE_RANK[scope]) {
    throw forbidden(`Scope ${scope} is required`);
  }
}

export function requireGroup(auth: AuthContext, groupId: string | null): void {
  if (auth.groupId && auth.groupId !== groupId) {
    throw forbidden("Key is restricted to another group");
  }
}

export function requestedGroup(auth: AuthContext, requested?: string): string | undefined {
  if (auth.groupId) {
    if (requested && requested !== auth.groupId) {
      throw forbidden("Key is restricted to another group");
    }
    return auth.groupId;
  }
  return requested;
}

export function visibleService(db: DatabaseApi, auth: AuthContext, serviceId: string): Service {
  const service = db.getService(serviceId);
  if (!service) {
    throw notFound(`Service ${serviceId} does not exist`);
  }
  requireGroup(auth, service.groupId);
  return service;
}
