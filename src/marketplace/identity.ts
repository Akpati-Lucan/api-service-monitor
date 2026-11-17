import type Database from "better-sqlite3";

export type OrgRole = "owner" | "admin" | "editor" | "billing" | "viewer";
export type DomainMethod = "dns_txt" | "http_file" | "manual";
export type DomainStatus = "pending" | "verified" | "rejected";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CredentialUser extends PublicUser {
  passwordHash: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface EmailTokenRecord {
  id: string;
  userId: string;
  purpose: "verify" | "reset";
  expiresAt: string;
  usedAt: string | null;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  role?: OrgRole;
}

export interface Membership {
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
  invitedBy: string;
}

export interface PublisherProfile {
  organizationId: string;
  legalName: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  regions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DomainVerification {
  id: string;
  organizationId: string;
  domain: string;
  method: DomainMethod;
  token: string;
  status: DomainStatus;
  evidence: string;
  reviewedBy: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface AppealRecord {
  id: string;
  listingId: string;
  organizationId: string;
  note: string;
  status: "open" | "upheld" | "reversed";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface PublisherNotification {
  id: string;
  organizationId: string;
  listingId: string | null;
  kind: string;
  message: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  actorKind: "user" | "staff";
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  organizationId: string | null;
  detailJson: string;
  createdAt: string;
}

export interface IdentityStore {
  insertUser(input: CredentialUser): void;
  getUser(id: string): PublicUser | undefined;
  getCredentialByEmail(email: string): CredentialUser | undefined;
  markEmailVerified(id: string, at: string): void;
  setPassword(id: string, passwordHash: string, at: string): void;
  anonymizeUser(id: string, email: string, at: string): void;
  listExpiredDeletions(cutoff: string): PublicUser[];
  deleteUser(id: string): void;
  insertSession(input: { id: string; userId: string; tokenHash: string; csrfToken: string; createdAt: string; expiresAt: string }): void;
  getSessionByHash(tokenHash: string): SessionRecord | undefined;
  revokeSession(id: string, at: string): void;
  insertEmailToken(input: { id: string; userId: string; purpose: "verify" | "reset"; tokenHash: string; expiresAt: string; createdAt: string }): void;
  getEmailToken(tokenHash: string): EmailTokenRecord | undefined;
  markEmailTokenUsed(id: string, at: string): void;
  insertOrganization(input: { id: string; name: string; slug: string; createdAt: string }): void;
  getOrganization(id: string): OrganizationRecord | undefined;
  getOrganizationBySlug(slug: string): OrganizationRecord | undefined;
  listOrganizationsForUser(userId: string): OrganizationRecord[];
  insertMember(input: Membership): void;
  getMember(organizationId: string, userId: string): Membership | undefined;
  listMembers(organizationId: string): Membership[];
  updateMemberRole(organizationId: string, userId: string, role: OrgRole): void;
  deleteMembersForUser(userId: string): void;
  countRole(organizationId: string, role: OrgRole): number;
  insertInvitation(input: InvitationRecord & { tokenHash: string; createdAt: string }): void;
  getInvitationByHash(tokenHash: string): InvitationRecord | undefined;
  markInvitationAccepted(id: string, at: string): void;
  saveProfile(input: PublisherProfile): void;
  getProfile(organizationId: string): PublisherProfile | undefined;
  insertDomain(input: DomainVerification): void;
  getDomain(id: string): DomainVerification | undefined;
  findDomain(organizationId: string, domain: string): DomainVerification | undefined;
  listDomains(organizationId: string): DomainVerification[];
  listPendingDomains(): DomainVerification[];
  markDomain(id: string, status: DomainStatus, evidence: string, reviewedBy: string | null, verifiedAt: string | null): void;
  insertAppeal(input: AppealRecord): void;
  listOpenAppeals(): AppealRecord[];
  getAppeal(id: string): AppealRecord | undefined;
  decideAppeal(id: string, status: "upheld" | "reversed", at: string, decidedBy: string): void;
  insertNotification(input: PublisherNotification): void;
  listNotifications(organizationId: string): PublisherNotification[];
  insertAudit(input: AuditRecord): void;
  listAudit(limit: number): AuditRecord[];
}

export function createIdentityStore(db: Database.Database): IdentityStore {
  return {
    insertUser(input) {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, email_verified_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(input.id, input.email, input.passwordHash, input.displayName, input.emailVerifiedAt, input.createdAt, input.updatedAt);
    },
    getUser(id) {
      const row = db.prepare(
        `SELECT id, email, display_name as displayName, email_verified_at as emailVerifiedAt, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
         FROM users WHERE id = ?`,
      ).get(id) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : undefined;
    },
    getCredentialByEmail(email) {
      const row = db.prepare(
        `SELECT id, email, password_hash as passwordHash, display_name as displayName, email_verified_at as emailVerifiedAt, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
         FROM users WHERE email = ?`,
      ).get(email) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { ...mapUser(row), passwordHash: String(row.passwordHash) };
    },
    markEmailVerified(id, at) {
      db.prepare(`UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?`).run(at, at, id);
    },
    setPassword(id, passwordHash, at) {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(passwordHash, at, id);
    },
    anonymizeUser(id, email, at) {
      db.prepare(
        `UPDATE users SET email = ?, password_hash = ?, display_name = ?, deleted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(email, "deleted", "Deleted account", at, at, id);
    },
    listExpiredDeletions(cutoff) {
      const rows = db.prepare(
        `SELECT id, email, display_name as displayName, email_verified_at as emailVerifiedAt, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
         FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      ).all(cutoff) as Array<Record<string, unknown>>;
      return rows.map(mapUser);
    },
    deleteUser(id) {
      const run = db.transaction(() => {
        db.prepare(`DELETE FROM web_sessions WHERE user_id = ?`).run(id);
        db.prepare(`DELETE FROM email_tokens WHERE user_id = ?`).run(id);
        db.prepare(`DELETE FROM organization_members WHERE user_id = ?`).run(id);
        db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
      });
      run();
    },
    insertSession(input) {
      db.prepare(
        `INSERT INTO web_sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ).run(input.id, input.userId, input.tokenHash, input.csrfToken, input.createdAt, input.expiresAt);
    },
    getSessionByHash(tokenHash) {
      const row = db.prepare(
        `SELECT id, user_id as userId, csrf_token as csrfToken, created_at as createdAt, expires_at as expiresAt, revoked_at as revokedAt
         FROM web_sessions WHERE token_hash = ?`,
      ).get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        userId: String(row.userId),
        csrfToken: String(row.csrfToken),
        createdAt: String(row.createdAt),
        expiresAt: String(row.expiresAt),
        revokedAt: row.revokedAt == null ? null : String(row.revokedAt),
      };
    },
    revokeSession(id, at) {
      db.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE id = ?`).run(at, id);
    },
    insertEmailToken(input) {
      db.prepare(
        `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ).run(input.id, input.userId, input.purpose, input.tokenHash, input.expiresAt, input.createdAt);
    },
    getEmailToken(tokenHash) {
      const row = db.prepare(
        `SELECT id, user_id as userId, purpose, expires_at as expiresAt, used_at as usedAt FROM email_tokens WHERE token_hash = ?`,
      ).get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        userId: String(row.userId),
        purpose: row.purpose === "reset" ? "reset" : "verify",
        expiresAt: String(row.expiresAt),
        usedAt: row.usedAt == null ? null : String(row.usedAt),
      };
    },
    markEmailTokenUsed(id, at) {
      db.prepare(`UPDATE email_tokens SET used_at = ? WHERE id = ?`).run(at, id);
    },
    insertOrganization(input) {
      db.prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(input.id, input.name, input.slug, input.createdAt, input.createdAt);
    },
    getOrganization(id) {
      const row = db.prepare(
        `SELECT id, name, slug, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ? AND deleted_at IS NULL`,
      ).get(id) as Record<string, unknown> | undefined;
      return row ? mapOrg(row) : undefined;
    },
    getOrganizationBySlug(slug) {
      const row = db.prepare(
        `SELECT id, name, slug, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE slug = ? AND deleted_at IS NULL`,
      ).get(slug) as Record<string, unknown> | undefined;
      return row ? mapOrg(row) : undefined;
    },
    listOrganizationsForUser(userId) {
      const rows = db.prepare(
        `SELECT o.id, o.name, o.slug, o.created_at as createdAt, o.updated_at as updatedAt, m.role as role
         FROM organizations o INNER JOIN organization_members m ON m.organization_id = o.id
         WHERE m.user_id = ? AND o.deleted_at IS NULL ORDER BY o.name`,
      ).all(userId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...mapOrg(row), role: row.role as OrgRole }));
    },
    insertMember(input) {
      db.prepare(
        `INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      ).run(input.organizationId, input.userId, input.role, input.createdAt);
    },
    getMember(organizationId, userId) {
      const row = db.prepare(
        `SELECT organization_id as organizationId, user_id as userId, role, created_at as createdAt
         FROM organization_members WHERE organization_id = ? AND user_id = ?`,
      ).get(organizationId, userId) as Record<string, unknown> | undefined;
      return row ? mapMember(row) : undefined;
    },
    listMembers(organizationId) {
      const rows = db.prepare(
        `SELECT organization_id as organizationId, user_id as userId, role, created_at as createdAt
         FROM organization_members WHERE organization_id = ? ORDER BY created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map(mapMember);
    },
    updateMemberRole(organizationId, userId, role) {
      db.prepare(`UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?`).run(role, organizationId, userId);
    },
    deleteMembersForUser(userId) {
      db.prepare(`DELETE FROM organization_members WHERE user_id = ?`).run(userId);
    },
    countRole(organizationId, role) {
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM organization_members WHERE organization_id = ? AND role = ?`,
      ).get(organizationId, role) as { count: number };
      return Number(row.count);
    },
    insertInvitation(input) {
      db.prepare(
        `INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at, accepted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(input.id, input.organizationId, input.email, input.role, input.tokenHash, input.invitedBy, input.expiresAt, input.createdAt);
    },
    getInvitationByHash(tokenHash) {
      const row = db.prepare(
        `SELECT id, organization_id as organizationId, email, role, expires_at as expiresAt, accepted_at as acceptedAt, invited_by as invitedBy
         FROM organization_invitations WHERE token_hash = ?`,
      ).get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        organizationId: String(row.organizationId),
        email: String(row.email),
        role: row.role as OrgRole,
        expiresAt: String(row.expiresAt),
        acceptedAt: row.acceptedAt == null ? null : String(row.acceptedAt),
        invitedBy: String(row.invitedBy),
      };
    },
    markInvitationAccepted(id, at) {
      db.prepare(`UPDATE organization_invitations SET accepted_at = ? WHERE id = ?`).run(at, id);
    },
    saveProfile(input) {
      db.prepare(
        `INSERT INTO publisher_profiles (organization_id, legal_name, support_url, privacy_url, terms_url, regions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id) DO UPDATE SET
           legal_name = excluded.legal_name, support_url = excluded.support_url, privacy_url = excluded.privacy_url,
           terms_url = excluded.terms_url, regions_json = excluded.regions_json, updated_at = excluded.updated_at`,
      ).run(input.organizationId, input.legalName, input.supportUrl, input.privacyUrl, input.termsUrl, JSON.stringify(input.regions), input.createdAt, input.updatedAt);
    },
    getProfile(organizationId) {
      const row = db.prepare(
        `SELECT organization_id as organizationId, legal_name as legalName, support_url as supportUrl, privacy_url as privacyUrl,
                terms_url as termsUrl, regions_json as regionsJson, created_at as createdAt, updated_at as updatedAt
         FROM publisher_profiles WHERE organization_id = ?`,
      ).get(organizationId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        organizationId: String(row.organizationId),
        legalName: String(row.legalName),
        supportUrl: String(row.supportUrl),
        privacyUrl: String(row.privacyUrl),
        termsUrl: String(row.termsUrl),
        regions: parseList(row.regionsJson),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
      };
    },
    insertDomain(input) {
      db.prepare(
        `INSERT INTO domain_verifications (id, organization_id, domain, method, token, status, evidence, reviewed_by, created_at, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.organizationId, input.domain, input.method, input.token, input.status, input.evidence, input.reviewedBy, input.createdAt, input.verifiedAt);
    },
    getDomain(id) {
      return mapDomain(db.prepare(domainSelect + ` WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
    },
    findDomain(organizationId, domain) {
      return mapDomain(db.prepare(domainSelect + ` WHERE organization_id = ? AND domain = ?`).get(organizationId, domain) as Record<string, unknown> | undefined);
    },
    listDomains(organizationId) {
      const rows = db.prepare(domainSelect + ` WHERE organization_id = ? ORDER BY domain`).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => mapDomain(row)!);
    },
    listPendingDomains() {
      const rows = db.prepare(domainSelect + ` WHERE status = 'pending' AND method = 'manual' ORDER BY created_at`).all() as Array<Record<string, unknown>>;
      return rows.map((row) => mapDomain(row)!);
    },
    markDomain(id, status, evidence, reviewedBy, verifiedAt) {
      db.prepare(
        `UPDATE domain_verifications SET status = ?, evidence = ?, reviewed_by = ?, verified_at = ? WHERE id = ?`,
      ).run(status, evidence, reviewedBy, verifiedAt, id);
    },
    insertAppeal(input) {
      db.prepare(
        `INSERT INTO listing_appeals (id, listing_id, organization_id, note, status, created_at, decided_at, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      ).run(input.id, input.listingId, input.organizationId, input.note, input.status, input.createdAt);
    },
    listOpenAppeals() {
      const rows = db.prepare(appealSelect + ` WHERE status = 'open' ORDER BY created_at`).all() as Array<Record<string, unknown>>;
      return rows.map((row) => mapAppeal(row)!);
    },
    getAppeal(id) {
      return mapAppeal(db.prepare(appealSelect + ` WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
    },
    decideAppeal(id, status, at, decidedBy) {
      db.prepare(`UPDATE listing_appeals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`).run(status, at, decidedBy, id);
    },
    insertNotification(input) {
      db.prepare(
        `INSERT INTO publisher_notifications (id, organization_id, listing_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.organizationId, input.listingId, input.kind, input.message, input.createdAt);
    },
    listNotifications(organizationId) {
      const rows = db.prepare(
        `SELECT id, organization_id as organizationId, listing_id as listingId, kind, message, created_at as createdAt
         FROM publisher_notifications WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organizationId),
        listingId: row.listingId == null ? null : String(row.listingId),
        kind: String(row.kind),
        message: String(row.message),
        createdAt: String(row.createdAt),
      }));
    },
    insertAudit(input) {
      db.prepare(
        `INSERT INTO admin_audit_log (id, actor_kind, actor_id, action, subject_type, subject_id, organization_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.actorKind, input.actorId, input.action, input.subjectType, input.subjectId, input.organizationId, input.detailJson, input.createdAt);
    },
    listAudit(limit) {
      const rows = db.prepare(
        `SELECT id, actor_kind as actorKind, actor_id as actorId, action, subject_type as subjectType, subject_id as subjectId,
                organization_id as organizationId, detail_json as detailJson, created_at as createdAt
         FROM admin_audit_log ORDER BY created_at DESC LIMIT ?`,
      ).all(limit) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        actorKind: row.actorKind === "staff" ? "staff" as const : "user" as const,
        actorId: String(row.actorId),
        action: String(row.action),
        subjectType: String(row.subjectType),
        subjectId: String(row.subjectId),
        organizationId: row.organizationId == null ? null : String(row.organizationId),
        detailJson: String(row.detailJson),
        createdAt: String(row.createdAt),
      }));
    },
  };
}

const domainSelect = `SELECT id, organization_id as organizationId, domain, method, token, status, evidence, reviewed_by as reviewedBy, created_at as createdAt, verified_at as verifiedAt FROM domain_verifications`;
const appealSelect = `SELECT id, listing_id as listingId, organization_id as organizationId, note, status, created_at as createdAt, decided_at as decidedAt, decided_by as decidedBy FROM listing_appeals`;

function mapUser(row: Record<string, unknown>): PublicUser {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.displayName),
    emailVerifiedAt: row.emailVerifiedAt == null ? null : String(row.emailVerifiedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    deletedAt: row.deletedAt == null ? null : String(row.deletedAt),
  };
}

function mapOrg(row: Record<string, unknown>): OrganizationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapMember(row: Record<string, unknown>): Membership {
  return {
    organizationId: String(row.organizationId),
    userId: String(row.userId),
    role: row.role as OrgRole,
    createdAt: String(row.createdAt),
  };
}

function mapDomain(row: Record<string, unknown> | undefined): DomainVerification | undefined {
  if (!row) return undefined;
  const method = row.method === "http_file" || row.method === "manual" ? row.method : "dns_txt";
  const status = row.status === "verified" || row.status === "rejected" ? row.status : "pending";
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    domain: String(row.domain),
    method,
    token: String(row.token),
    status,
    evidence: String(row.evidence ?? ""),
    reviewedBy: row.reviewedBy == null ? null : String(row.reviewedBy),
    createdAt: String(row.createdAt),
    verifiedAt: row.verifiedAt == null ? null : String(row.verifiedAt),
  };
}

function mapAppeal(row: Record<string, unknown> | undefined): AppealRecord | undefined {
  if (!row) return undefined;
  const status = row.status === "upheld" || row.status === "reversed" ? row.status : "open";
  return {
    id: String(row.id),
    listingId: String(row.listingId),
    organizationId: String(row.organizationId),
    note: String(row.note),
    status,
    createdAt: String(row.createdAt),
    decidedAt: row.decidedAt == null ? null : String(row.decidedAt),
    decidedBy: row.decidedBy == null ? null : String(row.decidedBy),
  };
}

function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
