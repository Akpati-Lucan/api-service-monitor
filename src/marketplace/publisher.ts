import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { AppConfig } from "../types/index.js";
import { conflict, forbidden, notFound, unauthorized, validationError } from "../utils/errors.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { applyListingUpdate, createDraft, submitListing, type ListingInput } from "./catalog.js";
import { findSecrets } from "./secrets.js";
import { assertPublicDestination, hostWithin, type DestinationDeps } from "./urls.js";
import type { IdentityStore, OrgRole, PublicUser, SessionRecord } from "./identity.js";
import type { ListingRecord, MarketplaceStore } from "./store.js";

export const SESSION_DAYS = 14;
export const VERIFY_HOURS = 24;
export const RESET_HOURS = 1;
export const DELETED_ACCOUNT_DAYS = 30;
export const SESSION_COOKIE = "vision_session";

const roles: OrgRole[] = ["owner", "admin", "editor", "billing", "viewer"];
const editRoles = new Set<OrgRole>(["owner", "admin", "editor"]);
const adminRoles = new Set<OrgRole>(["owner", "admin"]);

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (message: OutboundMail) => Promise<void>;

export interface PublisherDeps extends DestinationDeps {
  config: AppConfig;
  mailer: Mailer;
  resolveTxt?: (hostname: string) => Promise<string[]>;
}

export interface SessionGrant {
  token: string;
  csrfToken: string;
  user: PublicUser;
}

export function purgeExpiredAccounts(identity: IdentityStore, now = new Date()): void {
  const cutoff = new Date(now.getTime() - DELETED_ACCOUNT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  for (const user of identity.listExpiredDeletions(cutoff)) identity.deleteUser(user.id);
}

export async function registerAccount(identity: IdentityStore, deps: PublisherDeps, input: { email: string; displayName: string; password: string }, now = new Date()): Promise<void> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!email.includes("@") || email.length > 200) throw validationError("Validation failed", { email: ["enter an email address"] });
  if (displayName.length < 1 || displayName.length > 80) throw validationError("Validation failed", { displayName: ["display name must be 1 to 80 characters"] });
  if (input.password.length < 12 || input.password.length > 200) throw validationError("Validation failed", { password: ["password must be 12 to 200 characters"] });
  const existing = identity.getCredentialByEmail(email);
  if (existing) {
    await verifyPassword(input.password, existing.passwordHash);
    return;
  }
  const user: PublicUser = {
    id: randomUUID(),
    email,
    displayName,
    emailVerifiedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null,
  };
  identity.insertUser({ ...user, passwordHash: await hashPassword(input.password) });
  await sendToken(identity, deps, user, "verify", "Verify your Vision API email", now);
  audit(identity, "user", user.id, "user.register", "user", user.id, null, { email }, now);
}

export function loadSession(identity: IdentityStore, cookieHeader: string | undefined, now = new Date()): { user: PublicUser; session: SessionRecord } {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) throw unauthorized("Sign in to continue.");
  const session = identity.getSessionByHash(sha256(token));
  if (!session || session.revokedAt || session.expiresAt <= now.toISOString()) throw unauthorized("Sign in to continue.");
  const user = identity.getUser(session.userId);
  if (!user || user.deletedAt) throw unauthorized("Sign in to continue.");
  return { user, session };
}

export function assertCsrf(session: SessionRecord, body: unknown, header: string | undefined): void {
  const fromBody = body && typeof body === "object" && typeof (body as { csrf?: unknown }).csrf === "string" ? (body as { csrf: string }).csrf : "";
  const presented = fromBody || header || "";
  const left = Buffer.from(presented);
  const right = Buffer.from(session.csrfToken);
  if (left.length === 0 || left.length !== right.length || !timingSafeEqual(left, right)) {
    throw forbidden("The form token does not match this session.");
  }
}

export async function verifyEmail(identity: IdentityStore, token: string, now = new Date()): Promise<void> {
  const row = consumeToken(identity, token, "verify", now);
  identity.markEmailVerified(row.userId, now.toISOString());
  audit(identity, "user", row.userId, "user.verify", "user", row.userId, null, {}, now);
}

export async function loginAccount(identity: IdentityStore, email: string, password: string, now = new Date()): Promise<SessionGrant> {
  const credential = identity.getCredentialByEmail(normalizeEmail(email));
  const hash = credential?.passwordHash ?? "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const matches = await verifyPassword(password, hash);
  if (!credential || credential.deletedAt || !matches) throw unauthorized("Email or password is wrong.");
  const user = identity.getUser(credential.id);
  if (!user) throw unauthorized("Email or password is wrong.");
  return openSession(identity, user, now);
}

export function logoutAccount(identity: IdentityStore, session: SessionRecord, now = new Date()): void {
  identity.revokeSession(session.id, now.toISOString());
}

export async function requestPasswordReset(identity: IdentityStore, deps: PublisherDeps, email: string, now = new Date()): Promise<void> {
  const credential = identity.getCredentialByEmail(normalizeEmail(email));
  if (!credential || credential.deletedAt) return;
  const user = identity.getUser(credential.id);
  if (!user) return;
  await sendToken(identity, deps, user, "reset", "Reset your Vision API password", now);
}

export async function resetPassword(identity: IdentityStore, token: string, password: string, now = new Date()): Promise<void> {
  if (password.length < 12 || password.length > 200) throw validationError("Validation failed", { password: ["password must be 12 to 200 characters"] });
  const row = consumeToken(identity, token, "reset", now);
  const user = identity.getUser(row.userId);
  if (!user || user.deletedAt) throw notFound("This reset link is no longer valid.");
  identity.setPassword(user.id, await hashPassword(password), now.toISOString());
}

export function exportAccount(identity: IdentityStore, store: MarketplaceStore, user: PublicUser) {
  const organizations = identity.listOrganizationsForUser(user.id).map((org) => ({
    ...org,
    profile: identity.getProfile(org.id) ?? null,
    listings: store.listOwnedListings(org.id).map(publicOwned),
    notifications: identity.listNotifications(org.id),
  }));
  return {
    retention: {
      sessionDays: SESSION_DAYS,
      verificationHours: VERIFY_HOURS,
      resetHours: RESET_HOURS,
      deletedAccountDays: DELETED_ACCOUNT_DAYS,
    },
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    },
    organizations,
  };
}

export function deleteAccount(identity: IdentityStore, user: PublicUser, password: string, passwordHash: string, now = new Date()): Promise<void> {
  return verifyPassword(password, passwordHash).then((matches) => {
    if (!matches) throw unauthorized("Email or password is wrong.");
    for (const org of identity.listOrganizationsForUser(user.id)) {
      if (org.role === "owner" && identity.countRole(org.id, "owner") < 2) {
        throw conflict(`Transfer ownership of ${org.name} before deleting this account.`);
      }
    }
    identity.deleteMembersForUser(user.id);
    identity.anonymizeUser(user.id, `deleted+${user.id}@users.invalid`, now.toISOString());
    audit(identity, "user", user.id, "user.delete", "user", user.id, null, {}, now);
  });
}

export function createOrganization(identity: IdentityStore, user: PublicUser, name: string, now = new Date()) {
  requireVerified(user);
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw validationError("Validation failed", { name: ["organization name must be 1 to 80 characters"] });
  const slug = uniqueOrgSlug(identity, slugify(trimmed));
  const id = randomUUID();
  identity.insertOrganization({ id, name: trimmed, slug, createdAt: now.toISOString() });
  identity.insertMember({ organizationId: id, userId: user.id, role: "owner", createdAt: now.toISOString() });
  audit(identity, "user", user.id, "organization.create", "organization", id, id, { name: trimmed }, now);
  return identity.getOrganization(id);
}

export async function saveProfile(identity: IdentityStore, deps: PublisherDeps, user: PublicUser, organizationId: string, input: { legalName: string; supportUrl: string; privacyUrl: string; termsUrl: string; regions: string }, now = new Date()) {
  requireRole(identity, user, organizationId, "admin");
  const legalName = input.legalName.trim();
  if (legalName.length < 1 || legalName.length > 160) throw validationError("Validation failed", { legalName: ["legal name is required"] });
  const supportUrl = await assertPublicDestination(input.supportUrl, deps);
  const privacyUrl = await assertPublicDestination(input.privacyUrl, deps);
  const termsUrl = await assertPublicDestination(input.termsUrl, deps);
  const regions = input.regions.split(",").map((item) => item.trim()).filter((item) => item.length > 0).slice(0, 20);
  identity.saveProfile({
    organizationId,
    legalName,
    supportUrl,
    privacyUrl,
    termsUrl,
    regions,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  audit(identity, "user", user.id, "profile.save", "organization", organizationId, organizationId, { legalName }, now);
}

export async function inviteMember(identity: IdentityStore, deps: PublisherDeps, user: PublicUser, organizationId: string, email: string, role: string, now = new Date()) {
  requireRole(identity, user, organizationId, "admin");
  if (!roles.includes(role as OrgRole) || (role === "owner" && !isOwner(identity, user.id, organizationId))) {
    throw validationError("Validation failed", { role: ["choose a role this account can grant"] });
  }
  const normalized = normalizeEmail(email);
  const token = randomBytes(24).toString("hex");
  const id = randomUUID();
  identity.insertInvitation({
    id,
    organizationId,
    email: normalized,
    role: role as OrgRole,
    invitedBy: user.id,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null,
    tokenHash: sha256(token),
    createdAt: now.toISOString(),
  });
  await deps.mailer({
    to: normalized,
    subject: "Join an organization on Vision API",
    text: `Open ${deps.config.STATUS_BASE_URL}/account and accept this invitation token: ${token}`,
  });
  audit(identity, "user", user.id, "member.invite", "organization", organizationId, organizationId, { email: normalized, role }, now);
}

export function acceptInvitation(identity: IdentityStore, user: PublicUser, token: string, now = new Date()) {
  requireVerified(user);
  const invitation = identity.getInvitationByHash(sha256(token.trim()));
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= now.toISOString()) throw notFound("This invitation is no longer valid.");
  if (invitation.email !== user.email) throw forbidden("This invitation was sent to a different email.");
  if (!identity.getMember(invitation.organizationId, user.id)) {
    identity.insertMember({ organizationId: invitation.organizationId, userId: user.id, role: invitation.role, createdAt: now.toISOString() });
  }
  identity.markInvitationAccepted(invitation.id, now.toISOString());
  audit(identity, "user", user.id, "member.accept", "organization", invitation.organizationId, invitation.organizationId, { role: invitation.role }, now);
}

export function changeRole(identity: IdentityStore, user: PublicUser, organizationId: string, memberId: string, role: string, now = new Date()) {
  requireRole(identity, user, organizationId, "admin");
  if (!roles.includes(role as OrgRole)) throw validationError("Validation failed", { role: ["unknown role"] });
  const member = identity.getMember(organizationId, memberId);
  if (!member) throw notFound("Member does not exist");
  if ((member.role === "owner" || role === "owner") && !isOwner(identity, user.id, organizationId)) {
    throw forbidden("Only an owner can change an owner.");
  }
  if (member.role === "owner" && role !== "owner" && identity.countRole(organizationId, "owner") < 2) {
    throw conflict("The organization needs another owner first.");
  }
  identity.updateMemberRole(organizationId, memberId, role as OrgRole);
  audit(identity, "user", user.id, "member.role", "user", memberId, organizationId, { role }, now);
}

export function startDomain(identity: IdentityStore, user: PublicUser, organizationId: string, domain: string, method: string, now = new Date()) {
  requireRole(identity, user, organizationId, "admin");
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized) || normalized.includes("..")) {
    throw validationError("Validation failed", { domain: ["enter the provider domain"] });
  }
  if (!["dns_txt", "http_file", "manual"].includes(method)) throw validationError("Validation failed", { method: ["choose dns, file, or manual review"] });
  const existing = identity.findDomain(organizationId, normalized);
  if (existing) return existing;
  const row = {
    id: randomUUID(),
    organizationId,
    domain: normalized,
    method: method as "dns_txt" | "http_file" | "manual",
    token: randomBytes(18).toString("hex"),
    status: "pending" as const,
    evidence: "",
    reviewedBy: null,
    createdAt: now.toISOString(),
    verifiedAt: null,
  };
  identity.insertDomain(row);
  return row;
}

export async function checkDomain(identity: IdentityStore, deps: PublisherDeps, user: PublicUser, organizationId: string, domainId: string, now = new Date()) {
  requireRole(identity, user, organizationId, "admin");
  const row = identity.getDomain(domainId);
  if (!row || row.organizationId !== organizationId) throw notFound("Domain check does not exist");
  if (row.method === "manual") throw validationError("Validation failed", { method: ["a reviewer completes a manual check"] });
  if (row.method === "dns_txt") {
    const lookup = deps.resolveTxt ?? defaultResolveTxt;
    let records: string[] = [];
    try {
      records = await lookup(`_vision-api.${row.domain}`);
    } catch {
      records = [];
    }
    if (!records.some((record) => record.includes(`vision-verify=${row.token}`))) {
      throw validationError("Validation failed", { domain: ["the TXT record was not found"] });
    }
    identity.markDomain(row.id, "verified", "dns txt matched", user.id, now.toISOString());
  } else {
    const url = await assertPublicDestination(`https://${row.domain}/.well-known/vision-api-verify.txt`, deps);
    const response = await (deps.fetchImpl ?? fetch)(url, { redirect: "manual" });
    const text = await response.text();
    if (text.trim() !== row.token) throw validationError("Validation failed", { domain: ["the verification file did not match"] });
    identity.markDomain(row.id, "verified", "http file matched", user.id, now.toISOString());
  }
  audit(identity, "user", user.id, "domain.verify", "domain", domainId, organizationId, { domain: row.domain, method: row.method }, now);
}

export function verifyDomainManual(identity: IdentityStore, domainId: string, note: string, now = new Date()) {
  const row = identity.getDomain(domainId);
  if (!row) throw notFound("Domain check does not exist");
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  identity.markDomain(row.id, "verified", trimmed, "staff", now.toISOString());
  audit(identity, "staff", "staff", "domain.manual", "domain", row.id, row.organizationId, { domain: row.domain }, now);
}

export async function createPublisherListing(identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, user: PublicUser, organizationId: string, input: ListingInput, now = new Date()) {
  requireRole(identity, user, organizationId, "edit");
  requireProfile(identity, organizationId);
  const listing = await createDraft(store, input, deps, now, organizationId);
  audit(identity, "user", user.id, "listing.create", "listing", listing.id, organizationId, { name: listing.name }, now);
  return listing;
}

export async function updatePublisherListing(identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, user: PublicUser, organizationId: string, listingId: string, input: ListingInput, now = new Date()) {
  requireRole(identity, user, organizationId, "edit");
  const current = ownedListing(store, organizationId, listingId);
  if (!["draft", "changes_requested", "published"].includes(current.status)) {
    throw validationError("Validation failed", { status: ["this listing cannot be edited"] });
  }
  return applyListingUpdate(store, current.id, input, deps, now);
}

export function submitPublisherListing(identity: IdentityStore, store: MarketplaceStore, user: PublicUser, organizationId: string, listingId: string, now = new Date()) {
  requireRole(identity, user, organizationId, "edit");
  requireProfile(identity, organizationId);
  const listing = ownedListing(store, organizationId, listingId);
  if (!domainCovers(identity, organizationId, listing.providerDomain)) {
    throw validationError("Validation failed", { domain: ["verify the provider domain before submitting"] });
  }
  const saved = submitListing(store, listing.id, now);
  audit(identity, "user", user.id, "listing.submit", "listing", listing.id, organizationId, { domain: listing.providerDomain }, now);
  return saved;
}

export function attachGuide(identity: IdentityStore, store: MarketplaceStore, user: PublicUser, organizationId: string, listingId: string, input: { title: string; summary: string; bodyMd: string }, now = new Date()) {
  requireRole(identity, user, organizationId, "edit");
  const listing = ownedListing(store, organizationId, listingId);
  const title = input.title.trim();
  const summary = input.summary.trim();
  const bodyMd = input.bodyMd;
  if (title.length < 1 || summary.length < 1 || bodyMd.trim().length < 1) {
    throw validationError("Validation failed", { title: ["title, summary, and body are required"] });
  }
  if (findSecrets(`${bodyMd}\n${summary}`).length > 0) {
    throw validationError("Validation failed", { bodyMd: ["do not include a credential"] });
  }
  const id = randomUUID();
  store.insertGuide({
    id,
    listingId: listing.id,
    slug: uniqueGuideSlug(store, slugify(title)),
    title,
    summary,
    bodyMd,
    prerequisites: "A verified publisher account.",
    difficulty: "beginner",
    published: false,
    verifiedAt: null,
    verifiedBy: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    kind: "setup",
    locale: "en",
    purpose: summary,
    setupUrl: null,
    minPermissions: "Read the provider documentation.",
    credentialLocation: "The provider dashboard. The key stays with the reader.",
    localTestMd: "Try the provider sandbox with YOUR_API_KEY.",
    productionMd: "Create the monitor in your own account.",
    securityNotes: "Do not paste a live key into Vision API.",
    costNotes: "The provider may charge for live use.",
    commonErrorsMd: "A failed check can belong to the reader or the provider.",
    cleanupMd: "Disable the test key at the provider.",
    docsUrl: null,
    testedVersion: "",
    testEnvironment: "",
    compatibilityNotes: "English (en).",
    exampleText: "",
    successMd: "The provider sandbox shows a test identifier.",
    revision: 1,
  });
  audit(identity, "user", user.id, "guide.attach", "guide", id, organizationId, { listingId: listing.id }, now);
  return id;
}

export function appealListing(identity: IdentityStore, store: MarketplaceStore, user: PublicUser, organizationId: string, listingId: string, note: string, now = new Date()) {
  requireRole(identity, user, organizationId, "edit");
  const listing = ownedListing(store, organizationId, listingId);
  if (listing.status !== "suspended" && listing.status !== "draft") {
    throw validationError("Validation failed", { status: ["appeal a suspension or a rejection"] });
  }
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  const id = randomUUID();
  identity.insertAppeal({
    id,
    listingId: listing.id,
    organizationId,
    note: trimmed,
    status: "open",
    createdAt: now.toISOString(),
    decidedAt: null,
    decidedBy: null,
  });
  audit(identity, "user", user.id, "listing.appeal", "listing", listing.id, organizationId, {}, now);
  return id;
}

export function decideAppeal(identity: IdentityStore, store: MarketplaceStore, appealId: string, decision: "upheld" | "reversed", note: string, now = new Date()) {
  const appeal = identity.getAppeal(appealId);
  if (!appeal || appeal.status !== "open") throw notFound("Appeal does not exist");
  const trimmed = note.trim();
  if (trimmed.length < 1 || trimmed.length > 500) throw validationError("Validation failed", { note: ["note must be 1 to 500 characters"] });
  identity.decideAppeal(appeal.id, decision, now.toISOString(), "staff");
  if (decision === "reversed") {
    store.updateListing(appeal.listingId, { status: "changes_requested", reviewNote: trimmed, reviewedBy: "staff", updatedAt: now.toISOString() });
  }
  audit(identity, "staff", "staff", "appeal.decide", "listing", appeal.listingId, appeal.organizationId, { decision }, now);
}

export async function afterModeration(identity: IdentityStore, store: MarketplaceStore, deps: PublisherDeps, listingId: string, decision: string, note: string, now = new Date()) {
  const listing = store.getListing(listingId);
  if (!listing) return;
  audit(identity, "staff", "staff", "listing.review", "listing", listing.id, listing.publisherId, { decision }, now);
  if (!listing.publisherId) return;
  const message = `${listing.name} is ${listing.status}. ${note}`.slice(0, 500);
  identity.insertNotification({
    id: randomUUID(),
    organizationId: listing.publisherId,
    listingId: listing.id,
    kind: decision,
    message,
    createdAt: now.toISOString(),
  });
  for (const member of identity.listMembers(listing.publisherId)) {
    if (!editRoles.has(member.role)) continue;
    const person = identity.getUser(member.userId);
    if (!person || person.deletedAt) continue;
    try {
      await deps.mailer({ to: person.email, subject: `Vision API listing ${listing.status}`, text: message });
    } catch {
      audit(identity, "staff", "staff", "mail.failed", "listing", listing.id, listing.publisherId, {}, now);
    }
  }
}

export function duplicateLines(store: MarketplaceStore, listings: ListingRecord[]): string[] {
  const lines: string[] = [];
  for (const listing of listings) {
    if (listing.status !== "submitted") continue;
    const domain = listing.providerDomain.toLowerCase();
    const matches = listings.filter((other) => other.id !== listing.id && other.status !== "draft" && other.providerDomain.toLowerCase() === domain);
    if (matches.length > 0) lines.push(`${listing.name}: ${matches.map((match) => match.name).join(", ")}`);
  }
  return lines;
}

export function ownedGuide(store: MarketplaceStore, organizationId: string, guideId: string) {
  const guide = store.getGuide(guideId);
  const listing = guide?.listingId ? store.getListing(guide.listingId) : undefined;
  if (!guide || !listing || listing.publisherId !== organizationId) throw notFound("Guide does not exist");
  return guide;
}

function ownedListing(store: MarketplaceStore, organizationId: string, listingId: string): ListingRecord {
  const listing = store.getListing(listingId);
  if (!listing || listing.publisherId !== organizationId) throw notFound("Listing does not exist");
  return listing;
}

function domainCovers(identity: IdentityStore, organizationId: string, providerDomain: string): boolean {
  return identity.listDomains(organizationId).some((row) => row.status === "verified" && hostWithin(row.domain, providerDomain));
}

function requireProfile(identity: IdentityStore, organizationId: string) {
  if (!identity.getProfile(organizationId)) throw validationError("Validation failed", { profile: ["add the publisher profile first"] });
}

function requireVerified(user: PublicUser) {
  if (!user.emailVerifiedAt) throw forbidden("Verify the email address before using the publisher portal.");
}

function requireRole(identity: IdentityStore, user: PublicUser, organizationId: string, level: "edit" | "admin") {
  requireVerified(user);
  const member = identity.getMember(organizationId, user.id);
  if (!member) throw notFound("Organization does not exist");
  if (level === "edit" && !editRoles.has(member.role)) throw forbidden("This role cannot edit listings.");
  if (level === "admin" && !adminRoles.has(member.role)) throw forbidden("This role cannot change the organization.");
}

function isOwner(identity: IdentityStore, userId: string, organizationId: string): boolean {
  return identity.getMember(organizationId, userId)?.role === "owner";
}

function publicOwned(listing: ListingRecord) {
  return {
    id: listing.id,
    name: listing.name,
    slug: listing.slug,
    status: listing.status,
    providerDomain: listing.providerDomain,
    updatedAt: listing.updatedAt,
  };
}

function openSession(identity: IdentityStore, user: PublicUser, now: Date): SessionGrant {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  identity.insertSession({
    id: randomUUID(),
    userId: user.id,
    tokenHash: sha256(token),
    csrfToken,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  return { token, csrfToken, user };
}

async function sendToken(identity: IdentityStore, deps: PublisherDeps, user: PublicUser, purpose: "verify" | "reset", subject: string, now: Date) {
  const token = randomBytes(24).toString("hex");
  const hours = purpose === "verify" ? VERIFY_HOURS : RESET_HOURS;
  identity.insertEmailToken({
    id: randomUUID(),
    userId: user.id,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
  });
  const path = purpose === "verify" ? `/account/verify?token=${token}` : `/account/reset?token=${token}`;
  await deps.mailer({ to: user.email, subject, text: `Open ${deps.config.STATUS_BASE_URL}${path}` });
}

function consumeToken(identity: IdentityStore, token: string, purpose: "verify" | "reset", now: Date) {
  const row = identity.getEmailToken(sha256(token));
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= now.toISOString()) throw notFound("This link is no longer valid.");
  identity.markEmailTokenUsed(row.id, now.toISOString());
  return row;
}

function audit(identity: IdentityStore, actorKind: "user" | "staff", actorId: string, action: string, subjectType: string, subjectId: string, organizationId: string | null, detail: Record<string, string>, now: Date) {
  identity.insertAudit({
    id: randomUUID(),
    actorKind,
    actorId,
    action,
    subjectType,
    subjectId,
    organizationId,
    detailJson: JSON.stringify(detail),
    createdAt: now.toISOString(),
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 60) || "org";
}

function uniqueOrgSlug(identity: IdentityStore, base: string): string {
  let slug = base;
  let suffix = 2;
  while (identity.getOrganizationBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function uniqueGuideSlug(store: MarketplaceStore, base: string): string {
  let slug = base;
  let suffix = 2;
  while (store.getGuideBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function defaultResolveTxt(hostname: string): Promise<string[]> {
  const records = await resolveTxt(hostname);
  return records.map((parts) => parts.join(""));
}

export function credentialHash(identity: IdentityStore, user: PublicUser): string {
  return identity.getCredentialByEmail(user.email)?.passwordHash ?? "";
}
