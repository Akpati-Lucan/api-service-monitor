import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase, initializeDatabase, type DatabaseApi } from "../src/db/database.js";
import { resetRateLimits } from "../src/marketplace/rateLimit.js";
import {
  assertAuthorizeLocation,
  assessGrant,
  createExampleStatusProvider,
  createRemoteExampleProvider,
  openSecret,
  sealSecret,
  type ExampleStatusProvider,
} from "../src/marketplace/integrations.js";
import { createNoopLogger, type Logger } from "../src/utils/logger.js";
import type { AppConfig } from "../src/types/index.js";

const keyV1 = Buffer.alloc(32, 7).toString("base64");
const keyV2 = Buffer.alloc(32, 9).toString("base64");

const config: AppConfig = {
  PORT: 0,
  DB_PATH: "./data/test.db",
  DEFAULT_INTERVAL_SECONDS: 60,
  DEFAULT_TIMEOUT_MS: 1000,
  DEFAULT_FAILURE_THRESHOLD: 3,
  RETRY_COUNT: 0,
  RETRY_BASE_DELAY_MS: 50,
  RETRY_FACTOR: 1,
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  ENABLED_PROBES: ["http"],
  MCP_ENABLED: false,
  AUTH_MODE: "disabled",
  MCP_ONLY: false,
  MONITOR_BASE_URL: "",
  MCP_TOKEN: "",
  SMTP_URL: "",
  SMTP_FROM: "",
  STATUS_BASE_URL: "http://localhost:3000",
  RETENTION_RAW_DAYS: 14,
  SQLITE_PROBE_ROOT: "",
  VISION_MARKETPLACE_ENABLED: true,
  VISION_STAFF_TOKEN: "staff-token",
  VISION_PUBLIC_RATE_LIMIT: 60,
  VISION_PUBLISHER_PORTAL_ENABLED: true,
  VISION_BILLING_ENABLED: true,
  VISION_BILLING_WEBHOOK_SECRET: "",
  VISION_STRIPE_SECRET_KEY: "",
  VISION_PLATFORM_FEE_BPS: 0,
  VISION_BILLING_COUNTRIES: ["US"],
  VISION_BILLING_GRACE_DAYS: 0,
  VISION_INTEGRATIONS_ENABLED: true,
  VISION_GATEWAY_ENABLED: false,
  VISION_INTEGRATION_KEY: keyV1,
  VISION_INTEGRATION_KEY_VERSION: 1,
  VISION_INTEGRATION_KEY_PREVIOUS: "",
  VISION_EXAMPLE_AUTHORIZE_URL: "",
  VISION_EXAMPLE_TOKEN_URL: "",
  VISION_EXAMPLE_HEALTH_URL: "",
  VISION_EXAMPLE_CLIENT_ID: "",
  VERSION: "1.0.0",
};

describe("phase 13", () => {
  afterEach(() => {
    resetRateLimits();
    for (const db of databases) db.close();
    databases.length = 0;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("keeps the gateway closed and the connection pages behind their flag", async () => {
    const closed = boot({ VISION_INTEGRATIONS_ENABLED: false, VISION_GATEWAY_ENABLED: true });
    await request(closed.app).get("/connections").expect(404);
    await request(closed.app).get("/gateway").expect(404);
    const proxy = await request(closed.app).post("/gateway").type("form").send({ url: "http://127.0.0.1/secret" }).expect(404);
    expect(proxy.text).toBe("Not found");
    await request(closed.app).get("/vision").expect(200);
    const directory = boot({ VISION_MARKETPLACE_ENABLED: false });
    await request(directory.app).get("/connections").expect(404);
    await request(directory.app).get("/gateway").expect(404);
  });

  it("encrypts a grant with a versioned key", () => {
    const sealed = sealSecret(Buffer.from(keyV1, "base64"), "est_unit");
    expect(sealed.ciphertext).not.toContain("est_unit");
    expect(openSecret(Buffer.from(keyV1, "base64"), sealed)).toBe("est_unit");
    expect(() => openSecret(Buffer.from(keyV2, "base64"), sealed)).toThrow();
    expect(assessGrant({ scopes: ["profile"], expiresAt: null, now: "2026-11-17T00:00:00.000Z" }).ok).toBe(false);
    expect(assessGrant({ scopes: ["status.read"], expiresAt: "2026-11-16T00:00:00.000Z", now: "2026-11-17T00:00:00.000Z" })).toEqual({ ok: false, reason: "expired" });
    expect(() => assertAuthorizeLocation("http://evil.example/authorize", config.STATUS_BASE_URL)).toThrow(/HTTPS/);
    expect(() => createRemoteExampleProvider({
      authorizeUrl: "http://example.com/oauth/authorize",
      tokenUrl: "https://example.com/oauth/token",
      healthUrl: "https://example.com/status",
      clientId: "client-example",
      fetchImpl: fetch,
    })).toThrow(/HTTPS/);
  });

  it("reads a remote status signal with GET and leaves the token out of the result", async () => {
    const calls: Array<{ method: string; body: string }> = [];
    const provider = createRemoteExampleProvider({
      authorizeUrl: "https://example.com/oauth/authorize",
      tokenUrl: "https://example.com/oauth/token",
      healthUrl: "https://example.com/status",
      clientId: "client-example",
      async fetchImpl(url, init) {
        calls.push({ method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (String(url).endsWith("/token")) {
          return new Response(JSON.stringify({ access_token: "remote-token-value", scope: "status.read", expires_in: 60 }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: "up", access_token: "remote-token-value" }), { status: 200 });
      },
    });
    const location = provider.authorize({ state: "abc", codeChallenge: "chal", redirectUri: "http://localhost:3000/connections/callback" });
    expect(location).toContain("code_challenge_method=S256");
    const issued = await provider.exchange({ code: "code", verifier: "ver", redirectUri: "http://localhost:3000/connections/callback" });
    const health = await provider.healthCheck({ accessToken: issued.accessToken });
    expect(health).toEqual({ status: "up", method: "GET" });
    expect(JSON.stringify(health)).not.toContain("remote-token-value");
    expect(calls[1]?.method).toBe("GET");
    expect(calls[0]?.body).toContain("code_verifier=ver");
    expect(calls[0]?.body).not.toContain("client_secret");
    expect(() => createRemoteExampleProvider({
      authorizeUrl: "https://example.com/oauth/authorize",
      tokenUrl: "https://example.com/oauth/token",
      healthUrl: "https://evil.example/status",
      clientId: "",
      fetchImpl: fetch,
    })).toThrow(/provider host/);
  });

  it("refuses a grant until an integration key is configured", async () => {
    const mail: Mail[] = [];
    const { app } = boot({ VISION_INTEGRATION_KEY: "" }, undefined, undefined, mail);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const created = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf.csrf, name: "Northwind" }).expect(200);
    const organizationId = hidden(created.text, "organizationId");
    const refused = await ada.post("/connections/connect").type("form").send({ csrf: adaCsrf.csrf, organizationId }).expect(409);
    expect(refused.text).toContain("An integration key is required before a grant can be stored.");
  });

  it("stores one organization grant and keeps the credential off the page", async () => {
    const notes: string[] = [];
    const logger = createNoopLogger();
    logger.info = ((...args: unknown[]) => {
      notes.push(args.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" "));
    }) as Logger["info"];
    const provider = createExampleStatusProvider(config.STATUS_BASE_URL);
    const mail: Mail[] = [];
    const { app, db, dir, local } = boot({}, provider, logger, mail);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const created = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf.csrf, name: "Northwind" }).expect(200);
    const organizationId = hidden(created.text, "organizationId");
    const account = await ada.get("/account").expect(200);
    expect(account.text).toContain('href="/connections"');

    const started = await ada.post("/connections/connect").type("form").send({ csrf: adaCsrf.csrf, organizationId }).expect(302);
    await acceptGrant(ada, started.headers.location ?? "");
    const page = await ada.get(`/connections?organizationId=${organizationId}`).expect(200);
    expect(page.text).toContain("State: available");
    expect(page.text).toContain("Last status read: up.");
    expect(page.text).toContain("Requested scope: status.read.");
    expect(provider.lastMethod).toBe("GET");
    expect(page.text).not.toContain(provider.latestToken());
    const connectionId = hidden(page.text, "connectionId");

    const exported = await ada.get("/account/export").expect(200);
    expect(exported.text).toContain("example-status");
    expect(exported.text).toContain("available");
    expect(exported.text).not.toContain(provider.latestToken());
    expect(exported.text).not.toContain(keyV1);

    const checkpoint = new Database(path.join(dir, "monitor.db"));
    checkpoint.pragma("wal_checkpoint(FULL)");
    checkpoint.close();
    const backup = path.join(dir, "backup.db");
    copyFileSync(path.join(dir, "monitor.db"), backup);
    const stored = readFileSync(backup);
    expect(stored.includes(provider.latestToken())).toBe(false);
    expect(stored.includes(keyV1)).toBe(false);
    const restored = createDatabase({ dbPath: backup });
    databases.push(restored);
    initializeDatabase(restored);
    const secret = restored.integrations.getSecret(connectionId);
    expect(secret?.keyVersion).toBe(1);
    expect(openSecret(Buffer.from(keyV1, "base64"), { iv: secret?.iv ?? "", tag: secret?.tag ?? "", ciphertext: secret?.ciphertext ?? "" })).toBe(provider.latestToken());

    const cara = request.agent(app);
    await signup(app, cara, mail, "cara@northwind.test");
    const viewer = db.identity.getCredentialByEmail("cara@northwind.test");
    db.identity.insertMember({ organizationId, userId: viewer?.id ?? "", role: "viewer", createdAt: new Date().toISOString() });
    const caraPage = await cara.get("/connections").expect(200);
    expect(caraPage.text).toContain("State: available");
    expect(caraPage.text).not.toContain(provider.latestToken());
    const caraCsrf = hidden(caraPage.text, "csrf");
    const denied = await cara.post("/connections/check").type("form").send({ csrf: caraCsrf, connectionId, organizationId }).expect(403);
    expect(denied.text).toContain("This action needs an owner or an admin.");

    const bob = request.agent(app);
    const bobCsrf = await signup(app, bob, mail, "bob@northwind.test");
    const other = await bob.get(`/connections?organizationId=${organizationId}`).expect(404);
    expect(other.text).toContain("Organization does not exist.");
    const stolen = await bob.post("/connections/check").type("form").send({ csrf: bobCsrf.csrf, connectionId, organizationId }).expect(404);
    expect(stolen.text).toContain("Connection does not exist.");

    local.VISION_INTEGRATION_KEY = keyV2;
    local.VISION_INTEGRATION_KEY_VERSION = 2;
    local.VISION_INTEGRATION_KEY_PREVIOUS = keyV1;
    const still = await ada.post("/connections/check").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(200);
    expect(still.text).toContain("State: available");
    const beforeRotate = provider.healthCalls;
    const rotating = await ada.post("/connections/rotate").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(302);
    await acceptGrant(ada, rotating.headers.location ?? "");
    const renewed = await ada.get("/connections").expect(200);
    expect(renewed.text).toContain("State: available");
    expect(renewed.text).not.toContain(provider.issued[0] ?? "");
    expect(renewed.text).not.toContain(provider.latestToken());
    expect(db.integrations.getSecret(connectionId)?.keyVersion).toBe(2);
    expect(provider.healthCalls).toBeGreaterThan(beforeRotate);

    for (let index = 0; index < 30; index += 1) {
      db.integrations.insertUsage({ id: `use_${index}`, connectionId, organizationId, kind: "health", outcome: "up", occurredAt: new Date().toISOString() });
    }
    const callsBeforeQuota = provider.healthCalls;
    const limited = await ada.post("/connections/check").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(200);
    expect(limited.text).toContain("This connection reached its hourly status-read limit.");
    expect(provider.healthCalls).toBe(callsBeforeQuota);
    resetRateLimits();
    const bobOrg = await bob.post("/publisher/organizations").type("form").send({ csrf: bobCsrf.csrf, name: "Contoso" }).expect(200);
    const bobOrganizationId = hidden(bobOrg.text, "organizationId");
    const bobStart = await bob.post("/connections/connect").type("form").send({ csrf: bobCsrf.csrf, organizationId: bobOrganizationId }).expect(302);
    await acceptGrant(bob, bobStart.headers.location ?? "");
    const bobPage = await bob.get("/connections").expect(200);
    expect(bobPage.text).toContain("State: available");
    expect(provider.healthCalls).toBeGreaterThan(callsBeforeQuota);
    db.integrations.pruneUsage(new Date(Date.now() + 60_000).toISOString());

    provider.setBehavior({ health: "throttled" });
    const throttled = await ada.post("/connections/check").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(200);
    expect(throttled.text).toContain("The last status read was throttled.");
    expect(throttled.text).not.toContain("State: available");
    const callsAfterThrottle = provider.healthCalls;

    const current = db.integrations.getSecret(connectionId);
    if (!current) throw new Error("missing connection");
    db.integrations.saveConnection({ ...current, expiresAt: "2000-01-01T00:00:00.000Z" });
    provider.setBehavior({ health: "up", revoked: false });
    const expired = await ada.post("/connections/check").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(200);
    expect(expired.text).toContain("The grant has expired.");
    expect(expired.text).toContain("State: needs_reauth");
    expect(provider.healthCalls).toBe(callsAfterThrottle);

    provider.setBehavior({ revoked: true });
    const revoked = await ada.post("/connections/check").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(200);
    expect(revoked.text).toContain("The provider revoked this grant.");
    expect(revoked.text).toContain("State: revoked");
    expect(db.integrations.getSecret(connectionId)?.ciphertext ?? "").toBe("");
    expect(provider.healthCalls).toBe(callsAfterThrottle);

    resetRateLimits();
    provider.setBehavior({ revoked: false, scopes: ["profile"], health: "up", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    const callsBeforeScope = provider.healthCalls;
    const again = await ada.post("/connections/reauthorize").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId }).expect(302);
    await acceptGrant(ada, again.headers.location ?? "");
    const missing = await ada.get("/connections").expect(200);
    expect(missing.text).toContain("The grant is missing status.read.");
    expect(missing.text).toContain("State: needs_reauth");
    expect(missing.text).not.toContain(provider.latestToken());
    expect(provider.healthCalls).toBe(callsBeforeScope);

    const disconnected = await ada.post("/connections/disconnect").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId, confirm: "yes" }).expect(200);
    expect(disconnected.text).toContain("This connection is disconnected.");
    expect(disconnected.text).not.toContain(provider.latestToken());
    const removed = await ada.post("/connections/delete").type("form").send({ csrf: adaCsrf.csrf, connectionId, organizationId, confirm: "yes" }).expect(200);
    expect(removed.text).not.toContain("State:");
    expect(db.integrations.getSecret(connectionId)).toBeUndefined();

    resetRateLimits();
    const retry = await ada.post("/connections/connect").type("form").send({ csrf: adaCsrf.csrf, organizationId }).expect(302);
    const deniedGrant = await ada.post("/connections/sandbox/grant").type("form").send({ state: stateFrom(retry.headers.location ?? ""), decision: "deny" }).expect(302);
    await ada.get(pathOf(deniedGrant.headers.location ?? "")).expect(302);
    const deniedPage = await ada.get("/connections").expect(200);
    expect(deniedPage.text).toContain("The provider did not grant access.");

    const detail = db.identity.listAudit(40).map((item) => `${item.action} ${item.detailJson}`).join("\n");
    expect(detail).toContain("integration.connect");
    expect(detail).toContain("integration.rotate");
    expect(detail).toContain("integration.disconnect");
    expect(detail).toContain("integration.delete");
    const haystack = `${notes.join("\n")}\n${detail}\n${readFileSync(path.join(dir, "monitor.db")).toString("utf8")}`;
    for (const token of provider.issued) expect(haystack).not.toContain(token);
  });

  it("refuses a status check that is not a read", async () => {
    const provider = createExampleStatusProvider(config.STATUS_BASE_URL);
    provider.healthCheck = async () => ({ status: "up", method: "POST" });
    const mail: Mail[] = [];
    const { app } = boot({}, provider, undefined, mail);
    const ada = request.agent(app);
    const adaCsrf = await signup(app, ada, mail, "ada@northwind.test");
    const created = await ada.post("/publisher/organizations").type("form").send({ csrf: adaCsrf.csrf, name: "Northwind" }).expect(200);
    const started = await ada.post("/connections/connect").type("form").send({ csrf: adaCsrf.csrf, organizationId: hidden(created.text, "organizationId") }).expect(302);
    await acceptGrant(ada, started.headers.location ?? "");
    const page = await ada.get("/connections").expect(200);
    expect(page.text).toContain("The status check must be a read.");
    expect(page.text).toContain("State: needs_reauth");
    expect(page.text).not.toContain(provider.latestToken());
  });
});

const dirs: string[] = [];
const databases: DatabaseApi[] = [];
type Mail = { to: string; subject: string; text: string };

function boot(patch: Partial<AppConfig>, provider?: ExampleStatusProvider, logger?: Logger, mail: Mail[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-monitor-phase13-"));
  dirs.push(dir);
  const local = { ...config, ...patch };
  const db = createDatabase({ dbPath: path.join(dir, "monitor.db") });
  databases.push(db);
  initializeDatabase(db);
  const app = createApp({
    db,
    config: local,
    logger: logger ?? createNoopLogger(),
    marketplace: {
      ...(provider ? { integrationProvider: provider } : {}),
      async mailer(message) { mail.push(message); },
    },
  });
  return { app, db, dir, local };
}

async function signup(app: ReturnType<typeof createApp>, agent: ReturnType<typeof request.agent>, mail: Mail[], email: string) {
  await agent.post("/account/register").type("form").send({ email, displayName: email.split("@")[0] ?? "Publisher", password: "correct-horse-battery" }).expect(200);
  const message = mail.find((item) => item.to === email && item.subject.includes("Verify"));
  const token = /token=([a-f0-9]+)/.exec(message?.text ?? "")?.[1] ?? "";
  await request(app).get(`/account/verify?token=${token}`).expect(200);
  const login = await agent.post("/account/login").type("form").send({ email, password: "correct-horse-battery" }).expect(200);
  return { csrf: hidden(login.text, "csrf"), cookie: cookieHeader(login.header["set-cookie"]) };
}

async function acceptGrant(agent: ReturnType<typeof request.agent>, location: string) {
  const page = await agent.get(pathOf(location)).expect(200);
  expect(page.text).toContain("Grant status.read");
  expect(page.text).not.toContain("est_");
  const allowed = await agent.post("/connections/sandbox/grant").type("form").send({ state: hidden(page.text, "state"), decision: "allow" }).expect(302);
  expect(String(allowed.headers.location ?? "")).not.toContain("est_");
  await agent.get(pathOf(String(allowed.headers.location ?? ""))).expect(302);
}

function pathOf(location: string): string {
  const url = new URL(location, "http://localhost:3000");
  return `${url.pathname}${url.search}`;
}

function stateFrom(location: string): string {
  return new URL(location, "http://localhost:3000").searchParams.get("state") ?? "";
}

function cookieHeader(value: string | string[] | undefined): string {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => item.split(";")[0] ?? "").filter(Boolean).join("; ");
}

function hidden(html: string, name: string): string {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
}
