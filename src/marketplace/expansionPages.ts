import { escapeHtml } from "./markdown.js";
import { visionDocument } from "./pages.js";
import type { CollectionItem, CollectionRecord, ListingNotice } from "./expansionStore.js";

function shell(title: string, body: string): string {
  return visionDocument(title, `<h1>${escapeHtml(title)}</h1>
    <nav aria-label="Vision API"><a href="/vision">Directory</a><a href="/learn">Learn</a><a href="/account">Account</a><a href="/publisher">Publisher</a><a href="/collections">Collections</a><a href="/operator/">Monitor</a></nav>
    ${body}`);
}

export function collectionsPage(input: {
  csrf: string;
  organizationId: string;
  organizationName: string;
  collections: Array<CollectionRecord & { items: string[] }>;
  notices: ListingNotice[];
  listingId: string;
}): string {
  const saved = input.collections.map((collection) => `<li><a href="/collections/${escapeHtml(collection.id)}/compare">${escapeHtml(collection.name)}</a><ul>${collection.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></li>`).join("");
  const notices = input.notices.map((notice) => `<li>${escapeHtml(notice.versionLabel)}: ${escapeHtml(notice.summary)}</li>`).join("");
  return shell("Collections", `<p>Collections stay inside ${escapeHtml(input.organizationName || "this organization")}. Saving a listing and creating a monitor each use their own form.</p>
    <form method="post" action="/collections/items">
      <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <label>Collection name<input name="name" value="Saved" required></label>
      <label>Listing id<input name="listingId" value="${escapeHtml(input.listingId)}" required></label>
      <button type="submit">Save listing</button>
    </form>
    ${saved ? `<ul>${saved}</ul>` : `<p class="note">No saved listings yet.</p>`}
    <h2>Version notices</h2>
    ${notices ? `<ul>${notices}</ul>` : `<p class="note">No version notices for saved listings.</p>`}`);
}

export function comparePage(input: { name: string; items: Array<CollectionItem & { badge: string }> }): string {
  const cards = input.items.map((item) => `<section>
      <h2><a href="/vision/${escapeHtml(item.slug)}">${escapeHtml(item.name)}</a></h2>
      <p>${escapeHtml(item.summary)}</p>
      <p class="meta">${escapeHtml(item.category)} · ${escapeHtml(item.priceSummary ?? "The provider publishes pricing.")}</p>
      <p class="meta">Regions ${escapeHtml(item.regions.join(", ") || "published by the provider")}.</p>
      ${item.badge ? `<p>${escapeHtml(item.badge)}</p>` : ""}
    </section>`).join("");
  return shell(`Compare ${input.name}`, `<p>Comparison shows the first three published listings in this private collection.</p>${cards || `<p class="note">No published listings in this collection.</p>`}`);
}

export function monitorPage(input: { csrf: string; organizationId: string; listingId: string; listingName: string; needsHost: boolean }): string {
  const host = input.needsHost ? `<label>Host<input name="host" required></label>` : `<input type="hidden" name="host" value="">`;
  return shell("Create a monitor", `<p>This creates a monitor in this installation from the reviewed template for ${escapeHtml(input.listingName)}. The secret reference is an environment variable name. The value stays in the environment.</p>
    <form method="post" action="/collections/monitors">
      <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
      <input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">
      <input type="hidden" name="listingId" value="${escapeHtml(input.listingId)}">
      <label>Monitor name<input name="name" required></label>
      ${host}
      <label>Secret reference<input name="secretRef" placeholder="NORTHWIND_TOKEN"></label>
      <button type="submit">Create monitor</button>
    </form>`);
}

export function monitorCreatedPage(input: { name: string; url: string; secretRef: string }): string {
  const ref = input.secretRef ? `<p>Secret reference ${escapeHtml(input.secretRef)}.</p>` : `<p>No secret reference was saved.</p>`;
  return shell("Monitor created", `<p>${escapeHtml(input.name)} checks ${escapeHtml(input.url)}.</p>${ref}<p><a href="/operator/">Open the operator console</a></p>`);
}
