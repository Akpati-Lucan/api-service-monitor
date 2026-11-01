import { hashToken, hashesEqual } from "../auth/apiKeys.js";
import type { DatabaseApi } from "../db/database.js";
import { notFound } from "../utils/errors.js";

const DUMMY_HASH = hashToken("hb_dummy-token-not-a-secret");

export function acceptHeartbeat(db: DatabaseApi, token: string, now = new Date()): void {
  const presented = token.trim();
  if (presented.length < 8) {
    throw notFound("Heartbeat token does not exist");
  }
  const hash = hashToken(presented);
  const row = db.getHeartbeatByHash(hash);
  if (!row || !hashesEqual(hash, row.tokenHash)) {
    hashesEqual(hash, DUMMY_HASH);
    throw notFound("Heartbeat token does not exist");
  }
  db.touchHeartbeat(row.serviceId, now.toISOString());
}
