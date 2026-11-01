# Component guidelines

The status page is server-rendered HTML. These are the reusable pieces. They are functions and class names in `src/status/render.ts` and `src/status/pageCss.ts`, not a React library. Use them instead of writing a second status layout.

## Signal

The block under the title. A lamp div plus a headline, a detail sentence, and an updated time.

| State | Lamp class | Headline | Detail |
| --- | --- | --- | --- |
| operational | `lamp lamp-operational` | All clear | `{title} is responding.` |
| degraded | `lamp lamp-degraded` | Running slowly | `{title} is up, and part of it is slower than it should be.` |
| down | `lamp lamp-down` | Something we run is down | `{title} has a system that is not responding.` |
| all components unknown | `lamp lamp-unknown` | Not checked yet | A check has not finished, so this page is not calling the service healthy. |

The lamp is `role="img"` and its accessible name is the headline. The headline is also a visible paragraph. Do not put the only copy of the headline inside the lamp.

## Component row

A `li.row` with a modifier:

- `row-operational`
- `row-degraded`
- `row-down`
- `row-unknown`

Inside, in order: `p.name`, `p.state`, `p.uptime`.

State text is `Operational`, `Degraded`, `Down`, or `Unknown`. Uptime is `{n}% over 90 days` or `No uptime figure yet`.

Owned components and dependencies both use this row. They are separate lists under their own `h2`.

## Empty states

| Section | Copy |
| --- | --- |
| Components | No components on this page yet. |
| Dependencies | No outside services on this page. The intro sentence above the list always stays. |
| Incidents | No incidents in the last 14 days. |

Empty copy is `p.note`. Do not render an empty `<ul>`.

## Incident

An `article.incident` with an `h3` (service name), the reason, one sentence, and a list of updates. The sentence is “This incident is open.” or “This incident has recovered.” followed by “Latest state:” and the workflow word with its first letter capitalized (`Investigating`, `Identified`, `Monitoring`, `Resolved`). Each update is a time, that same word, and the message. Escape all of it.

The sentence says whether the incident is still open. The workflow word is the latest human or automatic update. A resolved update does not by itself close the incident.

## Footer

One sentence: “Machine-readable copies:” then links whose visible words are `JSON`, `badge`, and `feed`. The route supplies the hrefs. Do not hard-code a slug into the renderer.

## Badge

`renderBadge` in `src/status/badge.ts`. The SVG must contain the status word `operational`, `degraded`, or `down`. Fills: `#0c6b4d`, `#8a5a00`, `#8e1d1d`. This is an embed, not a page component. Do not rebuild it as HTML.

## What not to add here

Buttons, inputs, modals, toasts, icon fonts, and a navigation bar are not part of this page. If a later surface needs them, follow the matching section in `docs/DESIGN.md` and add the markup once, in a shared function, rather than copying styles into a new template.
