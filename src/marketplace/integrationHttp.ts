import type { Express, Request, Response } from "express";
import { Router } from "express";
import type { AppConfig } from "../types/index.js";
import type { Logger } from "../utils/logger.js";
import { AppError, forbidden } from "../utils/errors.js";
import { messagePage } from "./pages.js";
import { assertCsrf, loadSession } from "./publisher.js";
import { consumeRateLimit } from "./rateLimit.js";
import type { IdentityStore } from "./identity.js";
import type { IntegrationStore } from "./integrationStore.js";
import { authorizePage, connectionsPage } from "./integrationPages.js";
import {
  beginGrant,
  checkConnection,
  completeCallback,
  endConnection,
  knownGrant,
  loadIntegrationKeys,
  mintSandboxCode,
  type IntegrationProvider,
} from "./integrations.js";

export function mountConnections(app: Express, identity: IdentityStore, store: IntegrationStore, config: AppConfig, provider: IntegrationProvider, logger?: Logger): void {
  const router = Router();
  router.get("/sandbox/authorize", (req, res, next) => {
    try {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!knownGrant(store, state)) throw new AppError("NOT_FOUND", "This authorization request does not exist.", 404);
      sendHtml(res, 200, authorizePage(state));
    } catch (error) {
      next(error);
    }
  });
  router.post("/sandbox/grant", (req, res, next) => {
    try {
      assertOrigin(req);
      if (!consumeRateLimit(`connect:${req.ip || req.socket.remoteAddress || "unknown"}`, 8)) throw new AppError("CONFLICT", "Too many requests", 429);
      const state = text(req.body, "state");
      if (!knownGrant(store, state)) throw new AppError("NOT_FOUND", "This authorization request does not exist.", 404);
      const decision = text(req.body, "decision");
      if (decision === "deny") {
        res.redirect(302, `/connections/callback?error=access_denied&state=${encodeURIComponent(state)}`);
        return;
      }
      if (decision !== "allow") throw new AppError("VALIDATION_ERROR", "Choose grant or deny.", 400);
      if (!("remember" in provider)) throw new AppError("CONFLICT", "This sandbox provider is not configured.", 409);
      const minted = mintSandboxCode(provider as IntegrationProvider & { remember(code: string, token: string): void; latestToken(): string });
      res.redirect(302, `/connections/callback?code=${encodeURIComponent(minted.code)}&state=${encodeURIComponent(state)}`);
    } catch (error) {
      next(error);
    }
  });
  router.get("/callback", async (req, res, next) => {
    try {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const error = typeof req.query.error === "string" ? req.query.error : "";
      const done = await completeCallback({
        store,
        identity,
        keys: loadIntegrationKeys(config),
        provider,
        state,
        code,
        error,
        redirectUri: callbackUrl(config),
        now: new Date().toISOString(),
        logger,
      });
      res.redirect(302, `/connections?organizationId=${encodeURIComponent(done.organizationId)}`);
    } catch (error) {
      next(error);
    }
  });
  router.get("/", (req, res, next) => {
    try {
      const current = loadSession(identity, req.header("cookie"));
      const requested = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
      sendHtml(res, 200, render(identity, store, current, requested, config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/connect", (req, res, next) => {
    try {
      sendGrant(req, res, identity, store, config, provider, "connect");
    } catch (error) {
      next(error);
    }
  });
  router.post("/reauthorize", (req, res, next) => {
    try {
      sendGrant(req, res, identity, store, config, provider, "reauthorize");
    } catch (error) {
      next(error);
    }
  });
  router.post("/rotate", (req, res, next) => {
    try {
      sendGrant(req, res, identity, store, config, provider, "rotate");
    } catch (error) {
      next(error);
    }
  });
  router.post("/check", async (req, res, next) => {
    try {
      const current = guard(req, identity);
      await checkConnection({
        store,
        identity,
        keys: loadIntegrationKeys(config),
        provider,
        userId: current.user.id,
        connectionId: text(req.body, "connectionId"),
        now: new Date().toISOString(),
        logger,
      });
      sendHtml(res, 200, render(identity, store, current, text(req.body, "organizationId"), config.VISION_BILLING_ENABLED));
    } catch (error) {
      next(error);
    }
  });
  router.post("/disconnect", async (req, res, next) => {
    await finish(req, res, next, identity, store, config, provider, "disconnect");
  });
  router.post("/revoke", async (req, res, next) => {
    await finish(req, res, next, identity, store, config, provider, "revoke");
  });
  router.post("/delete", async (req, res, next) => {
    await finish(req, res, next, identity, store, config, provider, "delete");
  });
  router.use(htmlErrors);
  app.use("/connections", router);
}

function sendGrant(req: Request, res: Response, identity: IdentityStore, store: IntegrationStore, config: AppConfig, provider: IntegrationProvider, action: "connect" | "reauthorize" | "rotate"): void {
  assertOrigin(req);
  if (!consumeRateLimit(`connect:${req.ip || req.socket.remoteAddress || "unknown"}`, 8)) throw new AppError("CONFLICT", "Too many requests", 429);
  const current = guard(req, identity);
  const started = beginGrant({
    store,
    identity,
    keys: loadIntegrationKeys(config),
    provider,
    userId: current.user.id,
    organizationId: text(req.body, "organizationId"),
    action,
    redirectUri: callbackUrl(config),
    statusBase: config.STATUS_BASE_URL,
    now: new Date().toISOString(),
  });
  res.redirect(302, started.location);
}

async function finish(req: Request, res: Response, next: (error: unknown) => void, identity: IdentityStore, store: IntegrationStore, config: AppConfig, provider: IntegrationProvider, mode: "disconnect" | "revoke" | "delete"): Promise<void> {
  try {
    const current = guard(req, identity);
    await endConnection({
      store,
      identity,
      keys: loadIntegrationKeys(config),
      provider,
      userId: current.user.id,
      connectionId: text(req.body, "connectionId"),
      mode,
      confirmed: text(req.body, "confirm") === "yes",
      now: new Date().toISOString(),
    });
    sendHtml(res, 200, render(identity, store, current, text(req.body, "organizationId"), config.VISION_BILLING_ENABLED));
  } catch (error) {
    next(error);
  }
}

function render(identity: IdentityStore, store: IntegrationStore, current: ReturnType<typeof loadSession>, requested: string, billing: boolean): string {
  if (requested && !identity.getMember(requested, current.user.id)) throw new AppError("NOT_FOUND", "Organization does not exist.", 404);
  const orgs = identity.listOrganizationsForUser(current.user.id);
  const organizationId = orgs.some((org) => org.id === requested) ? requested : orgs[0]?.id ?? "";
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  store.pruneUsage(cutoff);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const connections = organizationId ? store.listViews(organizationId).map((view) => ({ ...view, used: store.countUsageSince(view.id, since) })) : [];
  return connectionsPage({
    csrf: current.session.csrfToken,
    organizationId,
    organizationName: organizationId ? identity.getOrganization(organizationId)?.name ?? "" : "",
    orgs: orgs.map((org) => ({ id: org.id, name: org.name })),
    connections,
    billing,
  });
}

function guard(req: Request, identity: IdentityStore) {
  assertOrigin(req);
  const current = loadSession(identity, req.header("cookie"));
  assertCsrf(current.session, req.body, req.header("x-csrf-token"));
  return current;
}

function callbackUrl(config: AppConfig): string {
  return `${config.STATUS_BASE_URL}/connections/callback`;
}

function assertOrigin(req: Request): void {
  const origin = req.header("origin");
  const site = req.header("sec-fetch-site");
  if (!origin || origin === "null") {
    if (site && site !== "same-origin" && site !== "none") throw forbidden("Cross-site request was refused.");
    return;
  }
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden("Cross-site request was refused.");
  }
  if (host !== req.header("host")) throw forbidden("Cross-site request was refused.");
}

function text(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").send(html);
}

function htmlErrors(error: unknown, _req: Request, res: Response, next: (error: unknown) => void): void {
  if (error instanceof AppError) {
    const page = messagePage(error.statusCode === 404 ? "Not found" : "Unable to continue", error.message, error.statusCode, true);
    sendHtml(res, page.status, page.html);
    return;
  }
  next(error);
}
