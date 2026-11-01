import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, AuthScope } from "../types/index.js";
import { forbidden, notFound, validationError } from "../utils/errors.js";
import { generateApiToken } from "../auth/apiKeys.js";
import { requireGroup, requireScope } from "../auth/access.js";

export interface IssuedApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: AuthScope;
  groupId: string | null;
  createdAt: string;
  token: string;
}

export function issueApiKey(
  db: DatabaseApi,
  auth: AuthContext,
  input: { name: string; scope: AuthScope; groupId?: string | null },
): IssuedApiKey {
  requireScope(auth, "admin");
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    throw validationError("name must be 1 to 80 characters", { name: ["name must be 1 to 80 characters"] });
  }
  if (input.scope !== "read" && input.scope !== "write" && input.scope !== "admin") {
    throw validationError("scope must be read, write, or admin", { scope: ["scope must be read, write, or admin"] });
  }

  const groupId = input.groupId ?? null;
  if (input.scope !== "admin" && !groupId) {
    throw validationError("groupId is required unless scope is admin", {
      groupId: ["groupId is required unless scope is admin"],
    });
  }
  if (groupId) {
    if (!db.getGroup(groupId)) {
      throw notFound(`Group ${groupId} does not exist`);
    }
    requireGroup(auth, groupId);
  } else if (auth.groupId) {
    throw forbidden("A group-restricted key cannot create an unrestricted key");
  }

  const issued = generateApiToken();
  const record = db.insertApiKey({
    name,
    prefix: issued.prefix,
    hash: issued.hash,
    scope: input.scope,
    groupId,
  });
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scope: record.scope,
    groupId: record.groupId,
    createdAt: record.createdAt,
    token: issued.token,
  };
}

export function revokeApiKey(db: DatabaseApi, auth: AuthContext, id: string): void {
  requireScope(auth, "admin");
  const key = db.getApiKey(id);
  if (!key || key.revokedAt) {
    throw notFound(`API key ${id} does not exist`);
  }
  requireGroup(auth, key.groupId);
  db.revokeApiKey(id);
}
