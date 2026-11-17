import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type ConnectionStatus = "pending" | "available" | "needs_reauth" | "revoked" | "disconnected";

export interface ConnectionSecret {
  id: string;
  organizationId: string;
  providerId: string;
  status: ConnectionStatus;
  statusReason: string;
  scopes: string;
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
  expiresAt: string | null;
  region: string;
  lastHealthAt: string | null;
  lastHealthStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionView {
  id: string;
  organizationId: string;
  providerId: string;
  status: ConnectionStatus;
  statusReason: string;
  scopes: string;
  expiresAt: string | null;
  region: string;
  lastHealthAt: string | null;
  lastHealthStatus: string | null;
  updatedAt: string;
}

export interface IntegrationGrant {
  id: string;
  connectionId: string;
  organizationId: string;
  stateHash: string;
  challenge: string;
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface IntegrationUsage {
  id: string;
  connectionId: string;
  organizationId: string;
  kind: string;
  outcome: string;
  occurredAt: string;
}

export interface IntegrationStore {
  insertConnection(row: ConnectionSecret): void;
  saveConnection(row: ConnectionSecret): void;
  getSecret(id: string): ConnectionSecret | undefined;
  getSecretByOrg(organizationId: string, providerId: string): ConnectionSecret | undefined;
  listViews(organizationId: string): ConnectionView[];
  deleteConnection(id: string): void;
  insertGrant(row: IntegrationGrant): void;
  getGrantByState(stateHash: string): IntegrationGrant | undefined;
  consumeGrant(id: string, at: string): void;
  insertUsage(row: IntegrationUsage): void;
  countUsageSince(connectionId: string, since: string): number;
  pruneUsage(before: string): void;
}

export function createIntegrationStore(db: Database.Database): IntegrationStore {
  return {
    insertConnection(row) {
      db.prepare(
        `INSERT INTO integration_connections (
           id, organization_id, provider_id, status, status_reason, scopes, key_version,
           credential_iv, credential_tag, credential_ciphertext, expires_at, region,
           last_health_at, last_health_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.organizationId, row.providerId, row.status, row.statusReason, row.scopes, row.keyVersion,
        row.iv, row.tag, row.ciphertext, row.expiresAt, row.region,
        row.lastHealthAt, row.lastHealthStatus, row.createdAt, row.updatedAt,
      );
    },
    saveConnection(row) {
      db.prepare(
        `UPDATE integration_connections SET
           status = ?, status_reason = ?, scopes = ?, key_version = ?,
           credential_iv = ?, credential_tag = ?, credential_ciphertext = ?, expires_at = ?, region = ?,
           last_health_at = ?, last_health_status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        row.status, row.statusReason, row.scopes, row.keyVersion,
        row.iv, row.tag, row.ciphertext, row.expiresAt, row.region,
        row.lastHealthAt, row.lastHealthStatus, row.updatedAt, row.id,
      );
    },
    getSecret(id) {
      const row = db.prepare(`${secretSelect} FROM integration_connections WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      return row ? mapSecret(row) : undefined;
    },
    getSecretByOrg(organizationId, providerId) {
      const row = db.prepare(`${secretSelect} FROM integration_connections WHERE organization_id = ? AND provider_id = ?`).get(organizationId, providerId) as Record<string, unknown> | undefined;
      return row ? mapSecret(row) : undefined;
    },
    listViews(organizationId) {
      const rows = db.prepare(
        `SELECT id, organization_id as organizationId, provider_id as providerId, status, status_reason as statusReason,
                scopes, expires_at as expiresAt, region, last_health_at as lastHealthAt, last_health_status as lastHealthStatus,
                updated_at as updatedAt
         FROM integration_connections WHERE organization_id = ? ORDER BY created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => mapView(row));
    },
    deleteConnection(id) {
      const remove = db.transaction(() => {
        db.prepare(`DELETE FROM integration_usage WHERE connection_id = ?`).run(id);
        db.prepare(`DELETE FROM integration_grants WHERE connection_id = ?`).run(id);
        db.prepare(`DELETE FROM integration_connections WHERE id = ?`).run(id);
      });
      remove();
    },
    insertGrant(row) {
      db.prepare(
        `INSERT INTO integration_grants (
           id, connection_id, organization_id, state_hash, challenge, key_version,
           verifier_iv, verifier_tag, verifier_ciphertext, expires_at, consumed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.connectionId, row.organizationId, row.stateHash, row.challenge, row.keyVersion,
        row.iv, row.tag, row.ciphertext, row.expiresAt, row.consumedAt, row.createdAt,
      );
    },
    getGrantByState(stateHash) {
      const row = db.prepare(
        `SELECT id, connection_id as connectionId, organization_id as organizationId, state_hash as stateHash,
                challenge, key_version as keyVersion, verifier_iv as iv, verifier_tag as tag, verifier_ciphertext as ciphertext,
                expires_at as expiresAt, consumed_at as consumedAt, created_at as createdAt
         FROM integration_grants WHERE state_hash = ?`,
      ).get(stateHash) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        connectionId: String(row.connectionId),
        organizationId: String(row.organizationId),
        stateHash: String(row.stateHash),
        challenge: String(row.challenge),
        keyVersion: Number(row.keyVersion),
        iv: String(row.iv),
        tag: String(row.tag),
        ciphertext: String(row.ciphertext),
        expiresAt: String(row.expiresAt),
        consumedAt: row.consumedAt == null ? null : String(row.consumedAt),
        createdAt: String(row.createdAt),
      };
    },
    consumeGrant(id, at) {
      db.prepare(`UPDATE integration_grants SET consumed_at = ? WHERE id = ?`).run(at, id);
    },
    insertUsage(row) {
      db.prepare(
        `INSERT INTO integration_usage (id, connection_id, organization_id, kind, outcome, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.connectionId, row.organizationId, row.kind, row.outcome, row.occurredAt);
    },
    countUsageSince(connectionId, since) {
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM integration_usage WHERE connection_id = ? AND kind = 'health' AND occurred_at >= ?`,
      ).get(connectionId, since) as { count: number };
      return Number(row.count);
    },
    pruneUsage(before) {
      db.prepare(`DELETE FROM integration_usage WHERE occurred_at < ?`).run(before);
    },
  };
}

export function blankConnection(input: { organizationId: string; providerId: string; keyVersion: number; now: string }): ConnectionSecret {
  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    providerId: input.providerId,
    status: "pending",
    statusReason: "",
    scopes: "",
    keyVersion: input.keyVersion,
    iv: "",
    tag: "",
    ciphertext: "",
    expiresAt: null,
    region: "US",
    lastHealthAt: null,
    lastHealthStatus: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

const secretSelect = `SELECT id, organization_id as organizationId, provider_id as providerId, status, status_reason as statusReason,
  scopes, key_version as keyVersion, credential_iv as iv, credential_tag as tag, credential_ciphertext as ciphertext,
  expires_at as expiresAt, region, last_health_at as lastHealthAt, last_health_status as lastHealthStatus,
  created_at as createdAt, updated_at as updatedAt`;

function mapSecret(row: Record<string, unknown>): ConnectionSecret {
  return {
    ...mapView(row),
    keyVersion: Number(row.keyVersion),
    iv: String(row.iv ?? ""),
    tag: String(row.tag ?? ""),
    ciphertext: String(row.ciphertext ?? ""),
    createdAt: String(row.createdAt),
  };
}

function mapView(row: Record<string, unknown>): ConnectionView {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    providerId: String(row.providerId),
    status: String(row.status) as ConnectionStatus,
    statusReason: String(row.statusReason ?? ""),
    scopes: String(row.scopes ?? ""),
    expiresAt: row.expiresAt == null ? null : String(row.expiresAt),
    region: String(row.region ?? "US"),
    lastHealthAt: row.lastHealthAt == null ? null : String(row.lastHealthAt),
    lastHealthStatus: row.lastHealthStatus == null ? null : String(row.lastHealthStatus),
    updatedAt: String(row.updatedAt),
  };
}
