import { statusPageCss } from "../status/pageCss.js";
import { renderMarkdown, escapeHtml } from "./markdown.js";
import { CATEGORIES, publicStatusLabel, type PublicListing } from "./catalog.js";
import type { ListingRecord, ReportRecord } from "./store.js";

const extraCss = `
.filters { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); margin-top: var(--space-3); }
.card {
  margin-top: var(--space-4);
  padding: 0 0 var(--space-3) var(--space-3);
  border-top: 0;
  border-bottom: 1px solid var(--rule);
  border-left: 6px solid var(--spine);
}
.card h2, .card h3 { margin-top: 0; }
.card p { margin-top: var(--space-2); }
.meta { color: var(--muted); }
.status-published { color: var(--clear); }
.status-temporarily_unavailable { color: var(--slow); }
.status-retired, .status-under_review, .status-draft, .status-submitted, .status-changes_requested { color: var(--unknown); }
pre { overflow: auto; margin-top: var(--space-3); padding: var(--space-3); border: 1px solid var(--rule); background: var(--cloth); }
code { font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace; font-size: 0.95rem; }
button[data-copy] { margin-top: var(--space-2); }
section { margin-top: var(--space-5); padding-top: var(--space-3); border-top: 1px solid var(--rule); }
section h2 { margin-top: 0; }
`;

export function directoryPage(input: { listings: PublicListing[]; q: string; category: string; page: number; total: number; pageSize: number; portal?: boolean }): string {
  const cards = input.listings.map((listing) => `<article class="card">
    <p class="meta">External provider</p>
    <h2><a href="/vision/${escapeHtml(listing.slug)}">${escapeHtml(listing.name)}</a></h2>
    <p class="status-${escapeHtml(listing.publicStatus)}">${escapeHtml(publicStatusLabel(listing.publicStatus))}</p>
    <p>${escapeHtml(listing.summary)}</p>
    <p class="meta">${escapeHtml(listing.providerName)} · ${escapeHtml(categoryLabel(listing.category))}</p>
  </article>`).join("");
  const empty = input.listings.length === 0 ? `<p class="note">No listings match this search.</p>` : "";
  const pages = paging(input.page, input.total, input.pageSize, input.q, input.category);
  return document("Vision API directory", `<h1>Vision API</h1>
    ${nav(input.portal === true, "/vision")}
    <p>A curated directory of external providers. A listing is a link, not a connection, a purchase, or a promise of uptime.</p>
    <form method="get" action="/vision">
      <label>Search<input name="q" value="${escapeHtml(input.q)}"></label>
      <label>Category<select name="category"><option value="">All</option>${CATEGORIES.map((category) => `<option value="${category}"${category === input.category ? " selected" : ""}>${escapeHtml(categoryLabel(category))}</option>`).join("")}</select></label>
      <button type="submit">Search</button>
    </form>
    <p class="filters">${CATEGORIES.map((category) => `<a href="/vision?category=${category}">${escapeHtml(categoryLabel(category))}</a>`).join("")}</p>
    ${empty}${cards}${pages}`);
}

export function listingPage(listing: PublicListing, reported = false, guides: Array<{ slug: string; title: string }> = [], portal = false, extras?: { badge?: string; notices?: Array<{ versionLabel: string; summary: string }>; template?: boolean }): string {
  const description = renderMarkdown(listing.descriptionMd);
  const links = listing.links.length
    ? `<ul>${listing.links.map((link) => `<li><a href="/go/${escapeHtml(listing.id)}/${escapeHtml(link.id)}">${escapeHtml(link.label)}</a> <span class="meta">This link leaves Vision API.</span></li>`).join("")}</ul>`
    : `<p class="note">Provider links are hidden while this listing is ${escapeHtml(publicStatusLabel(listing.publicStatus).toLowerCase())}.</p>`;
  const reviewed = listing.lastReviewedAt ? `<p class="meta">Vision API last reviewed this listing ${escapeHtml(listing.lastReviewedAt)}.</p>` : "";
  const badge = extras?.badge ? `<p>${escapeHtml(extras.badge)}</p>` : "";
  const notices = extras?.notices?.length
    ? `<h2>Version notices</h2><ul>${extras.notices.map((notice) => `<li>${escapeHtml(notice.versionLabel)}: ${escapeHtml(notice.summary)}</li>`).join("")}</ul>`
    : "";
  const monitor = portal && extras?.template ? `<p><a href="/collections/monitor?listingId=${escapeHtml(listing.id)}">Create a monitor from the reviewed template</a></p>` : "";
  const save = portal ? `<p><a href="/collections?listingId=${escapeHtml(listing.id)}">Save in a collection</a></p>` : "";
  return document(listing.name, `    <h1>${escapeHtml(listing.name)}</h1>
    ${nav(portal, "/vision")}
    <p class="meta">External provider · ${escapeHtml(listing.providerName)} · ${escapeHtml(listing.providerDomain)}</p>
    <p class="status-${escapeHtml(listing.publicStatus)}">${escapeHtml(publicStatusLabel(listing.publicStatus))}</p>
    <p>${escapeHtml(listing.summary)}</p>
    ${reviewed}
    ${badge}
    <p class="note">This listing links to another company's product. Vision API does not sell it, connect your account, or promise its uptime. Read the provider's status page and terms.</p>
    ${description}
    <h2>Provider links</h2>
    ${links}
    <p class="meta">${escapeHtml(listing.priceSummary ?? "The provider publishes pricing.")}</p>
    ${notices}
    ${save}
    ${monitor}
    <h2>Guides</h2>
    ${guides.length ? `<ul>${guides.map((guide) => `<li><a href="/learn/${escapeHtml(guide.slug)}">${escapeHtml(guide.title)}</a></li>`).join("")}</ul>` : `<p class="note">No verified guide is published for this listing.</p>`}
    <h2>Report this listing</h2>
    ${reported ? `<p>Report received. It is in the moderation queue.</p>` : ""}
    <form method="post" action="/vision/${escapeHtml(listing.slug)}/reports">
      <label>What is wrong<select name="kind"><option value="stale">Stale</option><option value="misleading">Misleading</option><option value="unsafe">Unsafe</option><option value="other">Other</option></select></label>
      <label>Note<textarea name="note" required maxlength="500"></textarea></label>
      <button type="submit">Send report</button>
    </form>`);
}

export function learnPage(guides: Array<{ slug: string; title: string; summary: string; kind: string; difficulty: string }>, portal = false): string {
  const groups = ["quickstart", "tutorial", "setup", "troubleshooting", "glossary"] as const;
  const labels: Record<string, string> = {
    quickstart: "Quickstarts",
    tutorial: "Tutorials",
    setup: "Provider setup",
    troubleshooting: "Troubleshooting",
    glossary: "Glossary",
  };
  const sections = groups.map((kind) => {
    const items = guides.filter((guide) => guide.kind === kind);
    const list = items.length
      ? `<ul>${items.map((guide) => `<li><a href="/learn/${escapeHtml(guide.slug)}">${escapeHtml(guide.title)}</a> <span class="meta">${escapeHtml(guide.difficulty)}</span><p>${escapeHtml(guide.summary)}</p></li>`).join("")}</ul>`
      : `<p class="note">None published.</p>`;
    return `<h2>${labels[kind]}</h2>${list}`;
  }).join("");
  return document("Learning center", `<h1>Learning center</h1>
    ${nav(portal, "/learn")}
    <p>Lessons are instructions. They do not install a provider, take a payment, or store a credential.</p>
    ${sections}`);
}

export function guidePage(page: {
  title: string;
  summary: string;
  bodyMd: string;
  prerequisites: string;
  difficulty: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  kind: string;
  locale: string;
  purpose: string;
  minPermissions: string;
  credentialLocation: string;
  localTestMd: string;
  productionMd: string;
  securityNotes: string;
  costNotes: string;
  commonErrorsMd: string;
  cleanupMd: string;
  testedVersion: string;
  testEnvironment: string;
  compatibilityNotes: string;
  successMd: string;
  exampleText: string;
  slug: string;
  revision: number;
  stale: boolean;
  pendingReview: boolean;
  copyAllowed: boolean;
  docsHref: string | null;
  setupHref: string | null;
  history: Array<{ version: number; note: string; author: string; createdAt: string }>;
}, nonce: string, portal = false): string {
  const history = page.history.length
    ? `<ol>${page.history.map((revision) => `<li>Revision ${revision.version}, ${escapeHtml(revision.createdAt)}, ${escapeHtml(revision.author)}: ${escapeHtml(revision.note)}</li>`).join("")}</ol>`
    : `<p class="note">Revision ${page.revision}.</p>`;
  const download = page.copyAllowed
    ? `<p><a href="/learn/${escapeHtml(page.slug)}/example.txt">Download the read-only example</a></p><p class="note">The file reads your own monitor. It does not send YOUR_API_TOKEN to Vision API.</p>`
    : "";
  return document(page.title, `<h1>${escapeHtml(page.title)}</h1>
    ${nav(portal, "/learn")}
    <p>${escapeHtml(page.summary)}</p>
    <p class="meta">Verified by ${escapeHtml(page.verifiedBy ?? "an editor")} on ${escapeHtml(page.verifiedAt ?? "")}. Difficulty: ${escapeHtml(page.difficulty)}. Language: ${escapeHtml(page.locale)}.</p>
    <p class="meta">Tested version: ${escapeHtml(page.testedVersion || "not recorded")}. Test environment: ${escapeHtml(page.testEnvironment || "not recorded")}.</p>
    ${page.stale ? `<p class="status-temporarily_unavailable">This guide has not been verified recently.</p>` : ""}
    ${page.pendingReview ? `<p class="note">An update is in review. This page still shows the last verified revision.</p>` : ""}
    ${section("Purpose", page.purpose)}
    <h2>Prerequisites</h2>
    <p>${escapeHtml(page.prerequisites)}</p>
    ${section("Minimum permissions", page.minPermissions)}
    ${section("Where the credential is created", page.credentialLocation)}
    <p>${page.setupHref ? `<a href="${escapeHtml(page.setupHref)}">Open the provider account page</a> <span class="meta">This link leaves Vision API.</span>` : ""}</p>
    ${section("Local test", page.localTestMd, true)}
    ${section("Production", page.productionMd, true)}
    ${section("Security", page.securityNotes)}
    ${section("Cost", page.costNotes)}
    ${section("Common errors", page.commonErrorsMd, true)}
    <h2>Cleanup</h2>
    <p>${escapeHtml(page.cleanupMd)}</p>
    ${section("Compatibility", page.compatibilityNotes)}
    <p>${page.docsHref ? `<a href="${escapeHtml(page.docsHref)}">Official provider docs</a> <span class="meta">This link leaves Vision API.</span>` : ""}</p>
    ${renderMarkdown(page.bodyMd, { allowCopy: true })}
    ${section("Success check", page.successMd)}
    ${download}
    <h2>History</h2>
    ${history}
    <p class="note">Examples use placeholders such as YOUR_API_KEY. Copy stays in this browser.</p>
    <h2>Report this guide</h2>
    <form method="post" action="/learn/${escapeHtml(page.slug)}/reports">
      <label>What is wrong<select name="kind"><option value="error">Error</option><option value="stale">Stale</option></select></label>
      <label>Note<textarea name="note" required maxlength="500"></textarea></label>
      <button type="submit">Send report</button>
    </form>`, nonce);
}

export function editorGate(portal = false): string {
  return document("Vision API editor", `<h1>Editor</h1>
    ${nav(portal, "/vision/editor")}
    <p>Editorial review uses a staff token. A monitor API key cannot publish a listing.</p>
    <form method="post" action="/vision/editor">
      <label>Staff token<input name="token" type="password" autocomplete="off" required></label>
      <button type="submit">Open queue</button>
    </form>`);
}

export function editorPage(token: string, listings: ListingRecord[], reports: ReportRecord[], guides: Array<{ id: string; title: string; slug: string }> = [], guideReports: Array<{ kind: string; note: string }> = [], extras?: { portal?: boolean; appeals?: Array<{ id: string; note: string }>; domains?: Array<{ id: string; domain: string }>; audit?: Array<{ action: string; createdAt: string }>; duplicates?: string[]; billing?: { counts: string[]; problems: string[]; offers: Array<{ id: string; planName: string }>; subscriptions: Array<{ id: string; state: string }>; accounts: Array<{ processorAccountRef: string; onboardingState: string; chargesEnabled: boolean }>; ledger: string[]; publishers: Array<{ id: string; restricted: boolean }> } }): string {
  const rows = listings.map((listing) => `<article class="card">
    <h2>${escapeHtml(listing.name)}</h2>
    <p class="meta">${escapeHtml(listing.status)} · ${escapeHtml(listing.slug)}</p>
    <p>${escapeHtml(listing.summary)}</p>
    ${listing.reviewNote ? `<p class="note">Review note: ${escapeHtml(listing.reviewNote)}</p>` : ""}
    <p><a href="/vision/${escapeHtml(listing.slug)}">Public page</a></p>
    <form method="post" action="/vision/editor/${escapeHtml(listing.id)}/publish">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>Note<input name="note" value="Reviewed and published."></label>
      <button type="submit">Publish</button>
    </form>
    <form method="post" action="/vision/editor/${escapeHtml(listing.id)}/suspend">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>Note<input name="note" value="Temporarily unavailable."></label>
      <button type="submit">Suspend</button>
    </form>
    <form method="post" action="/vision/editor/${escapeHtml(listing.id)}/retire">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>Note<input name="note" value="Retired from the directory."></label>
      <button type="submit">Retire</button>
    </form>
  </article>`).join("");
  const queue = reports.map((report) => `<li>${escapeHtml(report.kind)}: ${escapeHtml(report.note)}</li>`).join("");
  const lessons = guides.map((guide) => `<article class="card">
    <h2>${escapeHtml(guide.title)}</h2>
    <p><a href="/learn/${escapeHtml(guide.slug)}">Public lesson</a></p>
    <form method="post" action="/vision/editor/guides/${escapeHtml(guide.id)}/verify">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>Note<input name="note" value="Checked against the provider docs."></label>
      <button type="submit">Mark guide current</button>
    </form>
  </article>`).join("");
  const guideQueue = guideReports.map((report) => `<li>${escapeHtml(report.kind)}: ${escapeHtml(report.note)}</li>`).join("");
  const appeals = (extras?.appeals ?? []).map((appeal) => `<li>${escapeHtml(appeal.note)}
      <form method="post" action="/vision/editor/appeals/${escapeHtml(appeal.id)}/upheld"><input type="hidden" name="token" value="${escapeHtml(token)}"><input name="note" value="Suspension stands."><button type="submit">Uphold</button></form>
      <form method="post" action="/vision/editor/appeals/${escapeHtml(appeal.id)}/reversed"><input type="hidden" name="token" value="${escapeHtml(token)}"><input name="note" value="Send the listing back for changes."><button type="submit">Reverse</button></form>
    </li>`).join("");
  const domains = (extras?.domains ?? []).map((domain) => `<li>${escapeHtml(domain.domain)}
      <form method="post" action="/vision/editor/domains/${escapeHtml(domain.id)}/verify"><input type="hidden" name="token" value="${escapeHtml(token)}"><input name="note" value="Manual records match the provider."><button type="submit">Verify domain</button></form>
    </li>`).join("");
  const audit = (extras?.audit ?? []).map((row) => `<li>${escapeHtml(row.createdAt)} ${escapeHtml(row.action)}</li>`).join("");
  const duplicates = (extras?.duplicates ?? []).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const billing = extras?.billing;
  const billingHtml = billing ? `<h2>Billing reconciliation</h2>
    ${billing.counts.length ? `<ul>${billing.counts.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p class="note">No marketplace subscriptions.</p>`}
    ${billing.problems.length ? `<ul>${billing.problems.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p class="note">No failed billing events.</p>`}
    <form method="post" action="/vision/editor/billing/reconcile"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Reconcile</button></form>
    <h2>Draft offers</h2>
    ${billing.offers.length ? `<ul>${billing.offers.map((offer) => `<li>${escapeHtml(offer.planName)} <form method="post" action="/vision/editor/offers/${escapeHtml(offer.id)}/activate"><input type="hidden" name="token" value="${escapeHtml(token)}"><label>Processor price<input name="providerPriceRef"></label><button type="submit">Activate offer</button></form></li>`).join("")}</ul>` : `<p class="note">No draft offers.</p>`}
    <h2>Ledger</h2>
    ${billing.ledger.length ? `<ul>${billing.ledger.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<p class="note">No ledger totals.</p>`}
    <h2>Publisher eligibility</h2>
    ${billing.publishers.length ? `<ul>${billing.publishers.map((publisher) => `<li>${escapeHtml(publisher.id)} · ${publisher.restricted ? "restricted" : "eligible"}
      <form method="post" action="/vision/editor/billing/${publisher.restricted ? "restore" : "restrict"}"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="publisherId" value="${escapeHtml(publisher.id)}"><label>Reason<input name="reason" value="${publisher.restricted ? "Onboarding restored." : "Publisher lost eligibility."}"></label><label>Approved<input type="checkbox" name="approved" value="yes"></label><button type="submit">${publisher.restricted ? "Restore checkouts" : "Stop new checkouts"}</button></form></li>`).join("")}</ul>` : `<p class="note">No publisher accounts.</p>`}
    <h2>Refunds</h2>
    ${billing.subscriptions.length ? `<ul>${billing.subscriptions.map((subscription) => `<li>${escapeHtml(subscription.state)} <form method="post" action="/vision/editor/billing/refund"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="subscriptionId" value="${escapeHtml(subscription.id)}"><label>Amount in minor units<input name="amountMinor" value="100"></label><label>Reason<input name="reason" value="Customer requested a refund."></label><label>Approved<input type="checkbox" name="approved" value="yes"></label><button type="submit">Refund</button></form></li>`).join("")}</ul>` : `<p class="note">No subscriptions to refund.</p>`}
    <h2>Connected accounts</h2>
    <p>These processor identifiers stay on the staff page.</p>
    ${billing.accounts.length ? `<ul>${billing.accounts.map((account) => `<li>${escapeHtml(account.processorAccountRef)} · ${escapeHtml(account.onboardingState)} · ${account.chargesEnabled ? "charges enabled" : "charges disabled"}</li>`).join("")}</ul>` : `<p class="note">No connected accounts.</p>`}` : "";
  return document("Vision API editor", `<h1>Editor</h1>
    ${nav(extras?.portal === true, "/vision/editor")}
    <p>Preview shows the summary and the internal review note. Publish, suspend, and retire update the public directory immediately.</p>
    <h2>Possible duplicates</h2>
    ${duplicates ? `<ul>${duplicates}</ul>` : `<p class="note">No duplicate domains in the queue.</p>`}
    <h2>Manual domain checks</h2>
    ${domains ? `<ul>${domains}</ul>` : `<p class="note">No manual domain checks.</p>`}
    <h2>Appeals</h2>
    ${appeals ? `<ul>${appeals}</ul>` : `<p class="note">No open appeals.</p>`}
    ${billingHtml}
    <h2>Audit</h2>
    ${audit ? `<ul>${audit}</ul>` : `<p class="note">No audit records.</p>`}
    <h2>Moderation queue</h2>
    ${queue ? `<ul>${queue}</ul>` : `<p class="note">No open reports.</p>`}
    <h2>Guide reports</h2>
    ${guideQueue ? `<ul>${guideQueue}</ul>` : `<p class="note">No open guide reports.</p>`}
    ${lessons}
    ${rows}`);
}

export function messagePage(title: string, message: string, status = 200, portal = false): { status: number; html: string } {
  return { status, html: document(title, `<h1>${escapeHtml(title)}</h1>${nav(portal)}<p>${escapeHtml(message)}</p>`) };
}

export function visionDocument(title: string, body: string): string {
  return document(title, body);
}

function nav(portal = false, here = ""): string {
  const account = portal ? `${navLink("/account", "Account", here)}${navLink("/publisher", "Publisher", here)}` : "";
  return `<nav aria-label="Vision API">${navLink("/vision", "Directory", here)}${navLink("/learn", "Learn", here)}${account}${navLink("/vision/editor", "Editor", here)}${navLink("/operator/", "Monitor", here)}</nav>`;
}

function navLink(href: string, label: string, here: string): string {
  const current = here === href ? ` aria-current="page"` : "";
  return `<a href="${href}"${current}>${label}</a>`;
}

function section(title: string, body: string, markdown = false): string {
  if (!body.trim()) return "";
  return `<h2>${escapeHtml(title)}</h2>${markdown ? renderMarkdown(body, { allowCopy: true }) : `<p>${escapeHtml(body)}</p>`}`;
}

function paging(page: number, total: number, pageSize: number, q: string, category: string): string {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const query = (next: number) => `/vision?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&page=${next}`;
  const parts: string[] = [];
  if (page > 1) parts.push(`<a href="${query(page - 1)}">Previous</a>`);
  if (page < last) parts.push(`<a href="${query(page + 1)}">Next</a>`);
  return parts.length ? `<p class="meta">${parts.join(" ")}</p>` : "";
}

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}

function document(title: string, body: string, nonce = ""): string {
  const script = nonce
    ? `<script nonce="${escapeHtml(nonce)}">document.querySelectorAll("[data-copy]").forEach((button)=>{button.addEventListener("click",async()=>{const pre=button.previousElementSibling;const code=pre&&pre.querySelector("code");if(!code)return;try{await navigator.clipboard.writeText(code.textContent||"");button.textContent="Copied";}catch(error){button.textContent="Select the example instead";}});});</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Vision API is a curated directory of external providers.">
  <style>${statusPageCss}${extraCss}</style>
</head>
<body>
  <main>${body}</main>
  ${script}
</body>
</html>`;
}
