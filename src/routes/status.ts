import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import type { AppConfig } from "../types/index.js";
import { authenticateBearer } from "../auth/apiKeys.js";
import { UNRESTRICTED_AUTH } from "../auth/access.js";
import { loadStatusDocument } from "../status/pageData.js";
import { renderStatusHtml } from "../status/render.js";
import { renderBadge } from "../status/badge.js";
import { renderAtomFeed } from "../status/feed.js";
import { cancelSubscription, confirmSubscription, mailNotConfiguredPage, requestSubscription, subscriptionPendingPage } from "../application/subscribers.js";
import { sendSmtp } from "../alerts/smtp.js";

export function createPublicStatusRouter({ db, config }: { db: DatabaseApi; config: AppConfig }) {
  const router = Router();

  router.get("/:slug.json", (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(loadStatusDocument(db, caller(db, config, req.params.slug, req.header("authorization")), req.params.slug));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug/badge.svg", (req, res, next) => {
    try {
      const document = loadStatusDocument(db, caller(db, config, req.params.slug, req.header("authorization")), req.params.slug);
      res.setHeader("Cache-Control", "no-store");
      res.type("image/svg+xml").send(renderBadge(document.status));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug/feed.xml", (req, res, next) => {
    try {
      const document = loadStatusDocument(db, caller(db, config, req.params.slug, req.header("authorization")), req.params.slug);
      const pageUrl = `${config.STATUS_BASE_URL.replace(/\/$/, "")}/status/${req.params.slug}`;
      res.setHeader("Cache-Control", "no-store");
      res.type("application/atom+xml").send(renderAtomFeed(document, pageUrl));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:slug/subscribers", async (req, res, next) => {
    try {
      if (!config.SMTP_URL || !config.SMTP_FROM) {
        res.status(503).type("html").send(mailNotConfiguredPage());
        return;
      }
      const email = typeof req.body?.email === "string" ? req.body.email : "";
      await requestSubscription({
        db,
        slug: req.params.slug,
        email,
        statusBaseUrl: config.STATUS_BASE_URL,
        send: async (message) => {
          if (!config.SMTP_URL || !config.SMTP_FROM) {
            return;
          }
          await sendSmtp({
            smtpUrl: config.SMTP_URL,
            from: config.SMTP_FROM,
            to: message.to,
            subject: message.subject,
            text: message.text,
          });
        },
      });
      res.status(202).type("html").send(subscriptionPendingPage());
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug/subscribers/confirm/:token", (req, res, next) => {
    try {
      res.type("html").send(confirmSubscription(db, req.params.token));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug/subscribers/unsubscribe/:token", (req, res, next) => {
    try {
      res.type("html").send(cancelSubscription(db, req.params.token));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:slug", (req, res, next) => {
    try {
      const document = loadStatusDocument(db, caller(db, config, req.params.slug, req.header("authorization")), req.params.slug);
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(renderStatusHtml(document, {
        jsonHref: `${req.params.slug}.json`,
        badgeHref: `${req.params.slug}/badge.svg`,
        feedHref: `${req.params.slug}/feed.xml`,
        subscribeHref: `${req.params.slug}/subscribers`,
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function caller(db: DatabaseApi, config: AppConfig, slug: string, header: string | undefined) {
  if (config.AUTH_MODE !== "enabled") {
    return UNRESTRICTED_AUTH;
  }
  const page = db.getStatusPageBySlug(slug);
  if (page?.visibility !== "private") {
    return null;
  }
  return authenticateBearer(db, header);
}
