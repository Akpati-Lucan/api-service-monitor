import { randomBytes } from "node:crypto";
import { hashToken, hashesEqual } from "../auth/apiKeys.js";
import type { DatabaseApi } from "../db/database.js";
import { escapeHtml } from "../status/render.js";
import { statusPageCss } from "../status/pageCss.js";
import { notFound, validationError } from "../utils/errors.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = hashToken("sub_dummy-token-not-a-secret");

export interface SubscriberMail {
  to: string[];
  subject: string;
  text: string;
}

export async function requestSubscription(input: {
  db: DatabaseApi;
  slug: string;
  email: string;
  statusBaseUrl: string;
  send: (message: SubscriberMail) => Promise<void>;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    throw validationError("Validation failed", { email: ["email must be an email address"] });
  }
  const page = input.db.getStatusPageBySlug(input.slug);
  if (!page) {
    throw notFound(`Status page ${input.slug} does not exist`);
  }
  const token = `sub_${randomBytes(32).toString("base64url")}`;
  input.db.insertSubscriber({ statusPageId: page.id, email, tokenHash: hashToken(token) });
  const base = input.statusBaseUrl.replace(/\/$/, "");
  const confirm = `${base}/status/${page.slug}/subscribers/confirm/${token}`;
  const unsubscribe = `${base}/status/${page.slug}/subscribers/unsubscribe/${token}`;
  await input.send({
    to: [email],
    subject: `Confirm updates for ${page.title}`,
    text: `Confirm updates for ${page.title}: ${confirm}\nUnsubscribe: ${unsubscribe}`,
  });
}

export function confirmSubscription(db: DatabaseApi, token: string, now = new Date()): string {
  const row = findSubscriber(db, token);
  db.verifySubscriber(row.id, now.toISOString());
  return noticePage("Updates confirmed", "This address will receive an email when an incident opens or recovers.");
}

export function cancelSubscription(db: DatabaseApi, token: string): string {
  const row = findSubscriber(db, token);
  db.deleteSubscriber(row.id);
  return noticePage("Updates stopped", "This address will no longer receive incident emails.");
}

export async function notifySubscribers(input: {
  db: DatabaseApi;
  serviceId: string;
  serviceName: string;
  title: string;
  pageUrl?: string;
  smtpUrl: string;
  smtpFrom: string;
  send: (message: SubscriberMail) => Promise<void>;
}): Promise<void> {
  if (!input.smtpUrl || !input.smtpFrom) return;
  const emails = input.db.listVerifiedSubscriberEmails(input.serviceId);
  if (emails.length === 0) return;
  const lines = [input.title, input.pageUrl ?? ""].filter((line) => line.length > 0);
  await input.send({
    to: emails,
    subject: `${input.serviceName}: ${input.title}`,
    text: lines.join("\n"),
  });
}

function findSubscriber(db: DatabaseApi, token: string) {
  const presented = token.trim();
  if (presented.length < 8) {
    throw notFound("Subscription token does not exist");
  }
  const hash = hashToken(presented);
  const row = db.getSubscriberByHash(hash);
  if (!row || !hashesEqual(hash, row.tokenHash)) {
    hashesEqual(hash, DUMMY_HASH);
    throw notFound("Subscription token does not exist");
  }
  return row;
}

export function subscriptionPendingPage(): string {
  return noticePage("Confirmation pending", "Check the inbox for the confirmation link.");
}

export function mailNotConfiguredPage(): string {
  return noticePage("Email is not configured", "This monitor is not sending confirmation email yet.");
}

function noticePage(title: string, sentence: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${statusPageCss}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="detail">${escapeHtml(sentence)}</p>
  </main>
</body>
</html>`;
}
