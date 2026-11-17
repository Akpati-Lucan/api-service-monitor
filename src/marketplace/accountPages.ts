import { escapeHtml } from "./markdown.js";
import { visionDocument } from "./pages.js";
import { DELETED_ACCOUNT_DAYS, RESET_HOURS, SESSION_DAYS, VERIFY_HOURS } from "./publisher.js";
import type { DomainVerification, OrganizationRecord, PublicUser, PublisherNotification, PublisherProfile } from "./identity.js";
import type { ListingRecord, ReviewRecord } from "./store.js";

function shell(title: string, body: string, billing = false, connections = false): string {
  const billingLink = billing ? `<a href="/billing">Billing</a>` : "";
  const connectionsLink = connections ? `<a href="/connections">Connections</a>` : "";
  return visionDocument(title, `<h1>${escapeHtml(title)}</h1>
    <nav aria-label="Vision API"><a href="/vision">Directory</a><a href="/learn">Learn</a><a href="/account">Account</a><a href="/publisher">Publisher</a>${billingLink}${connectionsLink}<a href="/operator/">Monitor</a></nav>
    ${body}`);
}

function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

export function registerPage(): string {
  return shell("Create an account", `<p>A verification message is sent to the address you enter. The publisher portal stays closed until that address is verified.</p>
    <form method="post" action="/account/register">
      <label>Email<input name="email" type="email" required></label>
      <label>Display name<input name="displayName" required></label>
      <label>Password<input name="password" type="password" required minlength="12"></label>
      <button type="submit">Create account</button>
    </form>
    <p><a href="/account/login">Sign in</a></p>`);
}

export function registerSentPage(): string {
  return shell("Check your email", `<p>If this address can be registered, a verification link is on its way. It expires in ${VERIFY_HOURS} hours.</p>`);
}

export function loginPage(): string {
  return shell("Sign in", `<form method="post" action="/account/login">
      <label>Email<input name="email" type="email" required></label>
      <label>Password<input name="password" type="password" required></label>
      <button type="submit">Sign in</button>
    </form>
    <p><a href="/account/forgot">Forgot password</a></p>`);
}

export function forgotPage(): string {
  return shell("Reset a password", `<form method="post" action="/account/forgot">
      <label>Email<input name="email" type="email" required></label>
      <button type="submit">Send reset link</button>
    </form>
    <p>If an account exists, the link expires in ${RESET_HOURS} hour.</p>`);
}

export function resetPage(token: string): string {
  return shell("Choose a new password", `<form method="post" action="/account/reset">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>New password<input name="password" type="password" required minlength="12"></label>
      <button type="submit">Update password</button>
    </form>`);
}

export function accountHome(user: PublicUser, orgs: OrganizationRecord[], csrf: string, billing = false, connections = false): string {
  const list = orgs.length
    ? `<ul>${orgs.map((org) => `<li>${escapeHtml(org.name)} · ${escapeHtml(org.role ?? "member")}</li>`).join("")}</ul>`
    : `<p class="note">No organization yet.</p>`;
  return shell("Account", `<p>${escapeHtml(user.displayName)} · ${escapeHtml(user.email)}</p>
    <p>${user.emailVerifiedAt ? "Email verified." : "Email is not verified yet."}</p>
    ${list}
    <p>Sessions last ${SESSION_DAYS} days. Verification links last ${VERIFY_HOURS} hours. Reset links last ${RESET_HOURS} hour. A deleted account is anonymized immediately and removed after ${DELETED_ACCOUNT_DAYS} days. This account stores an email, a display name, and a password hash.</p>
    <p><a href="/account/export">Download account export</a></p>
    <p><a href="/collections">Collections</a></p>
    <form method="post" action="/account/invitations/accept">
      ${csrfField(csrf)}
      <label>Invitation token<input name="token" required></label>
      <button type="submit">Accept invitation</button>
    </form>
    <form method="post" action="/account/logout">${csrfField(csrf)}<button type="submit">Sign out</button></form>
    <form method="post" action="/account/delete">
      ${csrfField(csrf)}
      <label>Password<input name="password" type="password" required></label>
      <button type="submit">Delete account</button>
    </form>`, billing, connections);
}

export function publisherHome(input: {
  csrf: string;
  orgs: OrganizationRecord[];
  organizationId: string;
  profile: PublisherProfile | null;
  domains: DomainVerification[];
  listings: ListingRecord[];
  notifications: PublisherNotification[];
  members: Array<{ userId: string; role: string }>;
  billing?: boolean;
}): string {
  const org = input.orgs.find((item) => item.id === input.organizationId);
  const notices = input.notifications.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("");
  const domains = input.domains.map((domain) => `<li>${escapeHtml(domain.domain)} · ${escapeHtml(domain.status)} · ${escapeHtml(domain.method)}
      ${domain.status === "pending" && domain.method === "dns_txt" ? `<p>Add a TXT record at _vision-api.${escapeHtml(domain.domain)} with vision-verify=${escapeHtml(domain.token)}</p>` : ""}
      ${domain.status === "pending" && domain.method === "http_file" ? `<p>Publish https://${escapeHtml(domain.domain)}/.well-known/vision-api-verify.txt containing ${escapeHtml(domain.token)}</p>` : ""}
      ${domain.status === "pending" && domain.method !== "manual" ? `<form method="post" action="/publisher/domains/${escapeHtml(domain.id)}/check">${csrfField(input.csrf)}<input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}"><button type="submit">Check domain</button></form>` : ""}
    </li>`).join("");
  const listings = input.listings.map((listing) => `<li><a href="/publisher/listings/${escapeHtml(listing.id)}">${escapeHtml(listing.name)}</a> · ${escapeHtml(listing.status)}</li>`).join("");
  const members = input.members.map((member) => `<li>${escapeHtml(member.role)} · ${escapeHtml(member.userId)}
      <form method="post" action="/publisher/members/${escapeHtml(member.userId)}/role">${csrfField(input.csrf)}
        <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
        <select name="role"><option value="viewer">Viewer</option><option value="billing">Billing</option><option value="editor">Editor</option><option value="admin">Admin</option><option value="owner">Owner</option></select>
        <button type="submit">Change role</button>
      </form>
    </li>`).join("");
  const orgForm = input.orgs.length === 0
    ? `<form method="post" action="/publisher/organizations">${csrfField(input.csrf)}<label>Organization name<input name="name" required></label><button type="submit">Create organization</button></form>`
    : `<p>${escapeHtml(org?.name ?? "Organization")}</p>`;
  const offers = input.billing ? `<p><a href="/publisher/offers?organizationId=${escapeHtml(input.organizationId)}">Marketplace offers</a></p>` : "";
  return shell("Publisher", `<p>Listings belong to an organization. An email address does not prove that you operate a domain. Payment contact is not collected.</p>
    ${offers}
    ${orgForm}
    <h2>Profile</h2>
    <form method="post" action="/publisher/profile">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Legal or business name<input name="legalName" value="${escapeHtml(input.profile?.legalName ?? "")}" required></label>
      <label>Support URL<input name="supportUrl" value="${escapeHtml(input.profile?.supportUrl ?? "")}" required></label>
      <label>Privacy URL<input name="privacyUrl" value="${escapeHtml(input.profile?.privacyUrl ?? "")}" required></label>
      <label>Terms URL<input name="termsUrl" value="${escapeHtml(input.profile?.termsUrl ?? "")}" required></label>
      <label>Regions served<input name="regions" value="${escapeHtml((input.profile?.regions ?? []).join(", "))}"></label>
      <button type="submit">Save profile</button>
    </form>
    <h2>Domain ownership</h2>
    <form method="post" action="/publisher/domains">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Domain<input name="domain" required></label>
      <label>Method<select name="method"><option value="dns_txt">DNS TXT</option><option value="http_file">HTTPS file</option><option value="manual">Manual review</option></select></label>
      <button type="submit">Start check</button>
    </form>
    ${domains ? `<ul>${domains}</ul>` : `<p class="note">No domain checks.</p>`}
    <h2>Listings</h2>
    ${listings ? `<ul>${listings}</ul>` : `<p class="note">No listings.</p>`}
    <p><a href="/publisher/listings/new?organizationId=${escapeHtml(input.organizationId)}">New listing</a></p>
    <h2>People</h2>
    ${members ? `<ul>${members}</ul>` : ""}
    <form method="post" action="/publisher/invitations">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Email<input name="email" type="email" required></label>
      <label>Role<select name="role"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="billing">Billing</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label>
      <button type="submit">Invite</button>
    </form>
    <h2>Notices</h2>
    ${notices ? `<ul>${notices}</ul>` : `<p class="note">No notices.</p>`}`, input.billing === true);
}

export function listingForm(csrf: string, organizationId: string, listing?: ListingRecord): string {
  const value = (field: string) => escapeHtml(field);
  return shell(listing ? "Edit listing" : "New listing", `<p>This draft is not public. Provider links stay on the provider domain. Do not enter a provider credential.</p>
    <form method="post" action="${listing ? `/publisher/listings/${escapeHtml(listing.id)}` : "/publisher/listings"}">
      ${csrfField(csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(organizationId)}">
      <label>Name<input name="name" value="${value(listing?.name ?? "")}" required></label>
      <label>Summary<input name="summary" value="${value(listing?.summary ?? "")}" required></label>
      <label>Description<textarea name="descriptionMd" required>${value(listing?.descriptionMd ?? "")}</textarea></label>
      <label>Category<select name="category">
        <option value="payments">payments</option><option value="identity">identity</option><option value="messaging">messaging</option>
        <option value="storage">storage</option><option value="observability">observability</option><option value="ai">ai</option>
        <option value="data">data</option><option value="developer_tooling">developer tooling</option>
      </select></label>
      <label>Provider name<input name="providerName" value="${value(listing?.providerName ?? "")}" required></label>
      <label>Provider domain<input name="providerDomain" value="${value(listing?.providerDomain ?? "")}" required></label>
      <label>Documentation URL<input name="docsUrl" value="${value(listing?.docsUrl ?? "")}" required></label>
      <label>Terms URL<input name="termsUrl" value="${value(listing?.termsUrl ?? "")}" required></label>
      <label>Privacy URL<input name="privacyUrl" value="${value(listing?.privacyUrl ?? "")}" required></label>
      <label>Sign-up URL<input name="signupUrl" value="${value(listing?.signupUrl ?? "")}"></label>
      <button type="submit">${listing ? "Save listing" : "Create draft"}</button>
    </form>`);
}

export function listingDetail(input: { csrf: string; listing: ListingRecord; reviews: ReviewRecord[]; views: number; clicks: number; guideId: string | null; checkoutStarts: number; activeSubscriptions: number; canceledSubscriptions: number; refundMinor: number }): string {
  const history = input.reviews.map((review) => `<li>${escapeHtml(review.createdAt)} ${escapeHtml(review.decision)}: ${escapeHtml(review.note)}</li>`).join("");
  return shell(input.listing.name, `<p class="meta">${escapeHtml(input.listing.status)} · ${escapeHtml(input.listing.providerDomain)}</p>
    <p><a href="/publisher/listings/${escapeHtml(input.listing.id)}/preview">Preview</a></p>
    <p><a href="/publisher/listings/${escapeHtml(input.listing.id)}/edit">Edit</a></p>
    <p>Views ${input.views}. Outbound clicks ${input.clicks}. These counts are not tied to a visitor.</p>
    <p>Checkout starts ${input.checkoutStarts}. Active subscriptions ${input.activeSubscriptions}. Canceled subscriptions ${input.canceledSubscriptions}. Refunds ${input.refundMinor} minor units. These figures are totals for this listing.</p>
    <h2>Version notice</h2>
    <form method="post" action="/publisher/listings/${escapeHtml(input.listing.id)}/notices">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.listing.publisherId ?? "")}">
      <label>Version<input name="versionLabel" required></label>
      <label>Summary<input name="summary" required maxlength="200"></label>
      <button type="submit">Post notice</button>
    </form>
    <h2>Review history</h2>
    ${history ? `<ul>${history}</ul>` : `<p class="note">No review yet.</p>`}
    ${input.listing.status === "suspended" ? `<p>Suspension reason: ${escapeHtml(input.listing.reviewNote ?? "")}</p>` : ""}
    <form method="post" action="/publisher/listings/${escapeHtml(input.listing.id)}/submit">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.listing.publisherId ?? "")}">
      <button type="submit">Submit for review</button>
    </form>
    <h2>Guide</h2>
    <form method="post" action="/publisher/listings/${escapeHtml(input.listing.id)}/guides">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.listing.publisherId ?? "")}">
      <label>Title<input name="title" required></label>
      <label>Summary<input name="summary" required></label>
      <label>Body<textarea name="bodyMd" required></textarea></label>
      <button type="submit">Attach guide</button>
    </form>
    ${input.guideId ? `<p class="note">A guide is attached and stays unpublished until a reviewer verifies it.</p>` : ""}
    <h2>Appeal</h2>
    <form method="post" action="/publisher/listings/${escapeHtml(input.listing.id)}/appeal">
      ${csrfField(input.csrf)}
      <input type="hidden" name="organizationId" value="${escapeHtml(input.listing.publisherId ?? "")}">
      <label>Note<textarea name="note"></textarea></label>
      <button type="submit">Send appeal</button>
    </form>`);
}

export function previewPage(listing: ListingRecord): string {
  return shell(`Preview ${listing.name}`, `<p class="note">Preview. This listing is not public.</p>
    <p>${escapeHtml(listing.summary)}</p>
    <p class="meta">${escapeHtml(listing.providerName)} · ${escapeHtml(listing.providerDomain)}</p>`);
}
