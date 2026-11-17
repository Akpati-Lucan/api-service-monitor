import { findSecrets } from "./secrets.js";

export function renderMarkdown(source: string, options?: { allowCopy?: boolean }): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const text = code.join("\n");
      if (findSecrets(text).length > 0) {
        html.push(`<p class="note">This example was withheld because it contained a credential.</p>`);
      } else if (options?.allowCopy) {
        html.push(`<pre><code>${escapeHtml(text)}</code></pre><button type="button" data-copy>Copy example</button>`);
      } else {
        html.push(`<pre><code>${escapeHtml(text)}</code></pre>`);
      }
      continue;
    }
    if (line.startsWith("### ")) {
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      index += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      index += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      html.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith("- ")) {
        items.push(`<li>${escapeHtml((lines[index] ?? "").slice(2))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length
      && (lines[index] ?? "").trim() !== ""
      && !(lines[index] ?? "").startsWith("```")
      && !(lines[index] ?? "").startsWith("#")
      && !(lines[index] ?? "").startsWith("- ")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    html.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
  }
  return html.join("");
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] ?? character
  ));
}
