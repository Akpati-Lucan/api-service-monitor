import type { StatusDocument } from "./pageData.js";

export function renderAtomFeed(document: StatusDocument, pageUrl: string): string {
  const entries = document.incidents.flatMap((incident) => incident.updates.map((update) => ({
    id: `${pageUrl}#${incident.id}-${update.at}`,
    title: `${incident.service}: ${update.state}`,
    updated: update.at,
    summary: update.message,
  })));
  entries.sort((left, right) => Date.parse(right.updated) - Date.parse(left.updated));
  const updated = entries[0]?.updated ?? document.updatedAt;
  const body = entries.map((entry) => `  <entry>
    <title>${escapeXml(entry.title)}</title>
    <id>${escapeXml(entry.id)}</id>
    <updated>${escapeXml(entry.updated)}</updated>
    <summary>${escapeXml(entry.summary)}</summary>
  </entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(document.title)}</title>
  <id>${escapeXml(pageUrl)}</id>
  <updated>${escapeXml(updated)}</updated>
  <link href="${escapeXml(pageUrl)}" rel="alternate"/>
${body}
</feed>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&apos;";
  });
}
