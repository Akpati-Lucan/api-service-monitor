import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseApi } from "../db/database.js";
import type { AuthContext } from "../types/index.js";
import { unauthorized } from "../utils/errors.js";

const DUMMY_HASH = createHash("sha256").update("am_dummy-token-not-a-secret").digest("hex");

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = `am_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    prefix: token.slice(0, 8),
    hash: hashToken(token),
  };
}

export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function authenticateBearer(db: DatabaseApi, header: string | undefined): AuthContext {
  const token = bearerToken(header);
  if (!token || token.length < 8) {
    throw unauthorized("Bearer token is required");
  }

  const presented = hashToken(token);
  const match = db.listApiKeysByPrefix(token.slice(0, 8)).find((key) => hashesEqual(presented, key.hash));
  if (!match) {
    hashesEqual(presented, DUMMY_HASH);
    throw unauthorized("Bearer token is not valid");
  }

  return {
    keyId: match.id,
    name: match.name,
    scope: match.scope,
    groupId: match.groupId,
  };
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}
