# Design system

Field register. This is the visual identity for the public status page, the operator console, and the Vision API pages. They share these tokens. A new page uses this register. It does not invent a second palette.

## 1. Design philosophy

The product is a bound field book. Operators record checks. Visitors read a directory and a status. Publishers file listings. The first thing on a status page is a square stamp and a sentence. Everything after that is a ruled entry: name, state word, uptime, then incidents. Directory, account, billing, and console pages use the same spine, type, and rules so the product feels like one book with several sections.

Decoration that does not answer “is it up?”, “which listing?”, or “what do I do next?” does not belong.

## 2. Brand identity

The page title is the operator’s name on a status page, and the section name (`Operator`, `Vision API`, `Billing`) everywhere else. Our identity is the cloth spine, the slab headings, and the square stamp. There is no logomark. Do not draw a ship, a lighthouse, a leaf, or a book.

## 3. Target audience

Customers and on-call engineers opening one status URL, often on a phone. Operators configuring checks on this installation. Visitors reading Vision API listings and lessons. Publishers managing an organization. See `docs/DESIGN_BRIEF.md`.

## 4. Emotional design direction

A field book left open on a cloth cover. Healthy pages and outage pages use the same paper. Only the stamp color changes. The layout does not change personality when the status changes.

## 5. Colour palette

Tokens live in `src/status/pageCss.ts` and are repeated in `public/operator/app.css`. Change both together.

| Token | Hex | Role |
| --- | --- | --- |
| `--cloth` | `#D5DDD0` | Page ground, the cover around the open page |
| `--leaf` | `#F6F7F2` | The open page |
| `--spine` | `#1E3A2F` | Binding band, entry marks that are not a status, filled buttons |
| `--ink` | `#172117` | Titles, names, headlines |
| `--muted` | `#3A463C` | Supporting sentences |
| `--rule` | `#C5CFC0` | Page edge, section rules, row rules |
| `--clear` | `#0E6B45` | Operational stamp and row strip |
| `--slow` | `#8A5300` | Degraded stamp and row strip |
| `--down` | `#8E2D28` | Down stamp and row strip |
| `--unknown` | `#5A655C` | Not-yet-checked stamp and row strip |
| `--focus` | `#1A4E86` | Links and the focus outline |

Text is `--ink` or `--muted` on `--leaf`. Button text is `--leaf` on `--spine`. Status colors are marks, not text backgrounds, except the badge SVG, where the status word is white on `--clear`, `--slow`, or `--down`. Those three fills clear 4.5:1 with white at 12px.

`--muted` on `--leaf` and `--focus` on `--leaf` also clear 4.5:1. Do not put white type on a small green pill on the HTML page.

## 6. Typography

| Role | Stack | Size |
| --- | --- | --- |
| Nameplate: titles, section headings, status headline | `Rockwell, "Rockwell Nova", "American Typewriter", "Nimbus Roman", serif` | Title 2.5rem (2rem under 640px). Headline 1.85rem (1.5rem under 640px). Sections 1.5rem |
| Reading: body, navigation, forms | `Candara, "Segoe UI", "Avenir Next", "Liberation Sans", sans-serif` | 1.0625rem, line-height 1.55 |
| Examples | `"Cascadia Mono", "Cascadia Code", Consolas, monospace` | 0.95rem inside `pre` |

Both reading stacks are local. Do not add a font CDN. Do not set labels in all capitals. Do not italicize a single word in a headline. Do not use a middle dot to join new facts. Existing sentences that already contain a middle dot stay, because tests assert them.

The writing measure is 44rem on every page. A paragraph inside that width stays near a readable line.

## 7. Spacing system

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 16px |
| `--space-4` | 24px |
| `--space-5` | 40px |
| `--space-6` | 64px |

Section headings use `--space-6` above them. Paragraphs use `--space-3` above them. Rows use `--space-3` of padding. Do not invent one-off margins.

## 8. Layout rules

One column, left aligned, bound to the spine. The spine is a 16px `--spine` band on the left of the viewport. The leaf fills the rest of the window, so the page is not a floating card. The writing measure stays 44rem; extra space on a wide screen is empty paper to the right of the text, produced with padding. Do not center the text. Do not add a sidebar. `--cloth` is the ground of an example block, not the page field.

On the status page the order is fixed: title, stamp and sentence, Components, Dependencies, Incidents, Updates, footer.

Vision API pages open with the section title, a navigation line, then the task. The operator console opens with the title, one sentence, the same kind of navigation line, then the token field and the current view.

## 9. Responsive breakpoints

One breakpoint, 640px.

- At 640px and below the spine moves to a 10px band across the top, horizontal padding becomes `--space-3`, fields use the full column, the title becomes 2rem, and the stamp shrinks from 4.75rem to 3rem
- The stamp stays at the top of the sentence
- Navigation wraps. It does not collapse into a hidden menu

## 10. Border radius

Radius is 0. The stamp is a square because it is a stamp in a register, not a lamp and not a pill. Do not round cards, inputs, or buttons. The SVG badge uses `rx="3"` so the embed stays a compact label. That small radius is only for the badge.

## 11. Shadows and elevation

None. The page is separated from the cloth by a 1px `--rule` border. The spine is a background band, not a shadow. Do not add `box-shadow` for elevation. The only inset shadow is the 3px underline on the current navigation item.

## 12. Buttons

Filled `--spine` with `--leaf` text, radius 0, and a 3px `--focus` outline on `:focus-visible`. The label names the result (`Save profile`, `Send confirmation`, `Create monitor`). Hover darkens the fill to `#15281F`. Do not append an arrow.

## 13. Forms

Fields use the reading font, `--ink` text, a 1px `--spine` border, radius 0, and the same focus outline. Hidden inputs stay hidden. Checkboxes stay inline in their label. Errors are a sentence in `--down`, plus the field border when a control is invalid. Color is not the only error signal.

## 14. Cards

Do not build a card grid. A status component is a row with a 6px left strip in the status color and a bottom rule. A directory or billing entry uses the same ruled row, with a `--spine` strip when the row is not a health status. The class name `card` remains in the directory and billing markup so existing structure stays. It is styled as a ruled entry.

## 15. Navigation

A wrapping line of text links under the title, with a bottom rule. The current section gets `aria-current="page"` and a 3px `--spine` underline. The public status page has no site navigation. Its footer is one sentence with three links: JSON, badge, and feed. Links use `--focus` and `text-underline-offset: 3px`.

## 16. Modals

None. Do not add a modal to these pages.

## 17. Tables

None. Component data, listings, and statements are lists. If a later view needs a table, use the reading font, left-aligned text, row rules in `--rule`, and a text status as well as any color.

## 18. Notifications

The status page is the notification. Do not add toasts. The operator console writes the result of an action into the existing status line. Incident updates are list items under the incident.

## 19. Icons

The square stamp is the only symbol, and it is CSS, not an icon font. On a monitor row it shrinks to a 0.7rem square beside the name. The status word is always present. Do not add icon fonts or SVG icon sets.

## 20. Illustrations

None. Empty states are sentences.

## 21. Animations

None on load. `@media (prefers-reduced-motion: reduce)` sets `scroll-behavior: auto`. Do not add entrance motion, pulsing stamps, or hover slides. A hover may change a button’s fill.

## 22. Accessibility

- `lang="en"` on each document
- One `h1`. Sections are `h2`. Incident services and entry names are `h3` where the page already uses them
- The stamp is `role="img"` with an `aria-label` of the headline. The headline is also visible text
- Each component row includes the status word
- Links, fields, and buttons show a 3px focus outline
- Contrast: `--ink` and `--muted` on `--leaf` are the text colors. `--leaf` on `--spine` is button text. Status colors are strips and the stamp
- The page still works with CSS off: title, sentences, lists, and links remain in order
- Do not rely on color alone
- `color-scheme: light` so form controls stay with the page

## 23. Dark mode

Not implemented. A dark theme would have to recheck every pair: ink on leaf, leaf on spine, and white on the three stamp fills. Do not ship a dark theme that only swaps the background.

## 24. Anti-patterns

Forbidden, from `SKILL.md` and from the research:

- Warm cream background with a terracotta accent
- Near-black field with acid green
- Broadsheet hairline newspaper styling
- The previous Harbor daylight look: a cool floating sheet and a circular lamp, which read as an unfinished sketch once the directory and console joined the status page
- Rounded cards, soft shadows, and a grid of equal widgets
- All-caps eyebrow labels
- A single italic or colored word in a headline
- Middle-dot metadata on new copy
- A green pill or a full-width green banner as the identity
- Arrows stuck on links
- Fade or slide on load
- A font requested from a CDN
- An operator navigation bar on the public status page

## 25. Design implementation rules

- Put status and Vision API CSS in `src/status/pageCss.ts`. Vision-only rules live in the `extraCss` string in `src/marketplace/pages.ts`. The production server runs `dist/`, and a loose `.css` file is not copied by `tsc`
- Keep `public/operator/app.css` on the same tokens. The operator shell is a static file
- Escape every piece of page, component, and incident text with `escapeHtml`
- Keep the heading text `Dependencies`
- Keep component display names in the HTML
- Keep the status word inside the badge SVG
- Keep sentences that tests assert. Do not reword them to fit a layout
- Do not change routes, the database, probes, auth, or billing behavior for a visual change
- Do not change the JSON document to satisfy a visual change
- Read this file, `docs/DESIGN_BRIEF.md`, and `docs/DESIGN_DECISIONS.md` before changing these pages

## Wireframe

```
 cloth
 spine │ leaf ─────────────────────────┐
       │ Acme                          │
       │ [stamp]  All clear            │
       │          Acme is responding.  │
       │          Updated 31 Oct UTC   │
       │                               │
       │ Components                    │
       │ ▎ Payments                    │
       │ ▎ Operational                 │
       │ ▎ 100% over 90 days           │
       │                               │
       │ Dependencies                  │
       │   sentence about outside      │
       │   services                    │
       └───────────────────────────────┘
```
