# Project design audit

Date: 31 October 2026. This audit was taken before the public status page was restyled.

## What this application is

A self-hosted API reliability monitor. Checks run on a schedule, incidents open and resolve from those checks, and a public page at `GET /status/:slug` tells customers what is happening. JSON, an SVG badge, and an Atom feed are the same document in other formats.

There is no operator console. Creating services, groups, keys, alert routes, and maintenance windows is done through the REST API or MCP. Product Phase 6 in `PLAN.md` is the later operator UI. This engagement does not build it.

## Stack

| Area | Finding |
| --- | --- |
| Language | TypeScript, Node 18+ |
| HTTP | Express 4 |
| Store | SQLite via better-sqlite3 |
| Validation | Zod |
| Logs | Pino |
| Tests | Vitest and Supertest, 48 tests, all passing before visual work |
| Build | `tsc -p tsconfig.json`, clean before visual work |
| Frontend framework | None. The status page is a string of HTML returned by `src/status/render.ts` |
| CSS | One inline `<style>` block. No Tailwind, no CSS modules, no component library |
| Client routing | None |
| Fonts | Previously the browser default sans-serif. No font file and no CDN |

`SKILL.md` at the project root is the Anthropic frontend-design skill. It was read in full and was not modified.

## Pages that exist

Only `GET /status/:slug` returns HTML. `GET /status/:slug.json`, `/status/:slug/badge.svg`, and `/status/:slug/feed.xml` are machine formats. Authenticated JSON routes are not a user interface.

## Baseline appearance

Inspected in a browser at `http://localhost:3000/status/baseline` on a wide viewport, before any HTML change.

The page was a white field with a centered column about 40rem wide. The title was the page name in a default sans-serif. Status was a small green pill containing the word `operational`. Components were a bulleted list (`Payments: operational · 100% / 90d`). Dependencies and incidents were the word `None`. There was no link to JSON, the badge, or the feed. Color in the pill was the main status signal. The column was centered, so a wide window was mostly empty white.

That baseline is the page this redesign replaces. The strings tests depend on stay: component display names, the heading `Dependencies`, the badge word (`down` and the other status words), and `Automatic:` in the Atom feed.

## Baseline test and build

From `c:\Users\KOFI\Desktop\api-service-monitor`, before editing the status HTML:

- `npm test`: 17 files, 48 tests, all passed
- `npm run build`: `tsc` exited 0

No existing test or build failure was found.

## What must stay

- Express, SQLite, routes, auth, MCP, probes, incidents, alerts, and Kubernetes manifests
- The JSON status document fields
- Public pages readable without a key; private pages still require a read key
- CSS delivered inside the HTML response, so a status page is one request and does not depend on a stylesheet host during an outage
- The dirty git tree. No commit and no branch were created for this work

## Decision

Restyle the status page only. Do not add React, a CSS framework, or an operator shell.
