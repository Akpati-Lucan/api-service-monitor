import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type SubscriptionState = "trialing" | "active" | "past_due" | "canceling" | "canceled" | "incomplete" | "unknown";
export type OfferStatus = "draft" | "active" | "retired";
export type BillingInterval = "month" | "year";
export type EventProcessingState = "received" | "processed" | "retained" | "failed" | "stale" | "waiting";

export interface MarketplaceOffer {
  id: string;
  listingId: string;
  publisherId: string;
  planName: string;
  billingInterval: BillingInterval;
  amountMinor: number;
  currency: string;
  providerPriceRef: string | null;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAccount {
  id: string;
  publisherId: string;
  processor: string;
  processorAccountRef: string;
  onboardingState: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsState: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRow {
  id: string;
  organizationId: string;
  offerId: string;
  processor: string;
  processorCustomerRef: string;
  processorSubscriptionRef: string;
  state: SubscriptionState;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  disputeOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionView {
  id: string;
  organizationId: string;
  state: SubscriptionState;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  disputeOpen: boolean;
  publisherRestricted: boolean;
  updatedAt: string;
  planName: string;
  amountMinor: number;
  currency: string;
  billingInterval: string;
  listingName: string;
  providerName: string;
}

export interface InvoiceView {
  subscriptionId: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  currency: string;
  state: string;
  hostedInvoiceUrl: string | null;
  createdAt: string;
}

export interface PaymentEventRow {
  id: string;
  processor: string;
  processorEventRef: string;
  eventType: string;
  receivedAt: string;
  processedAt: string | null;
  processingState: EventProcessingState;
  safeErrorCode: string | null;
}

export interface ExternalNote {
  id: string;
  organizationId: string;
  listingId: string | null;
  label: string;
  url: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingPreference {
  userId: string;
  emailOptIn: boolean;
  updatedAt: string;
}

export interface PurchasableOffer {
  id: string;
  planName: string;
  amountMinor: number;
  currency: string;
  billingInterval: string;
  listingName: string;
  publisherName: string;
}

export interface CheckoutAttempt {
  id: string;
  organizationId: string;
  offerId: string;
  idempotencyKey: string;
  country: string;
  hostedUrl: string;
  createdAt: string;
}

export interface LedgerView {
  kind: string;
  currency: string;
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
  netMinor: number;
  payoutStatus: string;
  period: string;
}

export interface StaffLedgerRow extends LedgerView {
  transferRef: string | null;
}

export interface LedgerTotal {
  processor: string;
  currency: string;
  period: string;
  payoutStatus: string;
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
  netMinor: number;
}

export interface BillingStore {
  transaction<T>(fn: () => T): T;
  insertOffer(input: MarketplaceOffer): void;
  getOffer(id: string): MarketplaceOffer | undefined;
  getOfferByPriceRef(priceRef: string): MarketplaceOffer | undefined;
  listOffers(publisherId: string): MarketplaceOffer[];
  listOffersByStatus(status: OfferStatus): MarketplaceOffer[];
  updateOffer(id: string, status: OfferStatus, providerPriceRef: string | null, at: string): void;
  upsertPaymentAccount(input: PaymentAccount): void;
  listPaymentAccounts(publisherId: string): PaymentAccount[];
  listPaymentAccountsForStaff(): PaymentAccount[];
  insertSubscription(input: SubscriptionRow): void;
  updateSubscription(id: string, patch: Pick<SubscriptionRow, "state" | "periodStart" | "periodEnd" | "cancelAtPeriodEnd" | "canceledAt" | "updatedAt" | "processorCustomerRef">): void;
  getSubscription(id: string): SubscriptionRow | undefined;
  getSubscriptionByProcessorRef(processor: string, processorSubscriptionRef: string): SubscriptionRow | undefined;
  listSubscriptions(): SubscriptionRow[];
  listSubscriptionViews(organizationId: string): SubscriptionView[];
  countByState(): Array<{ state: string; count: number }>;
  upsertInvoice(input: { subscriptionId: string; processorInvoiceRef: string; amountDueMinor: number; amountPaidMinor: number; currency: string; state: string; hostedInvoiceUrl: string | null; periodStart: string | null; periodEnd: string | null; createdAt: string; taxMinor: number }): void;
  listInvoices(organizationId: string): InvoiceView[];
  insertEvent(input: PaymentEventRow): void;
  getEvent(processor: string, processorEventRef: string): PaymentEventRow | undefined;
  updateEvent(id: string, processingState: EventProcessingState, safeErrorCode: string | null, processedAt: string): void;
  listProblemEvents(): Array<{ eventType: string; processingState: string; safeErrorCode: string | null }>;
  insertExternalNote(input: ExternalNote): void;
  listExternalNotes(organizationId: string): ExternalNote[];
  getPreference(userId: string): BillingPreference | undefined;
  savePreference(userId: string, emailOptIn: boolean, at: string): void;
  listPurchasableOffers(): PurchasableOffer[];
  hasOpenSubscription(organizationId: string, offerId: string): boolean;
  setDisputeOpen(id: string, open: boolean): void;
  getCheckoutAttempt(organizationId: string, idempotencyKey: string): CheckoutAttempt | undefined;
  insertCheckoutAttempt(input: CheckoutAttempt): void;
  completeCheckoutAttempt(id: string, hostedUrl: string): void;
  deleteCheckoutAttempt(id: string): void;
  insertLedger(input: {
    organizationId: string;
    publisherId: string;
    subscriptionId: string | null;
    processor: string;
    currency: string;
    grossMinor: number;
    feeMinor: number;
    taxMinor: number;
    netMinor: number;
    payoutStatus: string;
    kind: string;
    period: string;
    transferRef: string | null;
    sourceEventRef: string;
    createdAt: string;
  }): void;
  listLedgerForOrganization(organizationId: string): LedgerView[];
  listLedgerForPublisher(publisherId: string): LedgerView[];
  listLedgerForStaff(): StaffLedgerRow[];
  sumLedger(): LedgerTotal[];
  markPayoutsTransferred(publisherId: string, period: string): void;
  restrictPublisher(publisherId: string, reason: string, at: string): void;
  restorePublisher(publisherId: string): void;
  isPublisherRestricted(publisherId: string): boolean;
  listPublisherCommerce(): Array<{ publisherId: string; restricted: boolean }>;
}

export function createBillingStore(db: Database.Database): BillingStore {
  return {
    transaction(fn) {
      return db.transaction(fn)();
    },
    insertOffer(input) {
      db.prepare(
        `INSERT INTO marketplace_offers (
          id, listing_id, publisher_id, plan_name, billing_interval, amount_minor, currency, provider_price_ref, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.listingId, input.publisherId, input.planName, input.billingInterval, input.amountMinor, input.currency, input.providerPriceRef, input.status, input.createdAt, input.updatedAt);
    },
    getOffer(id) {
      return mapOffer(db.prepare(`SELECT ${offerColumns} FROM marketplace_offers WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
    },
    getOfferByPriceRef(priceRef) {
      return mapOffer(db.prepare(`SELECT ${offerColumns} FROM marketplace_offers WHERE provider_price_ref = ?`).get(priceRef) as Record<string, unknown> | undefined);
    },
    listOffers(publisherId) {
      return (db.prepare(`SELECT ${offerColumns} FROM marketplace_offers WHERE publisher_id = ? ORDER BY created_at`).all(publisherId) as Array<Record<string, unknown>>).map((row) => mapOffer(row)!);
    },
    listOffersByStatus(status) {
      return (db.prepare(`SELECT ${offerColumns} FROM marketplace_offers WHERE status = ? ORDER BY created_at`).all(status) as Array<Record<string, unknown>>).map((row) => mapOffer(row)!);
    },
    updateOffer(id, status, providerPriceRef, at) {
      db.prepare(`UPDATE marketplace_offers SET status = ?, provider_price_ref = ?, updated_at = ? WHERE id = ?`).run(status, providerPriceRef, at, id);
    },
    upsertPaymentAccount(input) {
      db.prepare(
        `INSERT INTO payment_accounts (
          id, publisher_id, processor, processor_account_ref, onboarding_state, charges_enabled, payouts_enabled, requirements_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(processor, processor_account_ref) DO UPDATE SET
          publisher_id = excluded.publisher_id,
          onboarding_state = excluded.onboarding_state,
          charges_enabled = excluded.charges_enabled,
          payouts_enabled = excluded.payouts_enabled,
          requirements_state = excluded.requirements_state,
          updated_at = excluded.updated_at`,
      ).run(input.id, input.publisherId, input.processor, input.processorAccountRef, input.onboardingState, input.chargesEnabled ? 1 : 0, input.payoutsEnabled ? 1 : 0, input.requirementsState, input.createdAt, input.updatedAt);
    },
    listPaymentAccounts(publisherId) {
      return (db.prepare(`SELECT ${accountColumns} FROM payment_accounts WHERE publisher_id = ? ORDER BY created_at`).all(publisherId) as Array<Record<string, unknown>>).map((row) => mapAccount(row)!);
    },
    listPaymentAccountsForStaff() {
      return (db.prepare(`SELECT ${accountColumns} FROM payment_accounts ORDER BY updated_at DESC LIMIT 20`).all() as Array<Record<string, unknown>>).map((row) => mapAccount(row)!);
    },
    insertSubscription(input) {
      db.prepare(
        `INSERT INTO marketplace_subscriptions (
          id, organization_id, offer_id, processor, processor_customer_ref, processor_subscription_ref, state,
          period_start, period_end, cancel_at_period_end, canceled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.organizationId, input.offerId, input.processor, input.processorCustomerRef, input.processorSubscriptionRef, input.state, input.periodStart, input.periodEnd, input.cancelAtPeriodEnd ? 1 : 0, input.canceledAt, input.createdAt, input.updatedAt);
    },
    updateSubscription(id, patch) {
      db.prepare(
        `UPDATE marketplace_subscriptions SET state = ?, period_start = ?, period_end = ?, cancel_at_period_end = ?, canceled_at = ?, updated_at = ?, processor_customer_ref = ? WHERE id = ?`,
      ).run(patch.state, patch.periodStart, patch.periodEnd, patch.cancelAtPeriodEnd ? 1 : 0, patch.canceledAt, patch.updatedAt, patch.processorCustomerRef, id);
    },
    getSubscription(id) {
      return mapSubscription(db.prepare(`SELECT ${subscriptionColumns} FROM marketplace_subscriptions WHERE id = ?`).get(id) as Record<string, unknown> | undefined);
    },
    getSubscriptionByProcessorRef(processor, processorSubscriptionRef) {
      return mapSubscription(db.prepare(`SELECT ${subscriptionColumns} FROM marketplace_subscriptions WHERE processor = ? AND processor_subscription_ref = ?`).get(processor, processorSubscriptionRef) as Record<string, unknown> | undefined);
    },
    listSubscriptions() {
      return (db.prepare(`SELECT ${subscriptionColumns} FROM marketplace_subscriptions ORDER BY created_at`).all() as Array<Record<string, unknown>>).map((row) => mapSubscription(row)!);
    },
    listSubscriptionViews(organizationId) {
      const rows = db.prepare(
        `SELECT s.id, s.organization_id as organizationId, s.state, s.period_start as periodStart, s.period_end as periodEnd,
                s.cancel_at_period_end as cancelAtPeriodEnd, s.canceled_at as canceledAt, s.dispute_open as disputeOpen,
                s.updated_at as updatedAt, CASE WHEN r.publisher_id IS NULL THEN 0 ELSE 1 END as publisherRestricted,
                o.plan_name as planName, o.amount_minor as amountMinor, o.currency, o.billing_interval as billingInterval,
                l.name as listingName, l.provider_name as providerName
         FROM marketplace_subscriptions s
         JOIN marketplace_offers o ON o.id = s.offer_id
         JOIN marketplace_listings l ON l.id = o.listing_id
         LEFT JOIN commerce_restrictions r ON r.publisher_id = o.publisher_id
         WHERE s.organization_id = ?
         ORDER BY s.created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organizationId),
        state: String(row.state) as SubscriptionState,
        periodStart: textOrNull(row.periodStart),
        periodEnd: textOrNull(row.periodEnd),
        cancelAtPeriodEnd: Number(row.cancelAtPeriodEnd) === 1,
        canceledAt: textOrNull(row.canceledAt),
        disputeOpen: Number(row.disputeOpen) === 1,
        publisherRestricted: Number(row.publisherRestricted) === 1,
        updatedAt: String(row.updatedAt),
        planName: String(row.planName),
        amountMinor: Number(row.amountMinor),
        currency: String(row.currency),
        billingInterval: String(row.billingInterval),
        listingName: String(row.listingName),
        providerName: String(row.providerName),
      }));
    },
    countByState() {
      const rows = db.prepare(`SELECT state, COUNT(*) as count FROM marketplace_subscriptions GROUP BY state ORDER BY state`).all() as Array<{ state: string; count: number }>;
      return rows.map((row) => ({ state: String(row.state), count: Number(row.count) }));
    },
    upsertInvoice(input) {
      db.prepare(
        `INSERT INTO marketplace_invoices (
          id, subscription_id, processor_invoice_ref, amount_due_minor, amount_paid_minor, currency, state, hosted_invoice_url, period_start, period_end, created_at, tax_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(processor_invoice_ref) DO UPDATE SET
          amount_due_minor = excluded.amount_due_minor,
          amount_paid_minor = excluded.amount_paid_minor,
          currency = excluded.currency,
          state = excluded.state,
          hosted_invoice_url = excluded.hosted_invoice_url,
          period_start = excluded.period_start,
          period_end = excluded.period_end,
          tax_minor = excluded.tax_minor`,
      ).run(randomUUID(), input.subscriptionId, input.processorInvoiceRef, input.amountDueMinor, input.amountPaidMinor, input.currency, input.state, input.hostedInvoiceUrl, input.periodStart, input.periodEnd, input.createdAt, input.taxMinor);
    },
    listInvoices(organizationId) {
      const rows = db.prepare(
        `SELECT i.subscription_id as subscriptionId, i.amount_due_minor as amountDueMinor, i.amount_paid_minor as amountPaidMinor,
                i.currency, i.state, i.hosted_invoice_url as hostedInvoiceUrl, i.created_at as createdAt
         FROM marketplace_invoices i
         JOIN marketplace_subscriptions s ON s.id = i.subscription_id
         WHERE s.organization_id = ?
         ORDER BY i.created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        subscriptionId: String(row.subscriptionId),
        amountDueMinor: Number(row.amountDueMinor),
        amountPaidMinor: Number(row.amountPaidMinor),
        currency: String(row.currency),
        state: String(row.state),
        hostedInvoiceUrl: textOrNull(row.hostedInvoiceUrl),
        createdAt: String(row.createdAt),
      }));
    },
    insertEvent(input) {
      db.prepare(
        `INSERT INTO payment_events (id, processor, processor_event_ref, event_type, received_at, processed_at, processing_state, safe_error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.processor, input.processorEventRef, input.eventType, input.receivedAt, input.processedAt, input.processingState, input.safeErrorCode);
    },
    getEvent(processor, processorEventRef) {
      return mapEvent(db.prepare(`SELECT ${eventColumns} FROM payment_events WHERE processor = ? AND processor_event_ref = ?`).get(processor, processorEventRef) as Record<string, unknown> | undefined);
    },
    updateEvent(id, processingState, safeErrorCode, processedAt) {
      db.prepare(`UPDATE payment_events SET processing_state = ?, safe_error_code = ?, processed_at = ? WHERE id = ?`).run(processingState, safeErrorCode, processedAt, id);
    },
    listProblemEvents() {
      const rows = db.prepare(
        `SELECT event_type as eventType, processing_state as processingState, safe_error_code as safeErrorCode
         FROM payment_events WHERE processing_state IN ('failed', 'stale', 'waiting') ORDER BY received_at DESC LIMIT 20`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        eventType: String(row.eventType),
        processingState: String(row.processingState),
        safeErrorCode: textOrNull(row.safeErrorCode),
      }));
    },
    insertExternalNote(input) {
      db.prepare(
        `INSERT INTO external_provider_notes (id, organization_id, listing_id, label, url, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.organizationId, input.listingId, input.label, input.url, input.note, input.createdAt, input.updatedAt);
    },
    listExternalNotes(organizationId) {
      const rows = db.prepare(
        `SELECT id, organization_id as organizationId, listing_id as listingId, label, url, note, created_at as createdAt, updated_at as updatedAt
         FROM external_provider_notes WHERE organization_id = ? ORDER BY created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organizationId),
        listingId: textOrNull(row.listingId),
        label: String(row.label),
        url: String(row.url),
        note: String(row.note),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
      }));
    },
    getPreference(userId) {
      const row = db.prepare(`SELECT user_id as userId, email_opt_in as emailOptIn, updated_at as updatedAt FROM billing_preferences WHERE user_id = ?`).get(userId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { userId: String(row.userId), emailOptIn: Number(row.emailOptIn) === 1, updatedAt: String(row.updatedAt) };
    },
    savePreference(userId, emailOptIn, at) {
      db.prepare(
        `INSERT INTO billing_preferences (user_id, email_opt_in, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET email_opt_in = excluded.email_opt_in, updated_at = excluded.updated_at`,
      ).run(userId, emailOptIn ? 1 : 0, at);
    },
    listPurchasableOffers() {
      const rows = db.prepare(
        `SELECT o.id, o.plan_name as planName, o.amount_minor as amountMinor, o.currency, o.billing_interval as billingInterval,
                l.name as listingName, g.name as publisherName
         FROM marketplace_offers o
         JOIN marketplace_listings l ON l.id = o.listing_id
         JOIN organizations g ON g.id = o.publisher_id
         WHERE o.status = 'active' AND l.status = 'published'
           AND EXISTS (
             SELECT 1 FROM payment_accounts p
             WHERE p.publisher_id = o.publisher_id AND p.charges_enabled = 1 AND p.payouts_enabled = 1
           )
           AND NOT EXISTS (SELECT 1 FROM commerce_restrictions r WHERE r.publisher_id = o.publisher_id)
         ORDER BY o.created_at`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        planName: String(row.planName),
        amountMinor: Number(row.amountMinor),
        currency: String(row.currency),
        billingInterval: String(row.billingInterval),
        listingName: String(row.listingName),
        publisherName: String(row.publisherName),
      }));
    },
    hasOpenSubscription(organizationId, offerId) {
      const row = db.prepare(
        `SELECT id FROM marketplace_subscriptions WHERE organization_id = ? AND offer_id = ? AND state != 'canceled' LIMIT 1`,
      ).get(organizationId, offerId);
      return Boolean(row);
    },
    setDisputeOpen(id, open) {
      db.prepare(`UPDATE marketplace_subscriptions SET dispute_open = ? WHERE id = ?`).run(open ? 1 : 0, id);
    },
    getCheckoutAttempt(organizationId, idempotencyKey) {
      const row = db.prepare(
        `SELECT id, organization_id as organizationId, offer_id as offerId, idempotency_key as idempotencyKey, country, hosted_url as hostedUrl, created_at as createdAt
         FROM checkout_attempts WHERE organization_id = ? AND idempotency_key = ?`,
      ).get(organizationId, idempotencyKey) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        organizationId: String(row.organizationId),
        offerId: String(row.offerId),
        idempotencyKey: String(row.idempotencyKey),
        country: String(row.country),
        hostedUrl: String(row.hostedUrl),
        createdAt: String(row.createdAt),
      };
    },
    insertCheckoutAttempt(input) {
      db.prepare(
        `INSERT INTO checkout_attempts (id, organization_id, offer_id, idempotency_key, country, hosted_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.organizationId, input.offerId, input.idempotencyKey, input.country, input.hostedUrl, input.createdAt);
    },
    completeCheckoutAttempt(id, hostedUrl) {
      db.prepare(`UPDATE checkout_attempts SET hosted_url = ? WHERE id = ?`).run(hostedUrl, id);
    },
    deleteCheckoutAttempt(id) {
      db.prepare(`DELETE FROM checkout_attempts WHERE id = ?`).run(id);
    },
    insertLedger(input) {
      db.prepare(
        `INSERT INTO billing_ledger (
          id, organization_id, publisher_id, subscription_id, processor, currency, gross_minor, fee_minor, tax_minor, net_minor,
          payout_status, kind, period, transfer_ref, source_event_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(), input.organizationId, input.publisherId, input.subscriptionId, input.processor, input.currency,
        input.grossMinor, input.feeMinor, input.taxMinor, input.netMinor, input.payoutStatus, input.kind, input.period,
        input.transferRef, input.sourceEventRef, input.createdAt,
      );
    },
    listLedgerForOrganization(organizationId) {
      return mapLedger(db.prepare(
        `SELECT kind, currency, gross_minor as grossMinor, fee_minor as feeMinor, tax_minor as taxMinor, net_minor as netMinor, payout_status as payoutStatus, period
         FROM billing_ledger WHERE organization_id = ? ORDER BY created_at`,
      ).all(organizationId) as Array<Record<string, unknown>>);
    },
    listLedgerForPublisher(publisherId) {
      return mapLedger(db.prepare(
        `SELECT kind, currency, gross_minor as grossMinor, fee_minor as feeMinor, tax_minor as taxMinor, net_minor as netMinor, payout_status as payoutStatus, period
         FROM billing_ledger WHERE publisher_id = ? ORDER BY created_at`,
      ).all(publisherId) as Array<Record<string, unknown>>);
    },
    listLedgerForStaff() {
      const rows = db.prepare(
        `SELECT kind, currency, gross_minor as grossMinor, fee_minor as feeMinor, tax_minor as taxMinor, net_minor as netMinor,
                payout_status as payoutStatus, period, transfer_ref as transferRef
         FROM billing_ledger ORDER BY created_at DESC LIMIT 20`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...mapLedger([row])[0]!, transferRef: textOrNull(row.transferRef) }));
    },
    sumLedger() {
      const rows = db.prepare(
        `SELECT processor, currency, period, payout_status as payoutStatus,
                SUM(gross_minor) as grossMinor, SUM(fee_minor) as feeMinor, SUM(tax_minor) as taxMinor, SUM(net_minor) as netMinor
         FROM billing_ledger GROUP BY processor, currency, period, payout_status ORDER BY period, currency, payout_status`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        processor: String(row.processor),
        currency: String(row.currency),
        period: String(row.period),
        payoutStatus: String(row.payoutStatus),
        grossMinor: Number(row.grossMinor),
        feeMinor: Number(row.feeMinor),
        taxMinor: Number(row.taxMinor),
        netMinor: Number(row.netMinor),
      }));
    },
    markPayoutsTransferred(publisherId, period) {
      db.prepare(
        `UPDATE billing_ledger SET payout_status = 'transferred' WHERE publisher_id = ? AND period = ? AND payout_status = 'pending' AND kind = 'charge'`,
      ).run(publisherId, period);
    },
    restrictPublisher(publisherId, reason, at) {
      db.prepare(
        `INSERT INTO commerce_restrictions (publisher_id, reason, created_at) VALUES (?, ?, ?)
         ON CONFLICT(publisher_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
      ).run(publisherId, reason, at);
    },
    restorePublisher(publisherId) {
      db.prepare(`DELETE FROM commerce_restrictions WHERE publisher_id = ?`).run(publisherId);
    },
    isPublisherRestricted(publisherId) {
      return Boolean(db.prepare(`SELECT publisher_id FROM commerce_restrictions WHERE publisher_id = ?`).get(publisherId));
    },
    listPublisherCommerce() {
      const rows = db.prepare(
        `SELECT publisher_id as publisherId, 0 as restricted FROM payment_accounts
         UNION
         SELECT publisher_id as publisherId, 1 as restricted FROM commerce_restrictions`,
      ).all() as Array<Record<string, unknown>>;
      const byId = new Map<string, boolean>();
      for (const row of rows) {
        const id = String(row.publisherId);
        byId.set(id, byId.get(id) === true || Number(row.restricted) === 1);
      }
      return [...byId.entries()].map(([publisherId, restricted]) => ({ publisherId, restricted }));
    },
  };
}

const offerColumns = `id, listing_id as listingId, publisher_id as publisherId, plan_name as planName, billing_interval as billingInterval, amount_minor as amountMinor, currency, provider_price_ref as providerPriceRef, status, created_at as createdAt, updated_at as updatedAt`;
const accountColumns = `id, publisher_id as publisherId, processor, processor_account_ref as processorAccountRef, onboarding_state as onboardingState, charges_enabled as chargesEnabled, payouts_enabled as payoutsEnabled, requirements_state as requirementsState, created_at as createdAt, updated_at as updatedAt`;
const subscriptionColumns = `id, organization_id as organizationId, offer_id as offerId, processor, processor_customer_ref as processorCustomerRef, processor_subscription_ref as processorSubscriptionRef, state, period_start as periodStart, period_end as periodEnd, cancel_at_period_end as cancelAtPeriodEnd, canceled_at as canceledAt, dispute_open as disputeOpen, created_at as createdAt, updated_at as updatedAt`;
const eventColumns = `id, processor, processor_event_ref as processorEventRef, event_type as eventType, received_at as receivedAt, processed_at as processedAt, processing_state as processingState, safe_error_code as safeErrorCode`;

function mapOffer(row: Record<string, unknown> | undefined): MarketplaceOffer | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    listingId: String(row.listingId),
    publisherId: String(row.publisherId),
    planName: String(row.planName),
    billingInterval: row.billingInterval === "year" ? "year" : "month",
    amountMinor: Number(row.amountMinor),
    currency: String(row.currency),
    providerPriceRef: textOrNull(row.providerPriceRef),
    status: row.status === "active" || row.status === "retired" ? row.status : "draft",
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapAccount(row: Record<string, unknown> | undefined): PaymentAccount | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    publisherId: String(row.publisherId),
    processor: String(row.processor),
    processorAccountRef: String(row.processorAccountRef),
    onboardingState: String(row.onboardingState),
    chargesEnabled: Number(row.chargesEnabled) === 1,
    payoutsEnabled: Number(row.payoutsEnabled) === 1,
    requirementsState: textOrNull(row.requirementsState),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapSubscription(row: Record<string, unknown> | undefined): SubscriptionRow | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    offerId: String(row.offerId),
    processor: String(row.processor),
    processorCustomerRef: String(row.processorCustomerRef),
    processorSubscriptionRef: String(row.processorSubscriptionRef),
    state: String(row.state) as SubscriptionState,
    periodStart: textOrNull(row.periodStart),
    periodEnd: textOrNull(row.periodEnd),
    cancelAtPeriodEnd: Number(row.cancelAtPeriodEnd) === 1,
    canceledAt: textOrNull(row.canceledAt),
    disputeOpen: Number(row.disputeOpen) === 1,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapLedger(rows: Array<Record<string, unknown>>): LedgerView[] {
  return rows.map((row) => ({
    kind: String(row.kind),
    currency: String(row.currency),
    grossMinor: Number(row.grossMinor),
    feeMinor: Number(row.feeMinor),
    taxMinor: Number(row.taxMinor),
    netMinor: Number(row.netMinor),
    payoutStatus: String(row.payoutStatus),
    period: String(row.period),
  }));
}

function mapEvent(row: Record<string, unknown> | undefined): PaymentEventRow | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    processor: String(row.processor),
    processorEventRef: String(row.processorEventRef),
    eventType: String(row.eventType),
    receivedAt: String(row.receivedAt),
    processedAt: textOrNull(row.processedAt),
    processingState: String(row.processingState) as EventProcessingState,
    safeErrorCode: textOrNull(row.safeErrorCode),
  };
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}
