import { randomUUID } from "node:crypto";
import { escapeHtml } from "./markdown.js";
import { visionDocument } from "./pages.js";
import { accessSentence, commerceSentences, formatMinor, renewalSentence } from "./billing.js";
import type { ExternalNote, InvoiceView, LedgerView, MarketplaceOffer, PurchasableOffer, SubscriptionView } from "./billingStore.js";
import type { ListingRecord } from "./store.js";

function shell(title: string, body: string, here = "/billing"): string {
  const current = (href: string) => here === href ? ` aria-current="page"` : "";
  return visionDocument(title, `<h1>${escapeHtml(title)}</h1>
    <nav aria-label="Vision API"><a href="/vision">Directory</a><a href="/learn">Learn</a><a href="/account">Account</a><a href="/publisher"${current("/publisher")}>Publisher</a><a href="/billing"${current("/billing")}>Billing</a><a href="/operator/">Monitor</a></nav>
    ${body}`);
}

function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

export function billingPage(input: {
  csrf: string;
  organizationId: string;
  organizationName: string;
  subscriptions: SubscriptionView[];
  invoices: InvoiceView[];
  notes: ExternalNote[];
  emailOptIn: boolean;
  offers: PurchasableOffer[];
  countries: string[];
  statement: LedgerView[];
  graceDays: number;
  now: Date;
}): string {
  const countryOptions = input.countries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join("");
  const offers = input.offers.map((offer) => `<article class="card">
      <h3>${escapeHtml(offer.listingName)}</h3>
      <p>${escapeHtml(offer.publisherName)} · ${escapeHtml(offer.planName)}</p>
      <p>${escapeHtml(formatMinor(offer.amountMinor, offer.currency))} / ${escapeHtml(offer.billingInterval)}</p>
      <form method="post" action="/billing/checkout">
        ${csrfField(input.csrf)}
        <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
        <input type="hidden" name="offerId" value="${escapeHtml(offer.id)}">
        <input type="hidden" name="idempotencyKey" value="${escapeHtml(randomUUID())}">
        <label>Country<select name="country">${countryOptions}</select></label>
        <label>I accept the <a href="/billing/terms">marketplace terms</a><input type="checkbox" name="terms" value="yes"></label>
        <button type="submit">Continue to hosted checkout</button>
      </form>
    </article>`).join("");
  const subscriptions = input.subscriptions.map((subscription) => {
    const renewal = renewalSentence(subscription.state, subscription.periodEnd, subscription.updatedAt);
    const access = accessSentence(subscription.state, subscription.periodEnd, subscription.canceledAt);
    const commerce = commerceSentences({
      state: subscription.state,
      periodEnd: subscription.periodEnd,
      disputeOpen: subscription.disputeOpen,
      publisherRestricted: subscription.publisherRestricted,
      graceDays: input.graceDays,
      now: input.now,
    }).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const help = subscription.state === "past_due" || subscription.state === "incomplete"
      ? `<p>This subscription needs a payment method update in the hosted portal. Card numbers stay on the payment processor.</p>`
      : "";
    return `<article class="card">
      <h3>${escapeHtml(subscription.listingName)}</h3>
      <p>${escapeHtml(subscription.providerName)} · ${escapeHtml(subscription.planName)}</p>
      <p>${escapeHtml(formatMinor(subscription.amountMinor, subscription.currency))} / ${escapeHtml(subscription.billingInterval)}</p>
      <p>State: ${escapeHtml(subscription.state)}</p>
      ${renewal ? `<p>${escapeHtml(renewal)}</p>` : ""}
      ${access ? `<p>${escapeHtml(access)}</p>` : ""}
      ${commerce}
      ${help}
      <form method="post" action="/billing/portal">
        ${csrfField(input.csrf)}
        <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
        <input type="hidden" name="subscriptionId" value="${escapeHtml(subscription.id)}">
        <button type="submit">Open hosted portal</button>
      </form>
    </article>`;
  }).join("");
  const statement = input.statement.map((row) => `<li>${escapeHtml(row.period)} ${escapeHtml(row.kind)} ${escapeHtml(formatMinor(row.grossMinor, row.currency))} gross, fee ${escapeHtml(formatMinor(row.feeMinor, row.currency))}, tax ${escapeHtml(formatMinor(row.taxMinor, row.currency))}, net ${escapeHtml(formatMinor(row.netMinor, row.currency))}, ${escapeHtml(row.payoutStatus)}</li>`).join("");
  const invoices = input.invoices.map((invoice) => {
    const label = `${formatMinor(invoice.amountPaidMinor, invoice.currency)} ${invoice.state}`;
    const link = invoice.hostedInvoiceUrl ? `<a href="${escapeHtml(invoice.hostedInvoiceUrl)}">${escapeHtml(label)}</a>` : escapeHtml(label);
    return `<li>${link}</li>`;
  }).join("");
  const notes = input.notes.map((note) => `<li>${escapeHtml(note.label)} · Not verified · <a href="${escapeHtml(note.url)}">${escapeHtml(note.url)}</a> ${escapeHtml(note.note)}</li>`).join("");
  return shell("Billing", `<p>${escapeHtml(input.organizationName || "No organization yet.")}</p>
    <p>A Vision API marketplace subscription is a purchase through Vision API. The payment processor is the source of its state, amount, and renewal time.</p>
    <p>An external provider subscription is one you hold directly with a third-party API. The note below is entered by your organization.</p>
    <h2>Marketplace subscriptions</h2>
    ${subscriptions || `<p class="note">No Vision API marketplace subscriptions.</p>`}
    <h2>Open plans</h2>
    ${offers || `<p class="note">No plans are open for checkout.</p>`}
    <p><a href="/billing/terms">Marketplace terms</a></p>
    <h2>Statement</h2>
    ${statement ? `<ul>${statement}</ul>` : `<p class="note">No marketplace charges yet.</p>`}
    <h2>Invoices</h2>
    ${invoices ? `<ul>${invoices}</ul>` : `<p class="note">No invoices.</p>`}
    <h2>External provider subscriptions</h2>
    ${notes ? `<ul>${notes}</ul>` : `<p class="note">No external notes.</p>`}
    <form method="post" action="/billing/external">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Label<input name="label" required></label>
      <label>URL<input name="url" type="url" required></label>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>
      <button type="submit">Save external subscription</button>
    </form>
    <h2>Billing email</h2>
    <form method="post" action="/billing/preferences">
      ${csrfField(input.csrf)}
      <label>Email billing notices<input type="checkbox" name="emailOptIn" value="yes"${input.emailOptIn ? " checked" : ""}></label>
      <button type="submit">Save preference</button>
    </form>
    <p>Billing notices go to a verified email address when this box is checked. Card numbers stay on the payment processor.</p>`);
}

export function offersPage(input: { csrf: string; organizationId: string; listings: ListingRecord[]; offers: MarketplaceOffer[]; chargesEnabled: boolean }): string {
  const options = input.listings.map((listing) => `<option value="${escapeHtml(listing.id)}">${escapeHtml(listing.name)}</option>`).join("");
  const offers = input.offers.map((offer) => `<li>${escapeHtml(offer.planName)} · ${escapeHtml(formatMinor(offer.amountMinor, offer.currency))} / ${escapeHtml(offer.billingInterval)} · ${escapeHtml(offer.status)}</li>`).join("");
  return shell("Marketplace offers", `<p>An offer is a plan on a listing your organization owns. Customers can subscribe after the listing is published, the offer is active, and processor charges and payouts are enabled.</p>
    <p>${input.chargesEnabled ? "Processor charges are enabled." : "Processor charges are not enabled."}</p>
    <form method="post" action="/publisher/offers">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Listing<select name="listingId">${options}</select></label>
      <label>Plan name<input name="planName" required></label>
      <label>Interval<select name="billingInterval"><option value="month">Month</option><option value="year">Year</option></select></label>
      <label>Amount in minor units<input name="amountMinor" inputmode="numeric" required></label>
      <label>Currency<input name="currency" value="USD" required></label>
      <button type="submit">Save offer</button>
    </form>
    ${offers ? `<ul>${offers}</ul>` : `<p class="note">No offers.</p>`}`, "/publisher");
}

export function processorPortalPage(): string {
  return shell("Payment processor", `<p>This is the hosted billing portal for a deployment that records processor events locally.</p>
    <p>Card numbers and security codes are not collected on this page. A configured Stripe secret key opens Stripe's customer portal instead.</p>
    <p><a href="/billing">Return to billing</a></p>`);
}

export function processorCheckoutPage(): string {
  return shell("Hosted checkout", `<p>This is the hosted checkout page for a deployment that records processor events locally.</p>
    <p>Card numbers and security codes are not collected on this page. A configured Stripe secret key opens Stripe checkout instead.</p>
    <p>A browser return does not activate access. The payment processor confirms the subscription.</p>
    <p><a href="/billing/checkout/return">Return from checkout</a></p>`);
}

export function checkoutReturnPage(): string {
  return shell("Checkout return", `<p>The payment processor has not confirmed this subscription.</p>
    <p>A browser return does not activate access.</p>
    <p><a href="/billing">Return to billing</a></p>`);
}

export function termsPage(): string {
  return shell("Marketplace terms", `<p>Vision API is the merchant of record for a marketplace subscription. The payment processor calculates tax on its hosted page and collects the card. This application does not store card numbers or security codes.</p>
    <p>The platform fee is set by the operator in basis points. The billing statement shows gross, fee, tax reported by the processor, and net as separate amounts.</p>
    <p>A refund is sent only after a staff member records a reason and confirms it. Cancellation follows the period end reported by the payment processor.</p>
    <p>A past-due payment does not keep access active. Access continues during a past-due period only while a configured grace period is still open.</p>
    <p>The publisher of an external API is responsible for that service. A marketplace subscription is not proof that a provider credential works.</p>
    <p><a href="/billing">Return to billing</a></p>`);
}
