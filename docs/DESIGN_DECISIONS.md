# Design decisions

## The only UI is the status page

The repository had one HTML response. Building buttons, modals, and an app shell would have been a new product, the operator console reserved for a later phase. The design system still names how those controls should look so a later page does not invent a second style.

## Harbor daylight, and one lamp

Status pages in the research lead with a green banner. That convention answers the question and also makes every product look like the same host. The sentence is the convention worth keeping. The lamp is the part that is ours: a single circle, large enough to see, with the words beside it.

The lamp has no label painted on it. Small white type on green was the contrast risk on the old pill. The headline is ink on the sheet.

## Cool paper, not cream

`SKILL.md` warns against the default warm cream and terracotta pairing, and against a near-black page with acid green. `#E4EEF2` is a daylight tide. `#F7FBFC` is the instrument face. Ink is `#102833`, which reads as a depth, not as pure black.

## Status colors are dark marks

`#0C6B4D`, `#8A5A00`, and `#8E1D1D` are dark so they work as a 6px strip and as badge fills under white type. Unknown is `#4E616B`, a neutral, because “not checked” is not a failure.

## “Not checked yet” is not “all clear”

The JSON rollup can be `operational` when every component is still `unknown`, because unknown rows are left out of the rollup. The HTML must not say “All clear” in that case. It says “Not checked yet” and uses the unknown lamp. The JSON field is unchanged.

## System fonts

A status page is opened when something else is down. A request to a font CDN is a failure mode. Palatino and Georgia are widespread for the title. Segoe UI and Avenir Next cover Windows and macOS for the body. The stacks degrade to serif and sans-serif.

## Left aligned sheet

The baseline centered a narrow column in a wide white window. Centering made the page feel like a blog post. The sheet sits on the left with a measured margin so the eye starts at the lamp. On a phone the sheet goes edge to edge and drops its side borders so it is not a floating card.

## No shadow, no radius on the sheet

Shadows and rounded rectangles are the SaaS card look the skill tells us to avoid. A 1px line is enough to separate the plate from the paper. The lamp is round because a lamp is round. That is the one circle.

## Rows, not cards

Each component is a name, a status word, and an uptime sentence, with a left strip in the status color. Cards would repeat the same chrome on every row and hide the log.

## Dependencies stay a heading

Tests and readers look for the word `Dependencies`. The section also explains that an outside failure does not, by itself, mark the page down. That sentence is the product rule from the status rollup, written for a person.

## Empty copy matches the data

Incidents on the page are open incidents plus incidents resolved in the last 14 days. The empty line says “No incidents in the last 14 days,” not “None,” so the window is visible.

## No motion

Nothing on the page moves. A pulsing lamp would imply a live connection we do not have. The reduced-motion query is set so a later change cannot add smooth scrolling by accident.

## Footer links are relative to the slug

The HTML route passes `slug.json`, `slug/badge.svg`, and `slug/feed.xml`. From `/status/:slug` those resolve to the three existing routes. The links are not added to the JSON document.

## Badge colors follow the lamp

The badge still contains the status word. Its fills are the same hex values as `--clear`, `--slow`, and `--down`. The shape stays a small rounded rectangle because it is an embed, not the page.

## CSS is a TypeScript string

`tsc` emits JavaScript, not loose CSS files. The Dockerfile runs `node dist/server.js`. Tokens in `src/status/pageCss.ts` are inlined into the HTML so production and tests both get the styles in one response.
