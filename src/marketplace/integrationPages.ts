import { escapeHtml } from "./markdown.js";
import { visionDocument } from "./pages.js";
import { exampleManifest, connectionSentences, providerSentences } from "./integrations.js";
import type { ConnectionView } from "./integrationStore.js";

function shell(body: string, billing: boolean): string {
  const billingLink = billing ? `<a href="/billing">Billing</a>` : "";
  return visionDocument("Connections", `<h1>Connections</h1>
    <nav aria-label="Vision API"><a href="/vision">Directory</a><a href="/learn">Learn</a><a href="/account">Account</a><a href="/publisher">Publisher</a>${billingLink}<a href="/connections" aria-current="page">Connections</a><a href="/operator/">Monitor</a></nav>
    ${body}`);
}

export function authorizePage(state: string): string {
  const hidden = `<input type="hidden" name="state" value="${escapeHtml(state)}">`;
  return shell(`<p>Example Status asks to read a status signal for your organization.</p>
    <p>Requested scope: status.read. This grant uses an authorization code and PKCE. A status check is a read.</p>
    <form method="post" action="/connections/sandbox/grant">
      ${hidden}
      <input type="hidden" name="decision" value="allow">
      <button type="submit">Grant status.read</button>
    </form>
    <form method="post" action="/connections/sandbox/grant">
      ${hidden}
      <input type="hidden" name="decision" value="deny">
      <button type="submit">Deny</button>
    </form>`, false);
}

export function connectionsPage(input: {
  csrf: string;
  organizationId: string;
  organizationName: string;
  orgs: Array<{ id: string; name: string }>;
  connections: Array<ConnectionView & { used: number }>;
  billing: boolean;
}): string {
  const intro = providerSentences().map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const docs = `<p><a href="${escapeHtml(exampleManifest.documentationUrl)}">Example Status documentation</a></p>`;
  const orgField = input.orgs.length > 1
    ? `<label>Organization<select name="organizationId">${input.orgs.map((org) => `<option value="${escapeHtml(org.id)}"${org.id === input.organizationId ? " selected" : ""}>${escapeHtml(org.name)}</option>`).join("")}</select></label>`
    : `<input type="hidden" name="organizationId" value="${escapeHtml(input.organizationId)}">`;
  const connect = input.organizationId ? `<form method="post" action="/connections/connect">
      <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
      ${orgField}
      <button type="submit">Connect Example Status</button>
    </form>` : "";
  const cards = input.connections.map((connection) => {
    const lines = connectionSentences(connection).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const hidden = `<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}"><input type="hidden" name="connectionId" value="${escapeHtml(connection.id)}"><input type="hidden" name="organizationId" value="${escapeHtml(connection.organizationId)}">`;
    return `<section>
      <h2>${escapeHtml(connection.providerId)}</h2>
      ${lines}
      <p>Status reads this hour: ${connection.used} of ${exampleManifest.rateLimitPerHour}.</p>
      <p>Updated ${escapeHtml(connection.updatedAt)}.</p>
      <form method="post" action="/connections/check">${hidden}<button type="submit">Check status</button></form>
      <form method="post" action="/connections/reauthorize">${hidden}<button type="submit">Reauthorize</button></form>
      <form method="post" action="/connections/rotate">${hidden}<button type="submit">Rotate grant</button></form>
      <form method="post" action="/connections/disconnect">${hidden}<label>Confirm this action<input type="checkbox" name="confirm" value="yes"></label><button type="submit">Disconnect</button></form>
      <form method="post" action="/connections/revoke">${hidden}<label>Confirm this action<input type="checkbox" name="confirm" value="yes"></label><button type="submit">Revoke</button></form>
      <form method="post" action="/connections/delete">${hidden}<label>Confirm this action<input type="checkbox" name="confirm" value="yes"></label><button type="submit">Delete</button></form>
    </section>`;
  }).join("");
  const name = input.organizationName ? `<p>${escapeHtml(input.organizationName)}</p>` : `<p>Create an organization before connecting a provider.</p>`;
  return shell(`${intro}${docs}${name}${connect}${cards}`, input.billing);
}
