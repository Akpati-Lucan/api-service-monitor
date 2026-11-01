import type { ComponentStatus, PageStatus } from "../types/index.js";
import type { StatusDocument } from "./pageData.js";
import { statusPageCss } from "./pageCss.js";

export interface StatusLinks {
  jsonHref: string;
  badgeHref: string;
  feedHref: string;
}

const HEADLINE: Record<PageStatus, string> = {
  operational: "All clear",
  degraded: "Running slowly",
  down: "Something we run is down",
};

export function renderStatusHtml(document: StatusDocument, links?: StatusLinks): string {
  const owned = document.components.filter((component) => component.role !== "dependency");
  const dependencies = document.components.filter((component) => component.role === "dependency");
  const unchecked = document.components.length > 0 && document.components.every((component) => component.status === "unknown");
  const headline = unchecked ? "Not checked yet" : HEADLINE[document.status];
  const lamp = unchecked ? "unknown" : document.status;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)} status</title>
  <style>${statusPageCss}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(document.title)}</h1>
    <div class="signal">
      <div class="lamp lamp-${lamp}" role="img" aria-label="${escapeHtml(headline)}"></div>
      <div>
        <p class="headline">${escapeHtml(headline)}</p>
        <p class="detail">${escapeHtml(detail(document, unchecked))}</p>
        <p class="updated">Updated ${escapeHtml(formatUpdated(document.updatedAt))}</p>
      </div>
    </div>
    <h2>Components</h2>
    ${componentList(owned, "No components on this page yet.")}
    <h2>Dependencies</h2>
    <p class="note">A problem here belongs to an outside service. It does not, by itself, mean ${escapeHtml(document.title)} is down.</p>
    ${componentList(dependencies, "No outside services on this page.")}
    <h2>Incidents</h2>
    ${document.incidents.length === 0 ? "<p class=\"note\">No incidents in the last 14 days.</p>" : document.incidents.map(renderIncident).join("")}
    <footer>
      <p>Machine-readable copies: <a href="${escapeHtml(links?.jsonHref ?? "")}">JSON</a>, <a href="${escapeHtml(links?.badgeHref ?? "")}">badge</a>, <a href="${escapeHtml(links?.feedHref ?? "")}">feed</a>.</p>
    </footer>
  </main>
</body>
</html>`;
}

function detail(document: StatusDocument, unchecked: boolean): string {
  if (unchecked) return "A check has not finished, so this page is not calling the service healthy.";
  if (document.status === "down") return `${document.title} has a system that is not responding.`;
  if (document.status === "degraded") return `${document.title} is up, and part of it is slower than it should be.`;
  return `${document.title} is responding.`;
}

function componentList(components: StatusDocument["components"], empty: string): string {
  if (components.length === 0) return `<p class="note">${escapeHtml(empty)}</p>`;
  const items = components.map((component) => {
    const uptime = component.uptime90d == null ? "No uptime figure yet" : `${component.uptime90d}% over 90 days`;
    return `<li class="row row-${component.status}">
      <p class="name">${escapeHtml(component.name)}</p>
      <p class="state">${escapeHtml(label(component.status))}</p>
      <p class="uptime">${escapeHtml(uptime)}</p>
    </li>`;
  }).join("");
  return `<ul class="rows">${items}</ul>`;
}

function renderIncident(incident: StatusDocument["incidents"][number]): string {
  const updates = incident.updates.map((update) =>
    `<li>${escapeHtml(formatUpdated(update.at))}. ${escapeHtml(plainState(update.state))}: ${escapeHtml(update.message)}</li>`,
  ).join("");
  return `<article class="incident">
    <h3>${escapeHtml(incident.service)}</h3>
    <p>${escapeHtml(incident.reason)}</p>
    <p class="state">${incident.open ? "This incident is open." : "This incident has recovered."}${incident.state ? ` Latest state: ${escapeHtml(plainState(incident.state))}.` : ""}</p>
    <ul>${updates}</ul>
  </article>`;
}

function plainState(state: string): string {
  if (state.length === 0) return state;
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function label(status: ComponentStatus): string {
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}
