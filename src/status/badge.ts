import type { PageStatus } from "../types/index.js";

export function renderBadge(status: PageStatus): string {
  const fill = status === "down" ? "#8e1d1d" : status === "degraded" ? "#8a5a00" : "#0c6b4d";
  const width = status === "operational" ? 118 : 96;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${status}">
  <rect width="${width}" height="20" rx="3" fill="${fill}"/>
  <text x="${width / 2}" y="14" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#ffffff">${status}</text>
</svg>`;
}
