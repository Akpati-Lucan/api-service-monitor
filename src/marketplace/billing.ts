import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Logger } from "../utils/logger.js";
import { conflict, forbidden, notFound, validationError } from "../utils/errors.js";
import type { IdentityStore, OrgRole, PublicUser } from "./identity.js";
import type { MarketplaceStore } from "./store.js";
import type { Mailer } from "./publisher.js";
import {
  createBillingStore,
  type BillingStore,
  type MarketplaceOffer,
  type PurchasableOffer,
  type SubscriptionRow,
  type SubscriptionState,
} from "./billingStore.js";

export { createBillingStore };
export type { BillingStore };

// Stripe Connect destination charges. The platform account is merchant of record.
// Publisher funds transfer to the connected account. The processor calculates tax on its hosted page.
// VISION_PLATFORM_FEE_BPS is the platform fee. 0 collects no fee, and the browser cannot set it.
// VISION_BILLING_COUNTRIES is the launch list. VISION_BILLING_GRACE_DAYS is 0 unless an operator sets a grace period.
// A past-due subscription is not active access. Entitlement changes only after a verified processor event.
// Checkout opens when the listing is published, the offer is active, charges and payouts are enabled, and the country is allowed.
// Amounts are integer minor units plus an ISO currency. Card numbers stay on the processor.

const CURRENCIES: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, JPY: 0 };
const MANAGE_ROLES = new Set<OrgRole>(["owner", "admin", "billing"]);
const FINAL_EVENT = new Set(["processed", "retained", "failed", "stale", "waiting"]);

export interface RemoteSubscription {
  processorSubscriptionRef: string;
  processorCustomerRef: string;
  offerId: string;
  organizationId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  canceledAt: string | null;
  reportedAt: string;
}

export interface CheckoutInput {
  organizationId: string;
  offerId: string;
  priceRef: string;
  connectedAccountRef: string | null;
  successUrl: string;
  cancelUrl: string;
  feeBps?: number;
  idempotencyKey?: string;
}

export interface PortalInput {
  processorCustomerRef: string;
  returnUrl: string;
}

export interface RefundInput {
  processorSubscriptionRef: string;
  amountMinor: number;
  approved: boolean;
}

export interface NormalizedEvent {
  eventId: string;
  type: string;
  createdAt: string;
  kind: "subscription" | "invoice" | "account" | "dispute" | "payout" | "other";
  subscription?: {
    processorSubscriptionRef: string;
    processorCustomerRef: string;
    offerId: string;
    priceRef: string;
    organizationId: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    periodStart: string | null;
    periodEnd: string | null;
    canceledAt: string | null;
  };
  invoice?: {
    processorInvoiceRef: string;
    processorSubscriptionRef: string;
    amountDueMinor: number;
    amountPaidMinor: number;
    taxMinor: number;
    currency: string;
    state: string;
    hostedInvoiceUrl: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  account?: {
    processorAccountRef: string;
    publisherId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirementsState: string | null;
    detailsSubmitted: boolean;
  };
  dispute?: {
    processorSubscriptionRef: string;
    amountMinor: number;
    currency: string;
  };
  payout?: {
    publisherId: string;
  };
}

export type VerifyResult = { ok: true; event: NormalizedEvent } | { ok: false; reason: "bad_signature" | "invalid_event" };

export interface BillingProcessor {
  name: "stripe";
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createPortalSession(input: PortalInput): Promise<{ url: string }>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined, now: Date): VerifyResult;
  fetchSubscription(processorSubscriptionRef: string): Promise<RemoteSubscription | null>;
  refund(input: RefundInput): Promise<{ refundRef: string }>;
}

export function signStripePayload(secret: string, raw: Buffer, timestampSec: number): string {
  const expected = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestampSec}.`), raw])).digest("hex");
  return `t=${timestampSec},v1=${expected}`;
}

export function feePercent(feeBps: number | undefined): string | null {
  if (typeof feeBps !== "number" || !Number.isInteger(feeBps) || feeBps <= 0) return null;
  const bps = Math.min(feeBps, 10000);
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}

export function platformFeeMinor(grossMinor: number, feeBps: number): number {
  if (!Number.isInteger(grossMinor) || grossMinor < 0 || !Number.isInteger(feeBps) || feeBps <= 0) return 0;
  return Math.floor(grossMinor * Math.min(feeBps, 10000) / 10000);
}

export function formatMinor(amountMinor: number, currency: string): string {
  const exp = CURRENCIES[currency];
  if (!Number.isInteger(amountMinor) || amountMinor < 0 || exp === undefined) return `${currency} ${amountMinor}`;
  if (exp === 0) return `${currency} ${amountMinor}`;
  const factor = 10 ** exp;
  const major = Math.trunc(amountMinor / factor);
  const fraction = String(Math.abs(amountMinor % factor)).padStart(exp, "0");
  return `${currency} ${major}.${fraction}`;
}

export function projectState(status: string, cancelAtPeriodEnd: boolean, deleted = false): SubscriptionState {
  if (deleted || status === "canceled") return "canceled";
  if ((status === "active" || status === "trialing") && cancelAtPeriodEnd) return "canceling";
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "incomplete" || status === "incomplete_expired") return "incomplete";
  return "unknown";
}

export function accessSentence(state: SubscriptionState, periodEnd: string | null, canceledAt: string | null): string {
  if (state === "canceling" && periodEnd) return `Access continues until ${periodEnd}.`;
  if (state === "canceling") return "Access continues until the payment processor reports an end time.";
  if (state === "canceled" && canceledAt) return `Access ended at ${canceledAt}.`;
  if (state === "canceled") return "Access has ended.";
  return "";
}

export function renewalSentence(state: SubscriptionState, periodEnd: string | null, reportedAt: string): string | null {
  if (!periodEnd || state === "canceled") return null;
  return `Next renewal ${periodEnd}. Reported by the payment processor at ${reportedAt}.`;
}

export function commerceSentences(input: { state: SubscriptionState; periodEnd: string | null; disputeOpen: boolean; publisherRestricted: boolean; graceDays: number; now: Date }): string[] {
  const lines: string[] = [];
  if (input.disputeOpen) lines.push("A payment dispute is open. Access follows the payment processor. Refunds and support stay on this page.");
  if (input.publisherRestricted && input.state !== "canceled") lines.push("This publisher cannot accept new subscriptions. Existing access follows the payment processor. Refunds and support stay on the billing page.");
  if (input.state !== "past_due") return lines;
  if (input.graceDays <= 0 || !input.periodEnd) {
    lines.push("Access is paused until the payment processor reports a successful payment.");
    return lines;
  }
  const end = Date.parse(input.periodEnd) + input.graceDays * 86_400_000;
  if (!Number.isFinite(end)) {
    lines.push("Access is paused until the payment processor reports a successful payment.");
    return lines;
  }
  const graceUntil = new Date(end).toISOString();
  if (input.now.getTime() < end) lines.push(`Payment is past due. Access continues until ${graceUntil} under the documented grace period.`);
  else lines.push(`The grace period ended at ${graceUntil}. Access is paused until the payment processor reports a successful payment.`);
  return lines;
}

export function assertHostedUrl(url: string, statusBase: string): string {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(statusBase);
  } catch {
    throw conflict("The payment processor returned an unsupported portal URL.");
  }
  if (parsed.origin !== base.origin && parsed.protocol !== "https:") {
    throw conflict("The payment processor returned an unsupported portal URL.");
  }
  return parsed.toString();
}

export function createRecordProcessor(secret: string, statusBase: string): BillingProcessor & { setRemote(remote: RemoteSubscription): void } {
  const remote = new Map<string, RemoteSubscription>();
  return {
    name: "stripe",
    async createCheckout(input) {
      if (input.priceRef.includes("card")) throw validationError("Checkout refused a card field.");
      return { url: `${statusBase}/billing/processor-checkout` };
    },
    async createPortalSession() {
      return { url: `${statusBase}/billing/processor-portal` };
    },
    verifyWebhook(rawBody, signature, now) {
      return verifyStripeWebhook(secret, rawBody, signature, now);
    },
    async fetchSubscription(processorSubscriptionRef) {
      return remote.get(processorSubscriptionRef) ?? null;
    },
    async refund(input) {
      if (!input.approved) throw forbidden("A refund requires an approved staff decision.");
      return { refundRef: `re_${input.processorSubscriptionRef}` };
    },
    setRemote(next) {
      remote.set(next.processorSubscriptionRef, next);
    },
  };
}

export function createStripeProcessor(input: { secretKey: string; webhookSecret: string; fetchImpl?: typeof fetch }): BillingProcessor {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    name: "stripe",
    async createCheckout(checkout) {
      const body = new URLSearchParams();
      body.set("mode", "subscription");
      body.set("success_url", checkout.successUrl);
      body.set("cancel_url", checkout.cancelUrl);
      body.set("line_items[0][price]", checkout.priceRef);
      body.set("line_items[0][quantity]", "1");
      body.set("client_reference_id", checkout.organizationId);
      body.set("metadata[organization_id]", checkout.organizationId);
      body.set("metadata[offer_id]", checkout.offerId);
      body.set("subscription_data[metadata][organization_id]", checkout.organizationId);
      body.set("subscription_data[metadata][offer_id]", checkout.offerId);
      if (checkout.connectedAccountRef) body.set("subscription_data[transfer_data][destination]", checkout.connectedAccountRef);
      const percent = feePercent(checkout.feeBps ?? 0);
      if (percent) body.set("subscription_data[application_fee_percent]", percent);
      const payload = await stripeRequest(fetchImpl, input.secretKey, "/v1/checkout/sessions", body, checkout.idempotencyKey ? { "Idempotency-Key": checkout.idempotencyKey } : {});
      const url = typeof payload.url === "string" ? payload.url : "";
      if (!url.startsWith("https://")) throw conflict("The payment processor returned an unsupported portal URL.");
      return { url };
    },
    async createPortalSession(portal) {
      const body = new URLSearchParams();
      body.set("customer", portal.processorCustomerRef);
      body.set("return_url", portal.returnUrl);
      const payload = await stripeRequest(fetchImpl, input.secretKey, "/v1/billing_portal/sessions", body);
      const url = typeof payload.url === "string" ? payload.url : "";
      if (!url.startsWith("https://")) throw conflict("The payment processor returned an unsupported portal URL.");
      return { url };
    },
    verifyWebhook(rawBody, signature, now) {
      return verifyStripeWebhook(input.webhookSecret, rawBody, signature, now);
    },
    async fetchSubscription(processorSubscriptionRef) {
      const payload = await stripeRequest(fetchImpl, input.secretKey, `/v1/subscriptions/${encodeURIComponent(processorSubscriptionRef)}`, null);
      const event = parseStripeEvent({ id: "fetch", type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), data: { object: payload } }, new Date().toISOString());
      if (!event?.subscription) return null;
      const sub = event.subscription;
      return {
        processorSubscriptionRef: sub.processorSubscriptionRef,
        processorCustomerRef: sub.processorCustomerRef,
        offerId: sub.offerId,
        organizationId: sub.organizationId,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        periodStart: sub.periodStart,
        periodEnd: sub.periodEnd,
        canceledAt: sub.canceledAt,
        reportedAt: new Date().toISOString(),
      };
    },
    async refund(refund) {
      if (!refund.approved) throw forbidden("A refund requires an approved staff decision.");
      throw conflict("The processor needs a payment reference before a refund can be sent.");
    },
  };
}

export function createOffer(billing: BillingStore, identity: IdentityStore, store: MarketplaceStore, user: PublicUser, input: { organizationId: string; listingId: string; planName: string; billingInterval: string; amountMinor: number; currency: string }, now = new Date()): MarketplaceOffer {
  const member = requireMember(identity, input.organizationId, user.id);
  requireManage(member.role);
  const listing = store.getListing(input.listingId);
  if (!listing || listing.publisherId !== input.organizationId) throw notFound("Listing does not exist");
  const planName = input.planName.trim();
  if (planName.length < 1 || planName.length > 80) throw validationError("Validation failed", { planName: ["enter a plan name"] });
  if (input.billingInterval === "usage") throw validationError("Validation failed", { billingInterval: ["usage billing is not supported"] });
  if (input.billingInterval !== "month" && input.billingInterval !== "year") throw validationError("Validation failed", { billingInterval: ["choose month or year"] });
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1 || input.amountMinor > 100_000_000) {
    throw validationError("Validation failed", { amountMinor: ["enter a whole number of minor units"] });
  }
  const currency = input.currency.trim().toUpperCase();
  if (CURRENCIES[currency] === undefined) throw validationError("Validation failed", { currency: ["choose a supported currency"] });
  const offer: MarketplaceOffer = {
    id: randomUUID(),
    listingId: listing.id,
    publisherId: input.organizationId,
    planName,
    billingInterval: input.billingInterval,
    amountMinor: input.amountMinor,
    currency,
    providerPriceRef: null,
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  billing.insertOffer(offer);
  writeAudit(identity, "user", user.id, "billing.offer", "offer", offer.id, input.organizationId, { planName, amountMinor: input.amountMinor, currency }, now);
  return offer;
}

export function activateOffer(billing: BillingStore, identity: IdentityStore, offerId: string, providerPriceRef: string, now = new Date()): void {
  const offer = billing.getOffer(offerId);
  if (!offer) throw notFound("Offer does not exist");
  const price = providerPriceRef.trim();
  billing.updateOffer(offer.id, "active", price || offer.providerPriceRef, now.toISOString());
  writeAudit(identity, "staff", "staff", "billing.activate", "offer", offer.id, offer.publisherId, { status: "active" }, now);
}

export function saveExternalNote(billing: BillingStore, identity: IdentityStore, user: PublicUser, input: { organizationId: string; label: string; url: string; note: string }, now = new Date()): void {
  const member = requireMember(identity, input.organizationId, user.id);
  requireManage(member.role);
  const label = input.label.trim();
  const note = input.note.trim();
  if (label.length < 1 || label.length > 80) throw validationError("Validation failed", { label: ["enter a label"] });
  if (note.length > 500) throw validationError("Validation failed", { note: ["note must be 500 characters or fewer"] });
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw validationError("Validation failed", { url: ["enter an https URL"] });
  }
  if (url.protocol !== "https:") throw validationError("Validation failed", { url: ["enter an https URL"] });
  billing.insertExternalNote({
    id: randomUUID(),
    organizationId: input.organizationId,
    listingId: null,
    label,
    url: url.toString(),
    note,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

export function saveBillingPreference(billing: BillingStore, identity: IdentityStore, user: PublicUser, emailOptIn: boolean, now = new Date()): void {
  if (emailOptIn && !user.emailVerifiedAt) throw conflict("Verify your email before billing notices are sent.");
  billing.savePreference(user.id, emailOptIn, now.toISOString());
}

export async function openPortal(billing: BillingStore, identity: IdentityStore, processor: BillingProcessor, user: PublicUser, input: { organizationId: string; subscriptionId: string; returnUrl: string; statusBase: string }): Promise<string> {
  const member = requireMember(identity, input.organizationId, user.id);
  requireManage(member.role);
  const subscription = billing.getSubscription(input.subscriptionId);
  if (!subscription || subscription.organizationId !== input.organizationId) throw notFound("Subscription does not exist");
  const session = await processor.createPortalSession({ processorCustomerRef: subscription.processorCustomerRef, returnUrl: input.returnUrl });
  return assertHostedUrl(session.url, input.statusBase);
}

export async function startCheckout(billing: BillingStore, identity: IdentityStore, store: MarketplaceStore, processor: BillingProcessor, user: PublicUser, input: { organizationId: string; offerId: string; country: string; termsAccepted: boolean; idempotencyKey: string; feeBps: number; countries: string[]; statusBase: string }, now = new Date()): Promise<string> {
  if (!input.termsAccepted) throw conflict("Checkout requires acceptance of the marketplace terms.");
  const country = input.country.trim().toUpperCase();
  if (!input.countries.includes(country)) throw conflict("This country is outside the launch list.");
  if (!input.offerId) throw conflict("Checkout requires an offer.");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) throw conflict("Checkout needs a new idempotency key.");
  const member = requireMember(identity, input.organizationId, user.id);
  requireManage(member.role);
  const prior = billing.getCheckoutAttempt(input.organizationId, input.idempotencyKey);
  if (prior?.hostedUrl) return prior.hostedUrl;
  if (prior) throw conflict("Checkout is already in progress.");
  const offer = billing.getOffer(input.offerId);
  if (!offer || offer.status !== "active") throw conflict(offer ? "This offer is not open for checkout." : "Checkout requires an offer.");
  if (CURRENCIES[offer.currency] === undefined) throw conflict("This currency is outside the launch list.");
  const listing = store.getListing(offer.listingId);
  if (!listing || listing.status !== "published") throw conflict("This listing is not published.");
  if (!offer.providerPriceRef) throw conflict("This offer has no processor price yet.");
  const account = billing.listPaymentAccounts(offer.publisherId).find((row) => row.chargesEnabled && row.payoutsEnabled);
  if (!account) throw conflict("This publisher has not finished payment onboarding.");
  if (billing.isPublisherRestricted(offer.publisherId)) throw conflict("This publisher cannot accept new subscriptions.");
  if (billing.hasOpenSubscription(input.organizationId, offer.id)) throw conflict("This organization already has this subscription.");
  const attemptId = randomUUID();
  try {
    billing.insertCheckoutAttempt({ id: attemptId, organizationId: input.organizationId, offerId: offer.id, idempotencyKey: input.idempotencyKey, country, hostedUrl: "", createdAt: now.toISOString() });
  } catch (error) {
    if (!isUnique(error)) throw error;
    const raced = billing.getCheckoutAttempt(input.organizationId, input.idempotencyKey);
    if (raced?.hostedUrl) return raced.hostedUrl;
    throw conflict("Checkout is already in progress.");
  }
  try {
    const session = await processor.createCheckout({
      organizationId: input.organizationId,
      offerId: offer.id,
      priceRef: offer.providerPriceRef,
      connectedAccountRef: account.processorAccountRef,
      successUrl: `${input.statusBase}/billing/checkout/return`,
      cancelUrl: `${input.statusBase}/billing`,
      feeBps: input.feeBps,
      idempotencyKey: input.idempotencyKey,
    });
    const url = assertHostedUrl(session.url, input.statusBase);
    billing.completeCheckoutAttempt(attemptId, url);
    writeAudit(identity, "user", user.id, "billing.checkout", "offer", offer.id, input.organizationId, { country, feeBps: input.feeBps }, now);
    return url;
  } catch (error) {
    billing.deleteCheckoutAttempt(attemptId);
    throw error;
  }
}

export function checkoutChoices(billing: BillingStore, organizationId: string): PurchasableOffer[] {
  if (!organizationId) return [];
  return billing.listPurchasableOffers().filter((offer) => CURRENCIES[offer.currency] !== undefined && !billing.hasOpenSubscription(organizationId, offer.id));
}

export async function refundSubscription(billing: BillingStore, identity: IdentityStore, processor: BillingProcessor, input: { subscriptionId: string; amountMinor: number; approved: boolean; reason: string; feeBps: number }, now = new Date()): Promise<void> {
  if (!input.approved) throw forbidden("A refund requires an approved staff decision.");
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 200) throw validationError("Validation failed", { reason: ["enter a reason"] });
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1) throw validationError("Validation failed", { amountMinor: ["enter a whole number of minor units"] });
  const subscription = billing.getSubscription(input.subscriptionId);
  if (!subscription) throw notFound("Subscription does not exist");
  const offer = billing.getOffer(subscription.offerId);
  if (!offer) throw notFound("Offer does not exist");
  const refund = await processor.refund({ processorSubscriptionRef: subscription.processorSubscriptionRef, amountMinor: input.amountMinor, approved: true });
  const fee = platformFeeMinor(input.amountMinor, input.feeBps);
  billing.insertLedger({
    organizationId: subscription.organizationId,
    publisherId: offer.publisherId,
    subscriptionId: subscription.id,
    processor: subscription.processor,
    currency: offer.currency,
    grossMinor: input.amountMinor,
    feeMinor: fee,
    taxMinor: 0,
    netMinor: input.amountMinor - fee,
    payoutStatus: "reversed",
    kind: "refund",
    period: now.toISOString().slice(0, 7),
    transferRef: refund.refundRef,
    sourceEventRef: `refund:${subscription.id}:${now.toISOString()}`,
    createdAt: now.toISOString(),
  });
  writeAudit(identity, "staff", "staff", "billing.refund", "subscription", subscription.id, subscription.organizationId, { amountMinor: input.amountMinor, approved: true, reason }, now);
}

export function restrictPublisher(billing: BillingStore, identity: IdentityStore, input: { publisherId: string; reason: string; approved: boolean }, now = new Date()): void {
  if (!input.approved) throw forbidden("A restriction requires an approved staff decision.");
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 200) throw validationError("Validation failed", { reason: ["enter a reason"] });
  if (!identity.getOrganization(input.publisherId)) throw notFound("Organization does not exist");
  billing.restrictPublisher(input.publisherId, reason, now.toISOString());
  writeAudit(identity, "staff", "staff", "billing.restrict", "organization", input.publisherId, input.publisherId, { reason }, now);
}

export function restorePublisher(billing: BillingStore, identity: IdentityStore, input: { publisherId: string; reason: string; approved: boolean }, now = new Date()): void {
  if (!input.approved) throw forbidden("A restriction requires an approved staff decision.");
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 200) throw validationError("Validation failed", { reason: ["enter a reason"] });
  if (!identity.getOrganization(input.publisherId)) throw notFound("Organization does not exist");
  billing.restorePublisher(input.publisherId);
  writeAudit(identity, "staff", "staff", "billing.restore", "organization", input.publisherId, input.publisherId, { reason }, now);
}

export async function reconcileSubscriptions(billing: BillingStore, identity: IdentityStore, processor: BillingProcessor, mailer: Mailer, now = new Date()): Promise<{ checked: number; repaired: number }> {
  const subscriptions = billing.listSubscriptions();
  let repaired = 0;
  for (const subscription of subscriptions) {
    const remote = await processor.fetchSubscription(subscription.processorSubscriptionRef);
    if (!remote || remote.reportedAt < subscription.updatedAt) continue;
    const state = projectState(remote.status, remote.cancelAtPeriodEnd);
    const same = state === subscription.state && remote.periodEnd === subscription.periodEnd && remote.cancelAtPeriodEnd === subscription.cancelAtPeriodEnd && remote.canceledAt === subscription.canceledAt;
    if (same) continue;
    billing.updateSubscription(subscription.id, {
      state,
      periodStart: remote.periodStart,
      periodEnd: remote.periodEnd,
      cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
      canceledAt: remote.canceledAt,
      updatedAt: remote.reportedAt,
      processorCustomerRef: remote.processorCustomerRef || subscription.processorCustomerRef,
    });
    repaired += 1;
    writeAudit(identity, "staff", "staff", "billing.reconcile", "subscription", subscription.id, subscription.organizationId, { state }, now);
    if (state !== subscription.state) await notifyState(billing, identity, mailer, subscription.organizationId, subscription.offerId, state);
  }
  return { checked: subscriptions.length, repaired };
}

export async function receiveWebhook(input: {
  billing: BillingStore;
  identity: IdentityStore;
  processor: BillingProcessor;
  mailer: Mailer;
  rawBody: Buffer;
  signature: string | undefined;
  now?: Date;
  logger?: Logger;
  feeBps?: number;
}): Promise<{ outcome: string }> {
  const now = input.now ?? new Date();
  const verified = input.processor.verifyWebhook(input.rawBody, input.signature, now);
  if (!verified.ok) {
    input.logger?.warn({ outcome: "rejected" }, "billing webhook rejected");
    throw validationError("Webhook signature was rejected.");
  }
  const event = verified.event;
  const feeBps = input.feeBps ?? 0;
  const applied = input.billing.transaction(() => applyEvent(input.billing, input.identity, event, now, feeBps));
  if (applied.outcome === "processed" && event.subscription) {
    const source = event.subscription;
    const note = (input.processor as { setRemote?: (remote: RemoteSubscription) => void }).setRemote;
    note?.({
      processorSubscriptionRef: source.processorSubscriptionRef,
      processorCustomerRef: source.processorCustomerRef,
      offerId: source.offerId,
      organizationId: source.organizationId,
      status: source.status,
      cancelAtPeriodEnd: source.cancelAtPeriodEnd,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      canceledAt: source.canceledAt,
      reportedAt: event.createdAt,
    });
  }
  if (applied.notify) await notifyState(input.billing, input.identity, input.mailer, applied.organizationId, applied.offerId, applied.state);
  input.logger?.info({ eventId: event.eventId, type: event.type, outcome: applied.outcome }, "billing event stored");
  return { outcome: applied.outcome };
}

export function billingAdminView(billing: BillingStore) {
  return {
    counts: billing.countByState().map((row) => `${row.state} ${row.count}`),
    problems: billing.listProblemEvents().map((row) => `${row.eventType} ${row.processingState} ${row.safeErrorCode ?? ""}`.trim()),
    offers: billing.listOffersByStatus("draft").map((offer) => ({ id: offer.id, planName: offer.planName })),
    subscriptions: billing.listSubscriptions().slice(0, 20).map((subscription) => ({ id: subscription.id, state: subscription.state })),
    accounts: billing.listPaymentAccountsForStaff().map((account) => ({
      processorAccountRef: account.processorAccountRef,
      onboardingState: account.onboardingState,
      chargesEnabled: account.chargesEnabled,
    })),
    ledger: billing.sumLedger().map((row) => `${row.processor} ${row.currency} ${row.period} ${row.payoutStatus} gross ${row.grossMinor} fee ${row.feeMinor} tax ${row.taxMinor} net ${row.netMinor}`),
    publishers: billing.listPublisherCommerce().map((row) => ({ id: row.publisherId, restricted: row.restricted })),
  };
}

export function billingExport(billing: BillingStore, identity: IdentityStore, userId: string) {
  return {
    emailOptIn: billing.getPreference(userId)?.emailOptIn === true,
    organizations: identity.listOrganizationsForUser(userId).map((org) => ({
      id: org.id,
      name: org.name,
      subscriptions: billing.listSubscriptionViews(org.id).map((subscription) => ({
        id: subscription.id,
        planName: subscription.planName,
        state: subscription.state,
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        periodEnd: subscription.periodEnd,
      })),
      externalNotes: billing.listExternalNotes(org.id).map((note) => ({ label: note.label, url: note.url, note: note.note })),
      statement: billing.listLedgerForOrganization(org.id),
    })),
  };
}

export function requireBillingMember(identity: IdentityStore, organizationId: string, userId: string) {
  return requireMember(identity, organizationId, userId);
}

function applyEvent(billing: BillingStore, identity: IdentityStore, event: NormalizedEvent, now: Date, feeBps: number): { outcome: string; notify: boolean; organizationId: string; offerId: string; state: SubscriptionState } {
  const none = { outcome: "stored", notify: false, organizationId: "", offerId: "", state: "unknown" as SubscriptionState };
  const existing = billing.getEvent("stripe", event.eventId);
  if (existing && FINAL_EVENT.has(existing.processingState)) return { ...none, outcome: "duplicate" };
  const eventRowId = existing?.id ?? randomUUID();
  if (!existing) {
    billing.insertEvent({
      id: eventRowId,
      processor: "stripe",
      processorEventRef: event.eventId,
      eventType: event.type,
      receivedAt: now.toISOString(),
      processedAt: null,
      processingState: "received",
      safeErrorCode: null,
    });
  }
  const finish = (processingState: "processed" | "retained" | "failed" | "stale" | "waiting", safeErrorCode: string | null, extra?: Partial<typeof none>) => {
    billing.updateEvent(eventRowId, processingState, safeErrorCode, now.toISOString());
    return { ...none, outcome: processingState, ...extra };
  };
  if (event.kind === "other") return finish("retained", null);
  if (event.kind === "account" && event.account) {
    const saved = applyAccount(billing, identity, event);
    return finish(saved ? "processed" : "failed", saved ? null : "unknown_publisher");
  }
  if (event.kind === "invoice" && event.invoice) {
    const result = applyInvoice(billing, event, feeBps);
    return finish(result.state, result.code);
  }
  if (event.kind === "dispute") {
    const result = applyDispute(billing, event);
    return finish(result.state, result.code);
  }
  if (event.kind === "payout") {
    const result = applyPayout(billing, identity, event);
    return finish(result.state, result.code);
  }
  if (event.kind === "subscription" && event.subscription) return applySubscription(billing, identity, event, eventRowId, now, finish);
  return finish("failed", "invalid_event");
}

function applyAccount(billing: BillingStore, identity: IdentityStore, event: NormalizedEvent): boolean {
  const account = event.account;
  if (!account) return false;
  if (!identity.getOrganization(account.publisherId)) return false;
  const at = event.createdAt;
  billing.upsertPaymentAccount({
    id: randomUUID(),
    publisherId: account.publisherId,
    processor: "stripe",
    processorAccountRef: account.processorAccountRef,
    onboardingState: account.chargesEnabled ? "enabled" : account.detailsSubmitted ? "submitted" : "pending",
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    requirementsState: account.requirementsState,
    createdAt: at,
    updatedAt: at,
  });
  return true;
}

function applyInvoice(billing: BillingStore, event: NormalizedEvent, feeBps: number): { state: "processed" | "failed" | "waiting"; code: string | null } {
  const invoice = event.invoice;
  if (!invoice) return { state: "failed", code: "invalid_event" };
  if (!Number.isInteger(invoice.amountDueMinor) || !Number.isInteger(invoice.amountPaidMinor) || !Number.isInteger(invoice.taxMinor) || invoice.taxMinor < 0) return { state: "failed", code: "invalid_amount" };
  if (CURRENCIES[invoice.currency] === undefined) return { state: "failed", code: "invalid_currency" };
  const subscription = billing.getSubscriptionByProcessorRef("stripe", invoice.processorSubscriptionRef);
  if (!subscription) return { state: "waiting", code: "subscription_missing" };
  billing.upsertInvoice({
    subscriptionId: subscription.id,
    processorInvoiceRef: invoice.processorInvoiceRef,
    amountDueMinor: invoice.amountDueMinor,
    amountPaidMinor: invoice.amountPaidMinor,
    currency: invoice.currency,
    state: invoice.state,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    createdAt: event.createdAt,
    taxMinor: invoice.taxMinor,
  });
  if (invoice.state === "paid" && invoice.amountPaidMinor > 0) {
    const offer = billing.getOffer(subscription.offerId);
    if (offer) recordCharge(billing, subscription, offer.publisherId, invoice.amountPaidMinor, invoice.taxMinor, invoice.currency, feeBps, event.eventId, event.createdAt, null);
  }
  return { state: "processed", code: null };
}

function applyDispute(billing: BillingStore, event: NormalizedEvent): { state: "processed" | "failed"; code: string | null } {
  const dispute = event.dispute;
  if (!dispute) return { state: "failed", code: "invalid_event" };
  if (!Number.isInteger(dispute.amountMinor) || dispute.amountMinor < 0) return { state: "failed", code: "invalid_amount" };
  if (CURRENCIES[dispute.currency] === undefined) return { state: "failed", code: "invalid_currency" };
  const subscription = billing.getSubscriptionByProcessorRef("stripe", dispute.processorSubscriptionRef);
  if (!subscription) return { state: "failed", code: "unknown_subscription" };
  const offer = billing.getOffer(subscription.offerId);
  if (!offer) return { state: "failed", code: "unknown_offer" };
  billing.setDisputeOpen(subscription.id, true);
  billing.insertLedger({
    organizationId: subscription.organizationId,
    publisherId: offer.publisherId,
    subscriptionId: subscription.id,
    processor: subscription.processor,
    currency: dispute.currency,
    grossMinor: dispute.amountMinor,
    feeMinor: 0,
    taxMinor: 0,
    netMinor: 0,
    payoutStatus: "reversed",
    kind: "dispute",
    period: event.createdAt.slice(0, 7),
    transferRef: null,
    sourceEventRef: event.eventId,
    createdAt: event.createdAt,
  });
  return { state: "processed", code: null };
}

function applyPayout(billing: BillingStore, identity: IdentityStore, event: NormalizedEvent): { state: "processed" | "failed"; code: string | null } {
  const payout = event.payout;
  if (!payout?.publisherId || !identity.getOrganization(payout.publisherId)) return { state: "failed", code: "unknown_publisher" };
  billing.markPayoutsTransferred(payout.publisherId, event.createdAt.slice(0, 7));
  return { state: "processed", code: null };
}

function recordCharge(billing: BillingStore, subscription: SubscriptionRow, publisherId: string, grossMinor: number, taxMinor: number, currency: string, feeBps: number, sourceEventRef: string, createdAt: string, transferRef: string | null): void {
  const fee = platformFeeMinor(grossMinor, feeBps);
  const net = Math.max(0, grossMinor - fee - taxMinor);
  billing.insertLedger({
    organizationId: subscription.organizationId,
    publisherId,
    subscriptionId: subscription.id,
    processor: subscription.processor,
    currency,
    grossMinor,
    feeMinor: fee,
    taxMinor,
    netMinor: net,
    payoutStatus: "pending",
    kind: "charge",
    period: createdAt.slice(0, 7),
    transferRef,
    sourceEventRef,
    createdAt,
  });
}

function applySubscription(
  billing: BillingStore,
  identity: IdentityStore,
  event: NormalizedEvent,
  eventRowId: string,
  now: Date,
  finish: (processingState: "processed" | "retained" | "failed" | "stale" | "waiting", safeErrorCode: string | null, extra?: { notify: boolean; organizationId: string; offerId: string; state: SubscriptionState }) => { outcome: string; notify: boolean; organizationId: string; offerId: string; state: SubscriptionState },
): { outcome: string; notify: boolean; organizationId: string; offerId: string; state: SubscriptionState } {
  const source = event.subscription;
  if (!source) return finish("failed", "invalid_event");
  const offer = source.offerId ? billing.getOffer(source.offerId) : billing.getOfferByPriceRef(source.priceRef);
  if (!offer) return finish("failed", "unknown_offer");
  if (!source.organizationId || !identity.getOrganization(source.organizationId)) return finish("failed", "unknown_organization");
  const deleted = event.type === "customer.subscription.deleted";
  const state = projectState(source.status, source.cancelAtPeriodEnd, deleted);
  const current = billing.getSubscriptionByProcessorRef("stripe", source.processorSubscriptionRef);
  if (current && event.createdAt < current.updatedAt) return finish("stale", null);
  if (!current && billing.hasOpenSubscription(source.organizationId, offer.id)) return finish("failed", "duplicate_subscription");
  const patch = {
    state,
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
    cancelAtPeriodEnd: source.cancelAtPeriodEnd,
    canceledAt: source.canceledAt,
    updatedAt: event.createdAt,
    processorCustomerRef: source.processorCustomerRef,
  };
  if (!current) {
    billing.insertSubscription({
      id: randomUUID(),
      organizationId: source.organizationId,
      offerId: offer.id,
      processor: "stripe",
      processorSubscriptionRef: source.processorSubscriptionRef,
      createdAt: event.createdAt,
      disputeOpen: false,
      ...patch,
    });
  } else {
    billing.updateSubscription(current.id, patch);
  }
  billing.updateEvent(eventRowId, "processed", null, now.toISOString());
  const changed = !current || current.state !== state;
  return { outcome: "processed", notify: changed, organizationId: source.organizationId, offerId: offer.id, state };
}

async function notifyState(billing: BillingStore, identity: IdentityStore, mailer: Mailer, organizationId: string, offerId: string, state: SubscriptionState): Promise<void> {
  if (!organizationId) return;
  const offer = billing.getOffer(offerId);
  const planName = offer?.planName ?? "subscription";
  for (const member of identity.listMembers(organizationId)) {
    if (billing.getPreference(member.userId)?.emailOptIn !== true) continue;
    const user = identity.getUser(member.userId);
    if (!user?.emailVerifiedAt || user.deletedAt) continue;
    try {
      await mailer({ to: user.email, subject: `Vision API subscription ${planName}`, text: `The payment processor reported this subscription as ${state}.` });
    } catch {
      writeAudit(identity, "staff", "staff", "mail.failed", "subscription", offerId, organizationId, {}, new Date());
    }
  }
}

function requireMember(identity: IdentityStore, organizationId: string, userId: string) {
  const member = identity.getMember(organizationId, userId);
  if (!member || !identity.getOrganization(organizationId)) throw notFound("Organization does not exist");
  return member;
}

function requireManage(role: OrgRole): void {
  if (!MANAGE_ROLES.has(role)) throw forbidden("Billing management requires an owner, admin, or billing role.");
}

function writeAudit(identity: IdentityStore, actorKind: "user" | "staff", actorId: string, action: string, subjectType: string, subjectId: string, organizationId: string | null, detail: Record<string, unknown>, now: Date): void {
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

function verifyStripeWebhook(secret: string, rawBody: Buffer, signature: string | undefined, now: Date): VerifyResult {
  const signed = readSignedJson(secret, rawBody, signature, now);
  if (!signed) return { ok: false, reason: "bad_signature" };
  const event = parseStripeEvent(signed.json, signed.signedAt);
  if (!event) return { ok: false, reason: "invalid_event" };
  return { ok: true, event };
}

function readSignedJson(secret: string, rawBody: Buffer, signature: string | undefined, now: Date): { json: unknown; signedAt: string } | null {
  if (!secret || !signature) return null;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.trim().split("=");
    if (key === "t" && value) timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return null;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now.getTime() / 1000 - seconds) > 300) return null;
  const expected = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const match = signatures.some((sig) => {
    const got = Buffer.from(sig);
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
  });
  if (!match) return null;
  try {
    return { json: JSON.parse(rawBody.toString("utf8")) as unknown, signedAt: new Date(seconds * 1000).toISOString() };
  } catch {
    return null;
  }
}

export function parseStripeEvent(body: unknown, signedAt: string): NormalizedEvent | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const eventId = typeof record.id === "string" ? record.id : "";
  const type = typeof record.type === "string" ? record.type : "";
  if (!eventId || !type) return null;
  const createdAt = typeof record.created === "number" ? new Date(record.created * 1000).toISOString() : signedAt;
  const object = record.data && typeof record.data === "object" ? (record.data as { object?: unknown }).object : record;
  if (type.startsWith("customer.subscription.")) {
    const subscription = readSubscription(object, type === "customer.subscription.deleted");
    if (!subscription) return { eventId, type, createdAt, kind: "subscription" };
    return { eventId, type, createdAt, kind: "subscription", subscription };
  }
  if (type.startsWith("invoice.")) {
    const invoice = readInvoice(object);
    if (!invoice) return { eventId, type, createdAt, kind: "invoice" };
    return { eventId, type, createdAt, kind: "invoice", invoice };
  }
  if (type === "account.updated") {
    const account = readAccount(object);
    if (!account) return { eventId, type, createdAt, kind: "account" };
    return { eventId, type, createdAt, kind: "account", account };
  }
  if (type.startsWith("charge.dispute.")) {
    const dispute = readDispute(object);
    if (!dispute) return { eventId, type, createdAt, kind: "dispute" };
    return { eventId, type, createdAt, kind: "dispute", dispute };
  }
  if (type === "payout.paid") {
    const payout = readPayout(object);
    if (!payout) return { eventId, type, createdAt, kind: "payout" };
    return { eventId, type, createdAt, kind: "payout", payout };
  }
  return { eventId, type, createdAt, kind: "other" };
}

function readSubscription(value: unknown, deleted: boolean): NormalizedEvent["subscription"] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const processorSubscriptionRef = typeof row.id === "string" ? row.id : "";
  const processorCustomerRef = idOf(row.customer);
  if (!processorSubscriptionRef || !processorCustomerRef) return null;
  const metadata = recordOf(row.metadata);
  const item = firstItem(row.items);
  const priceRef = item ? idOf(item.price) : "";
  return {
    processorSubscriptionRef,
    processorCustomerRef,
    offerId: text(metadata.offer_id),
    priceRef,
    organizationId: text(metadata.organization_id),
    status: deleted ? "canceled" : text(row.status),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    periodStart: period(row, item, "current_period_start"),
    periodEnd: period(row, item, "current_period_end"),
    canceledAt: unix(row.canceled_at),
  };
}

function readInvoice(value: unknown): NormalizedEvent["invoice"] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const processorInvoiceRef = typeof row.id === "string" ? row.id : "";
  const processorSubscriptionRef = idOf(row.subscription);
  if (!processorInvoiceRef || !processorSubscriptionRef) return null;
  const due = row.amount_due;
  const paid = row.amount_paid;
  const hosted = typeof row.hosted_invoice_url === "string" && row.hosted_invoice_url.startsWith("https://") ? row.hosted_invoice_url : null;
  return {
    processorInvoiceRef,
    processorSubscriptionRef,
    amountDueMinor: typeof due === "number" ? due : Number.NaN,
    amountPaidMinor: typeof paid === "number" ? paid : Number.NaN,
    taxMinor: row.tax == null ? 0 : typeof row.tax === "number" ? row.tax : Number.NaN,
    currency: text(row.currency).toUpperCase(),
    state: text(row.status) || "unknown",
    hostedInvoiceUrl: hosted,
    periodStart: unix(row.period_start),
    periodEnd: unix(row.period_end),
  };
}

function readAccount(value: unknown): NormalizedEvent["account"] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const processorAccountRef = typeof row.id === "string" ? row.id : "";
  const metadata = recordOf(row.metadata);
  const publisherId = text(metadata.publisher_id);
  if (!processorAccountRef || !publisherId) return null;
  const requirements = recordOf(row.requirements);
  return {
    processorAccountRef,
    publisherId,
    chargesEnabled: row.charges_enabled === true,
    payoutsEnabled: row.payouts_enabled === true,
    requirementsState: text(requirements.disabled_reason) || null,
    detailsSubmitted: row.details_submitted === true,
  };
}

function readDispute(value: unknown): NormalizedEvent["dispute"] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const metadata = recordOf(row.metadata);
  const processorSubscriptionRef = text(metadata.subscription_id);
  const amount = row.amount;
  if (!processorSubscriptionRef) return null;
  return {
    processorSubscriptionRef,
    amountMinor: typeof amount === "number" ? amount : Number.NaN,
    currency: text(row.currency).toUpperCase(),
  };
}

function readPayout(value: unknown): NormalizedEvent["payout"] | null {
  if (!value || typeof value !== "object") return null;
  const publisherId = text(recordOf((value as Record<string, unknown>).metadata).publisher_id);
  if (!publisherId) return null;
  return { publisherId };
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}

async function stripeRequest(fetchImpl: typeof fetch, secretKey: string, path: string, body: URLSearchParams | null, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
  if (!secretKey) throw conflict("The payment processor secret is not configured.");
  const response = await fetchImpl(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...extraHeaders,
    },
    body: body ? body.toString() : undefined,
  });
  if (!response.ok) throw conflict("The payment processor could not be reached.");
  const payload = await response.json() as unknown;
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

function period(row: Record<string, unknown>, item: Record<string, unknown> | null, key: string): string | null {
  return unix(row[key]) ?? (item ? unix(item[key]) : null);
}

function firstItem(value: unknown): Record<string, unknown> | null {
  const items = recordOf(value);
  const data = items.data;
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as Record<string, unknown>;
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return "";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unix(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}
