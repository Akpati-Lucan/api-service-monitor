import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../types/index.js";
import type { Logger } from "../utils/logger.js";
import { conflict, forbidden, notFound } from "../utils/errors.js";
import type { IdentityStore, OrgRole } from "./identity.js";
import {
  blankConnection,
  type ConnectionSecret,
  type ConnectionView,
  type IntegrationStore,
} from "./integrationStore.js";

// Phase 13A stores one customer grant for Example Status.
// The grant is an OAuth authorization code with PKCE and the scope status.read.
// A status check is a read. The encryption key stays in the environment.
// VISION_GATEWAY_ENABLED does not open a proxy, a meter, or a managed credential.

export const EXAMPLE_PROVIDER_ID = "example-status";
export const REQUIRED_SCOPE = "status.read";
export const HOURLY_LIMIT = 30;
export const RETENTION_DAYS = 30;
const GRANT_MINUTES = 10;
const MANAGE = new Set<OrgRole>(["owner", "admin"]);

export interface IntegrationManifest {
  id: typeof EXAMPLE_PROVIDER_ID;
  version: "1";
  capabilities: ["status.read"];
  authType: "oauth_authorization_code_pkce";
  scopes: ["status.read"];
  callbackPath: "/connections/callback";
  regions: ["US"];
  rateLimitPerHour: number;
  retentionDays: number;
  documentationUrl: string;
}

export const exampleManifest: IntegrationManifest = {
  id: EXAMPLE_PROVIDER_ID,
  version: "1",
  capabilities: ["status.read"],
  authType: "oauth_authorization_code_pkce",
  scopes: ["status.read"],
  callbackPath: "/connections/callback",
  regions: ["US"],
  rateLimitPerHour: HOURLY_LIMIT,
  retentionDays: RETENTION_DAYS,
  documentationUrl: "https://example.com/docs/status",
};

export type GrantVerdict = { ok: true } | { ok: false; reason: "missing_scope" | "expired" | "revoked" };

export interface IssuedGrant {
  accessToken: string;
  scopes: string[];
  expiresAt: string | null;
}

export interface IntegrationProvider {
  manifest: IntegrationManifest;
  authorize(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(input: { code: string; verifier: string; redirectUri: string }): Promise<IssuedGrant>;
  validate(input: { accessToken: string; scopes: string[]; expiresAt: string | null; now: string }): GrantVerdict;
  healthCheck(input: { accessToken: string }): Promise<{ status: "up" | "down" | "throttled"; method: string }>;
  disconnect(input: { accessToken: string }): Promise<void>;
  syncMetadata?(input: { accessToken: string }): Promise<{ region: string }>;
}

export interface ExampleStatusProvider extends IntegrationProvider {
  setBehavior(patch: Partial<{ scopes: string[]; expiresAt: string | null; revoked: boolean; health: "up" | "down" | "throttled"; method: string; region: string }>): void;
  healthCalls: number;
  lastMethod: string;
  issued: string[];
  latestToken(): string;
  remember(code: string, token: string): void;
}

interface SandboxBehavior {
  scopes: string[];
  expiresAt: string | null;
  revoked: boolean;
  health: "up" | "down" | "throttled";
  method: string;
  region: string;
}

export function createExampleStatusProvider(statusBase: string): ExampleStatusProvider {
  const codes = new Map<string, { token: string; scopes: string[]; expiresAt: string | null }>();
  const revoked = new Set<string>();
  const issued: string[] = [];
  let healthCalls = 0;
  let lastMethod = "";
  let behavior: SandboxBehavior = {
    scopes: ["status.read"],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revoked: false,
    health: "up",
    method: "GET",
    region: "US",
  };
  const provider: ExampleStatusProvider = {
    manifest: exampleManifest,
    issued,
    get healthCalls() {
      return healthCalls;
    },
    get lastMethod() {
      return lastMethod;
    },
    setBehavior(patch) {
      behavior = { ...behavior, ...patch };
    },
    latestToken() {
      return issued[issued.length - 1] ?? "";
    },
    remember(code, token) {
      issued.push(token);
      codes.set(code, { token, scopes: [...behavior.scopes], expiresAt: behavior.expiresAt });
    },
    authorize(input) {
      const url = new URL("/connections/sandbox/authorize", statusBase);
      url.searchParams.set("state", input.state);
      url.searchParams.set("scope", REQUIRED_SCOPE);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("redirect_uri", input.redirectUri);
      return url.toString();
    },
    async exchange(input) {
      const found = codes.get(input.code);
      codes.delete(input.code);
      if (!found) throw conflict("The provider did not complete the grant.");
      return { accessToken: found.token, scopes: found.scopes, expiresAt: found.expiresAt };
    },
    validate(input) {
      if (behavior.revoked || revoked.has(input.accessToken)) return { ok: false, reason: "revoked" };
      return assessGrant(input);
    },
    async healthCheck() {
      healthCalls += 1;
      lastMethod = behavior.method;
      return { status: behavior.health, method: behavior.method };
    },
    async disconnect(input) {
      revoked.add(input.accessToken);
    },
    async syncMetadata() {
      return { region: behavior.region };
    },
  };
  return provider;
}

export function mintSandboxCode(provider: { remember(code: string, token: string): void }): { code: string; token: string } {
  const code = `code_${randomBytes(12).toString("base64url")}`;
  const token = `est_${randomBytes(18).toString("base64url")}`;
  provider.remember(code, token);
  return { code, token };
}

export function createRemoteExampleProvider(input: {
  authorizeUrl: string;
  tokenUrl: string;
  healthUrl: string;
  clientId: string;
  fetchImpl: typeof fetch;
}): IntegrationProvider {
  const authorize = new URL(input.authorizeUrl);
  const token = new URL(input.tokenUrl);
  const health = new URL(input.healthUrl);
  if (authorize.protocol !== "https:" || token.protocol !== "https:" || health.protocol !== "https:") {
    throw conflict("The provider URLs must use HTTPS.");
  }
  if (token.host !== health.host) throw conflict("The status URL must use the provider host.");
  return {
    manifest: exampleManifest,
    authorize(request) {
      const url = new URL(authorize.toString());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", REQUIRED_SCOPE);
      url.searchParams.set("state", request.state);
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("redirect_uri", request.redirectUri);
      if (input.clientId) url.searchParams.set("client_id", input.clientId);
      return url.toString();
    },
    async exchange(request) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: request.code,
        code_verifier: request.verifier,
        redirect_uri: request.redirectUri,
      });
      if (input.clientId) body.set("client_id", input.clientId);
      const response = await input.fetchImpl(token.toString(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
      });
      if (!response.ok) throw conflict("The provider did not complete the grant.");
      const payload = await response.json() as { access_token?: unknown; scope?: unknown; expires_in?: unknown };
      if (typeof payload.access_token !== "string" || payload.access_token.length < 8) throw conflict("The provider did not complete the grant.");
      const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
      const expiresAt = typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null;
      return { accessToken: payload.access_token, scopes, expiresAt };
    },
    validate(request) {
      return assessGrant(request);
    },
    async healthCheck(request) {
      const response = await input.fetchImpl(health.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${request.accessToken}`, accept: "application/json" },
      });
      await response.arrayBuffer();
      if (response.status === 429) return { status: "throttled", method: "GET" };
      if (response.ok) return { status: "up", method: "GET" };
      return { status: "down", method: "GET" };
    },
    async disconnect(request) {
      const revoke = new URL("/oauth/revoke", token.origin);
      const response = await input.fetchImpl(revoke.toString(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: request.accessToken }),
      });
      await response.arrayBuffer();
    },
  };
}

export function resolveIntegrationProvider(config: AppConfig, injected?: IntegrationProvider): IntegrationProvider {
  if (injected) return injected;
  if (!config.VISION_EXAMPLE_TOKEN_URL) return createExampleStatusProvider(config.STATUS_BASE_URL);
  return createRemoteExampleProvider({
    authorizeUrl: config.VISION_EXAMPLE_AUTHORIZE_URL,
    tokenUrl: config.VISION_EXAMPLE_TOKEN_URL,
    healthUrl: config.VISION_EXAMPLE_HEALTH_URL,
    clientId: config.VISION_EXAMPLE_CLIENT_ID,
    fetchImpl: fetch,
  });
}

export function assessGrant(input: { scopes: string[]; expiresAt: string | null; now: string }): GrantVerdict {
  if (input.expiresAt && input.expiresAt <= input.now) return { ok: false, reason: "expired" };
  if (!input.scopes.includes(REQUIRED_SCOPE)) return { ok: false, reason: "missing_scope" };
  return { ok: true };
}

export function providerSentences(): string[] {
  return [
    "Example Status reads a status signal for this organization.",
    "The grant uses an authorization code and PKCE.",
    "Requested scope: status.read.",
    "Region US.",
    `Status reads this hour are limited to ${HOURLY_LIMIT}.`,
    `Usage records are removed after ${RETENTION_DAYS} days.`,
    "The encryption key stays outside this database.",
  ];
}

export function reasonSentence(reason: string): string {
  const sentences: Record<string, string> = {
    missing_scope: "The grant is missing status.read.",
    expired: "The grant has expired.",
    revoked: "The provider revoked this grant.",
    throttled: "The last status read was throttled.",
    quota: "This connection reached its hourly status-read limit.",
    down: "The provider status signal did not respond.",
    refused: "The status check must be a read.",
    denied: "The provider did not grant access.",
    disconnected: "This connection is disconnected.",
    region: "This provider is available in region US.",
  };
  return sentences[reason] ?? "";
}

export function connectionSentences(view: ConnectionView): string[] {
  const lines = [
    `State: ${view.status}`,
    `Scope on the grant: ${view.scopes || "none"}.`,
    `Region ${view.region}.`,
  ];
  if (view.lastHealthStatus) lines.push(`Last status read: ${view.lastHealthStatus}.`);
  const reason = reasonSentence(view.statusReason);
  if (reason) lines.push(reason);
  return lines;
}

export interface IntegrationKeys {
  current: Buffer;
  version: number;
  previous: Buffer | null;
  previousVersion: number | null;
}

export function loadIntegrationKeys(config: Pick<AppConfig, "VISION_INTEGRATION_KEY" | "VISION_INTEGRATION_KEY_VERSION" | "VISION_INTEGRATION_KEY_PREVIOUS">): IntegrationKeys | null {
  if (!config.VISION_INTEGRATION_KEY) return null;
  const current = decodeKey(config.VISION_INTEGRATION_KEY);
  const previous = config.VISION_INTEGRATION_KEY_PREVIOUS ? decodeKey(config.VISION_INTEGRATION_KEY_PREVIOUS) : null;
  return {
    current,
    version: config.VISION_INTEGRATION_KEY_VERSION,
    previous,
    previousVersion: previous ? config.VISION_INTEGRATION_KEY_VERSION - 1 : null,
  };
}

export function sealSecret(key: Buffer, plaintext: string): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function openSecret(key: Buffer, sealed: { iv: string; tag: string; ciphertext: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function assertAuthorizeLocation(location: string, statusBase: string): string {
  const target = new URL(location);
  const base = new URL(statusBase);
  if (target.origin === base.origin) return target.toString();
  if (target.protocol !== "https:") throw conflict("The provider authorization URL must use HTTPS.");
  return target.toString();
}

export function exportConnections(store: IntegrationStore, identity: IdentityStore, userId: string): ConnectionView[] {
  const views: ConnectionView[] = [];
  for (const org of identity.listOrganizationsForUser(userId)) views.push(...store.listViews(org.id));
  return views;
}

export function beginGrant(input: {
  store: IntegrationStore;
  identity: IdentityStore;
  keys: IntegrationKeys | null;
  provider: IntegrationProvider;
  userId: string;
  organizationId: string;
  action: "connect" | "reauthorize" | "rotate";
  redirectUri: string;
  statusBase: string;
  now: string;
}): { location: string } {
  if (!input.keys) throw conflict("An integration key is required before a grant can be stored.");
  const row = requireConnection(input.store, input.identity, input.userId, input.organizationId, input.action, input.keys.version, input.now);
  if (input.action === "rotate" && !row.ciphertext) throw conflict("Rotate replaces an existing grant.");
  const state = randomBytes(32).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const sealed = sealSecret(input.keys.current, verifier);
  const expires = new Date(Date.parse(input.now) + GRANT_MINUTES * 60 * 1000).toISOString();
  input.store.insertGrant({
    id: randomUUID(),
    connectionId: row.id,
    organizationId: row.organizationId,
    stateHash: sha256(state),
    challenge,
    keyVersion: input.keys.version,
    iv: sealed.iv,
    tag: sealed.tag,
    ciphertext: sealed.ciphertext,
    expiresAt: expires,
    consumedAt: null,
    createdAt: input.now,
  });
  writeAudit(input.identity, input.userId, `integration.${input.action}`, row, input.now, { providerId: EXAMPLE_PROVIDER_ID });
  const location = input.provider.authorize({ state, codeChallenge: challenge, redirectUri: input.redirectUri });
  return { location: assertAuthorizeLocation(location, input.statusBase) };
}

export async function completeCallback(input: {
  store: IntegrationStore;
  identity: IdentityStore;
  keys: IntegrationKeys | null;
  provider: IntegrationProvider;
  state: string;
  code: string;
  error: string;
  redirectUri: string;
  now: string;
  logger?: Logger;
}): Promise<{ organizationId: string }> {
  if (!input.keys) throw conflict("An integration key is required before a grant can be stored.");
  const grant = openGrant(input.store, input.state, input.now);
  const row = input.store.getSecret(grant.connectionId);
  if (!row) throw notFound("Connection does not exist.");
  let verifier = "";
  try {
    verifier = openSecret(keyFor(input.keys, grant.keyVersion), grant);
  } catch {
    throw conflict("The grant could not be read with the current integration key.");
  }
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  if (!sameText(challenge, grant.challenge)) throw forbidden("The authorization request does not match.");
  input.store.consumeGrant(grant.id, input.now);
  if (input.error === "access_denied") {
    clearGrant(input.store, row, "needs_reauth", "denied", input.now);
    writeAudit(input.identity, "provider", "integration.callback", row, input.now, { reason: "denied" });
    return { organizationId: row.organizationId };
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.code)) throw conflict("The provider did not complete the grant.");
  let issued: IssuedGrant;
  try {
    issued = await input.provider.exchange({ code: input.code, verifier, redirectUri: input.redirectUri });
  } catch {
    clearGrant(input.store, row, "needs_reauth", "denied", input.now);
    throw conflict("The provider did not complete the grant.");
  }
  const verdict = input.provider.validate({ accessToken: issued.accessToken, scopes: issued.scopes, expiresAt: issued.expiresAt, now: input.now });
  if (!verdict.ok && verdict.reason === "revoked") {
    clearGrant(input.store, row, "revoked", "revoked", input.now);
    input.logger?.info({ connectionId: row.id, outcome: "revoked" }, "integration grant stored");
    return { organizationId: row.organizationId };
  }
  const sealed = sealSecret(input.keys.current, issued.accessToken);
  const next = await settle(input.store, input.provider, input.keys, row, issued, verdict, sealed, input.now);
  input.store.saveConnection(next);
  writeAudit(input.identity, "provider", "integration.callback", next, input.now, { status: next.status, reason: next.statusReason });
  input.logger?.info({ connectionId: next.id, outcome: next.statusReason || next.status }, "integration grant stored");
  return { organizationId: next.organizationId };
}

export async function checkConnection(input: {
  store: IntegrationStore;
  identity: IdentityStore;
  keys: IntegrationKeys | null;
  provider: IntegrationProvider;
  userId: string;
  connectionId: string;
  now: string;
  logger?: Logger;
}): Promise<void> {
  if (!input.keys) throw conflict("An integration key is required before a grant can be stored.");
  const row = requireOwned(input.store, input.identity, input.userId, input.connectionId, true);
  if (!row.ciphertext) throw conflict("This connection has no grant.");
  const verdict = await withStoredGrant(input.keys, row, async (secret) => input.provider.validate({
    accessToken: secret,
    scopes: row.scopes.split(" ").filter(Boolean),
    expiresAt: row.expiresAt,
    now: input.now,
  }));
  if (!verdict.ok && verdict.reason === "revoked") {
    clearGrant(input.store, row, "revoked", "revoked", input.now);
    input.logger?.info({ connectionId: row.id, outcome: "revoked" }, "integration status read");
    return;
  }
  if (!verdict.ok) {
    const saved = { ...row, status: "needs_reauth" as const, statusReason: verdict.reason, updatedAt: input.now };
    input.store.saveConnection(saved);
    input.logger?.info({ connectionId: row.id, outcome: verdict.reason }, "integration status read");
    return;
  }
  const next = await readHealth(input.store, input.provider, input.keys, row, input.now);
  input.store.saveConnection(next);
  input.logger?.info({ connectionId: row.id, outcome: next.statusReason || next.lastHealthStatus || next.status }, "integration status read");
}

export async function endConnection(input: {
  store: IntegrationStore;
  identity: IdentityStore;
  keys: IntegrationKeys | null;
  provider: IntegrationProvider;
  userId: string;
  connectionId: string;
  mode: "disconnect" | "revoke" | "delete";
  confirmed: boolean;
  now: string;
}): Promise<void> {
  if (!input.confirmed) throw conflict("This action needs confirmation.");
  const row = requireOwned(input.store, input.identity, input.userId, input.connectionId, true);
  if (row.ciphertext && input.keys) {
    try {
      await withStoredGrant(input.keys, row, (secret) => input.provider.disconnect({ accessToken: secret }));
    } catch {
      // The local grant is still removed.
    }
  }
  if (input.mode === "delete") {
    input.store.deleteConnection(row.id);
    writeAudit(input.identity, input.userId, "integration.delete", row, input.now, { providerId: EXAMPLE_PROVIDER_ID });
    return;
  }
  clearGrant(input.store, row, input.mode === "revoke" ? "revoked" : "disconnected", input.mode === "revoke" ? "revoked" : "disconnected", input.now);
  writeAudit(input.identity, input.userId, input.mode === "revoke" ? "integration.revoke" : "integration.disconnect", row, input.now, { providerId: EXAMPLE_PROVIDER_ID });
}

export async function withStoredGrant<T>(keys: IntegrationKeys, row: ConnectionSecret, fn: (secret: string) => Promise<T>): Promise<T> {
  if (!row.ciphertext) throw conflict("This connection has no grant.");
  let secret = "";
  try {
    secret = openSecret(keyFor(keys, row.keyVersion), row);
  } catch {
    throw conflict("The grant could not be read with the current integration key.");
  }
  try {
    return await fn(secret);
  } finally {
    secret = "";
  }
}

export function knownGrant(store: IntegrationStore, state: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(state)) return false;
  return Boolean(store.getGrantByState(sha256(state)));
}

function requireConnection(store: IntegrationStore, identity: IdentityStore, userId: string, organizationId: string, action: "connect" | "reauthorize" | "rotate", keyVersion: number, now: string): ConnectionSecret {
  const member = identity.getMember(organizationId, userId);
  if (!member) throw notFound("Organization does not exist.");
  if (!MANAGE.has(member.role)) throw forbidden("This action needs an owner or an admin.");
  const existing = store.getSecretByOrg(organizationId, EXAMPLE_PROVIDER_ID);
  if (!existing && action !== "connect") throw notFound("Connection does not exist.");
  if (existing) return existing;
  const created = blankConnection({ organizationId, providerId: EXAMPLE_PROVIDER_ID, keyVersion, now });
  store.insertConnection(created);
  return created;
}

function requireOwned(store: IntegrationStore, identity: IdentityStore, userId: string, connectionId: string, write: boolean): ConnectionSecret {
  const row = store.getSecret(connectionId);
  if (!row) throw notFound("Connection does not exist.");
  const member = identity.getMember(row.organizationId, userId);
  if (!member) throw notFound("Connection does not exist.");
  if (write && !MANAGE.has(member.role)) throw forbidden("This action needs an owner or an admin.");
  return row;
}

function openGrant(store: IntegrationStore, state: string, now: string) {
  if (!/^[a-f0-9]{64}$/.test(state)) throw notFound("This authorization request does not exist.");
  const grant = store.getGrantByState(sha256(state));
  if (!grant) throw notFound("This authorization request does not exist.");
  if (grant.consumedAt) throw conflict("This authorization request was already used.");
  if (grant.expiresAt <= now) throw conflict("This authorization request has expired.");
  return grant;
}

async function settle(
  store: IntegrationStore,
  provider: IntegrationProvider,
  keys: IntegrationKeys,
  row: ConnectionSecret,
  issued: IssuedGrant,
  verdict: GrantVerdict,
  sealed: { iv: string; tag: string; ciphertext: string },
  now: string,
): Promise<ConnectionSecret> {
  const base: ConnectionSecret = {
    ...row,
    scopes: issued.scopes.join(" "),
    expiresAt: issued.expiresAt,
    keyVersion: keys.version,
    iv: sealed.iv,
    tag: sealed.tag,
    ciphertext: sealed.ciphertext,
    updatedAt: now,
  };
  if (!verdict.ok) return { ...base, status: "needs_reauth", statusReason: verdict.reason };
  return readHealth(store, provider, keys, base, now);
}

async function readHealth(store: IntegrationStore, provider: IntegrationProvider, keys: IntegrationKeys, row: ConnectionSecret, now: string): Promise<ConnectionSecret> {
  const since = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();
  if (store.countUsageSince(row.id, since) >= HOURLY_LIMIT) {
    store.insertUsage({ id: randomUUID(), connectionId: row.id, organizationId: row.organizationId, kind: "health", outcome: "quota", occurredAt: now });
    return { ...row, status: "pending", statusReason: "quota", lastHealthAt: now, lastHealthStatus: "quota", updatedAt: now };
  }
  const health = await withStoredGrant(keys, row, (secret) => provider.healthCheck({ accessToken: secret }));
  const word = health.status === "up" || health.status === "down" || health.status === "throttled" ? health.status : "down";
  store.insertUsage({ id: randomUUID(), connectionId: row.id, organizationId: row.organizationId, kind: "health", outcome: health.method === "GET" ? word : "refused", occurredAt: now });
  if (health.method !== "GET") {
    return { ...row, status: "needs_reauth", statusReason: "refused", lastHealthAt: now, lastHealthStatus: "refused", updatedAt: now };
  }
  if (word !== "up") {
    return { ...row, status: "pending", statusReason: word, lastHealthAt: now, lastHealthStatus: word, updatedAt: now };
  }
  if (provider.syncMetadata) {
    const meta = await withStoredGrant(keys, row, (secret) => provider.syncMetadata?.({ accessToken: secret }) ?? Promise.resolve({ region: "US" }));
    if (meta.region !== "US") {
      return { ...row, status: "needs_reauth", statusReason: "region", region: "US", lastHealthAt: now, lastHealthStatus: "up", updatedAt: now };
    }
  }
  return { ...row, status: "available", statusReason: "", region: "US", lastHealthAt: now, lastHealthStatus: "up", updatedAt: now };
}

function clearGrant(store: IntegrationStore, row: ConnectionSecret, status: ConnectionSecret["status"], reason: string, now: string): void {
  store.saveConnection({
    ...row,
    status,
    statusReason: reason,
    scopes: status === "disconnected" || status === "revoked" ? "" : row.scopes,
    iv: "",
    tag: "",
    ciphertext: "",
    expiresAt: null,
    updatedAt: now,
  });
}

function writeAudit(identity: IdentityStore, actorId: string, action: string, row: ConnectionSecret, now: string, detail: Record<string, string>): void {
  identity.insertAudit({
    id: randomUUID(),
    actorKind: actorId === "provider" ? "staff" : "user",
    actorId,
    action,
    subjectType: "integration",
    subjectId: row.id,
    organizationId: row.organizationId,
    detailJson: JSON.stringify(detail),
    createdAt: now,
  });
}

function keyFor(keys: IntegrationKeys, version: number): Buffer {
  if (version === keys.version) return keys.current;
  if (keys.previous && version === keys.previousVersion) return keys.previous;
  throw conflict("The grant could not be read with the current integration key.");
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw conflict("The integration key must be 32 bytes.");
  return key;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
