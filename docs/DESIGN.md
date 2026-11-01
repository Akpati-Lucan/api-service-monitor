# Design system

Harbor daylight. This document is the visual identity for the public status page. A future operator console, if one is built, should use these tokens and these rules. It should not invent a second palette.

## 1. Design philosophy

The page is an instrument. It reports a check that already happened. The first glance is a lamp and a sentence. Everything after that is a log: name, state word, uptime, then incidents. Decoration that does not answer “is it up?” does not belong.

## 2. Brand identity

The operator’s name is the title (`h1`). Our identity is the sheet, the type, and the lamp. There is no logomark. Do not draw a ship, a wave, or a lighthouse.

## 3. Target audience

Customers and on-call engineers opening one URL, often on a phone, often because something else already failed. See `docs/DESIGN_BRIEF.md`.

## 4. Emotional design direction

Calm daylight. Cool paper, dark ink, one colored lamp. Healthy pages feel finished. Outage pages feel the same, with a darker lamp and a direct sentence. The layout does not change personality when the status changes.

## 5. Colour palette

Tokens live in `src/status/pageCss.ts`.

| Token | Hex | Use |
| --- | --- | --- |
| `--paper` | `#E4EEF2` | Page ground, the tide |
| `--sheet` | `#F7FBFC` | The reading plate |
| `--ink` | `#102833` | Titles, names, headlines |
| `--muted` | `#1C3A46` | Supporting sentences |
| `--line` | `#C5D6DE` | Sheet edge and incident rules |
| `--clear` | `#0C6B4D` | Operational lamp and row strip |
| `--slow` | `#8A5A00` | Degraded lamp and row strip |
| `--down` | `#8E1D1D` | Down lamp and row strip |
| `--unknown` | `#4E616B` | Not-yet-checked lamp and row strip |
| `--focus` | `#0A6A8A` | Links and focus outline |

Text is `--ink` or `--muted` on `--sheet`. Status colors are marks, not text backgrounds, except the badge SVG, where the status word is white on `--clear`, `--slow`, or `--down`. Those three fills are dark enough for white at the badge’s 12px size (contrast above 4.5:1).

Do not put white type on a small green pill on the HTML page.

## 6. Typography

| Role | Stack | Size |
| --- | --- | --- |
| Title, section headings, headline | `"Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif` | Title 2.4rem (2rem under 640px). Headline 1.7rem. Sections 1.45rem |
| Body, rows, footer | `"Avenir Next", "Segoe UI", sans-serif` | 1.05rem, line-height 1.5 |

Both stacks are local. Do not add a font CDN. Do not set labels in all capitals. Do not use a middle dot to join facts. Put each fact on its own line.

The measure of a paragraph stays inside the 36rem sheet, which is under roughly 80 characters.

## 7. Spacing system

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 16px |
| `--space-4` | 24px |
| `--space-5` | 40px |
| `--space-6` | 64px |

Section headings use `--space-6` above them. Rows use `--space-3` of padding. Do not invent one-off margins.

## 8. Layout rules

One column. The sheet is left aligned on the paper with a left margin of `max(24px, 8vw)` and a top margin of `--space-6`. Content inside the sheet is left aligned. Do not center the sheet on large screens. Do not add a sidebar.

Order is fixed: title, signal, Components, Dependencies, Incidents, footer.

## 9. Responsive breakpoints

One breakpoint, 640px.

- At 640px and below the sheet margin becomes 0, side borders drop, horizontal padding becomes `--space-3`, the title becomes 2rem, and the lamp shrinks from 4.5rem to 3rem
- The signal stays a row. The lamp aligns to the top of the text
- There is no hamburger and no hidden section

## 10. Border radius

The sheet radius is 0. The lamp is the only circle, and it is a circle because it is a lamp (`border-radius: 50%`). Do not round cards, inputs, or badges toward a generic pill. The SVG badge uses `rx="3"` so the embed stays a compact label. That small radius is only for the badge.

## 11. Shadows and elevation

None. The sheet is separated from the paper by a 1px `--line` border. Do not add `box-shadow`.

## 12. Buttons

The public page has no buttons. If a later page needs one, use `--ink` text on `--sheet`, a 1px `--line` border, radius 0, and a 3px `--focus` outline on `:focus-visible`. Do not use a filled accent button as the default.

## 13. Forms

The public page has no forms. Later fields use the body font, `--ink` text, a 1px `--line` border, radius 0, and the same focus outline. Errors are a sentence in `--down`, plus the field border. Color is not the only error signal.

## 14. Cards

Do not use cards. A component is a row with a 6px left strip in the status color. Incidents are articles separated by a 1px rule.

## 15. Navigation

The public page has no site navigation. The footer is one sentence with three links: JSON, badge, and feed. Links use `--focus` and `text-underline-offset: 3px`.

## 16. Modals

None. Do not add a modal to the status page.

## 17. Tables

None. Component data is a list, not a table. If a later operator view needs a table, use the body font, left-aligned text, row rules in `--line`, and a text status as well as any color.

## 18. Notifications

The page is the notification. Do not add toasts. Incident updates are list items under the incident.

## 19. Icons

The lamp is the only symbol, and it is CSS, not an icon font. Do not add icon fonts or SVG icon sets.

## 20. Illustrations

None. Empty states are sentences.

## 21. Animations

None. `@media (prefers-reduced-motion: reduce)` sets `scroll-behavior: auto`. Do not add entrance motion, pulsing lamps, or hover slides.

## 22. Accessibility

- `lang="en"` on the document
- One `h1` (the page title). Sections are `h2`. Incident services are `h3`
- The lamp is `role="img"` with an `aria-label` of the headline. The headline is also visible text
- Each component row includes the status word
- Footer links show a 3px focus outline
- Contrast: `--ink` and `--muted` on `--sheet` are the text colors. Status colors are strips and the lamp
- The page still works with CSS off: title, sentences, lists, and links remain in order
- Do not rely on color alone

## 23. Dark mode

Not implemented. A dark theme would invert paper and ink and keep the same lamp hues darkened or lightened until white or ink text on them still clears 4.5:1. Do not ship a dark theme that only swaps the background and leaves the lamp colors unchecked.

## 24. Anti-patterns

Forbidden on this page, from `SKILL.md` and from the research:

- Warm cream background with a terracotta accent
- Near-black field with acid green
- Broadsheet hairline newspaper styling
- Rounded cards, soft shadows, and a grid of equal widgets
- All-caps eyebrow labels
- Middle-dot metadata (`operational · 100%`)
- A green pill or a full-width green banner as the identity
- Arrows stuck on links
- Fade or slide on load
- A font requested from Google Fonts or any other CDN
- An operator navigation bar on the public status page

## 25. Design implementation rules

- Put new status-page CSS in `src/status/pageCss.ts` and keep using the tokens. The production server runs `dist/`, and a loose `.css` file is not copied by `tsc`
- Escape every piece of page, component, and incident text with `escapeHtml`
- Keep the heading text `Dependencies`
- Keep component display names in the HTML
- Keep the status word inside the badge SVG
- Do not change the JSON document to satisfy a visual change
- Read this file, `docs/DESIGN_BRIEF.md`, and `docs/DESIGN_DECISIONS.md` before changing the status page

## Wireframe

```
 paper
  ┌ sheet ─────────────────────────┐
  │ Acme                           │
  │ (lamp)  All clear              │
  │         Acme is responding.    │
  │         Updated 31 Oct ... UTC │
  │                                │
  │ Components                     │
  │ ▎ Payments                     │
  │ ▎ Operational                  │
  │ ▎ 100% over 90 days            │
  │                                │
  │ Dependencies                   │
  │   sentence about outside       │
  │   services                     │
  │                                │
  │ Incidents                      │
  │   No incidents in the last     │
  │   14 days.                     │
  │                                │
  │ Machine-readable copies:       │
  │ JSON, badge, feed.             │
  └────────────────────────────────┘
```
