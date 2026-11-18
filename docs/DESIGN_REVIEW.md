# Design review

Reviewed 31 October 2026 in the browser against the running app, after the status page was restyled. Viewports: the wide browser panel, and a 390×844 layout viewport (measured `innerWidth` 390, sheet width 390, side borders 0, padding 16px).

Pages opened:

- `http://localhost:3000/status/baseline` — operational, one component, empty dependencies and incidents
- `http://localhost:3000/status/signal` — page down, owned component down, dependency operational, one open incident
- `http://localhost:3000/status/baseline.json` — JSON document, no extra design fields
- `http://localhost:3000/status/baseline/badge.svg` — SVG containing the word operational

## Answers

1. Purpose. The first screen says whether the service is up. On the down page the lamp is dark red and the sentence is “Something we run is down.”
2. Identity. Cool paper, flat sheet, square corners, no shadow, one lamp. It does not use the green banner from hosted status products.
3. Hierarchy. Title, then the sentence, then components, dependencies, incidents, then the three links. Headings are h1, h2, h3.
4. Layout. One left-aligned column. On a phone the sheet meets the edges.
5. Type. Title and headline use the Palatino stack. Body uses Segoe UI / Avenir Next. Computed title size on the wide view was 38.4px.
6. Color. Green, red, and the dependency’s green strip are marks. The words Operational, Down, and the headline sit in ink or muted ink.
7. Components. Both lists use the same row. The incident uses the article pattern.
8. Clutter. No icons, no cards, no extra navigation. The dependency sentence is the longest supporting line and it earns its place.
9. Template check. Not a centered pill on white, not a rounded card grid, not cream and terracotta.
10. Mobile. At 390px the sheet is full width, the lamp stays beside the sentence, and the footer links remain on one line in the accessibility tree.
11. Access. Contrast measured against the sheet: ink 14.68:1, muted text 11.57:1, link blue 5.86:1. Badge white on the three fills: 6.51, 5.93, and 8.96. The lamp has an accessible name and the headline is visible text.
12. Interaction. The JSON link navigates to the document. The badge link returns the SVG. Footer links are real anchors.

## Issues

| Severity | Issue | Result |
| --- | --- | --- |
| High | None left open | |
| Medium | The first incident render stacked the raw words “Open” and “investigating,” which read like debug labels | Fixed. The line is now “This incident is open. Latest state: Investigating.” Confirmed in the browser |
| Low | Degraded, and a page where every component is still unknown, were not opened as live pages | Copy and lamp classes exist. Not a layout defect |
| Low | Opening the badge SVG directly shows a small label on the browser’s default dark canvas | Expected. The badge is an embed. The word is in the image |
| Low | Active maintenance windows are not on the page | The API stores them. A later pass can add one log section. Not part of this page’s current data render |

## Contrast record

| Pair | Ratio |
| --- | --- |
| `#102833` on `#F7FBFC` | 14.68 |
| `#1C3A46` on `#F7FBFC` | 11.57 |
| `#0A6A8A` on `#F7FBFC` | 5.86 |
| `#FFFFFF` on `#0C6B4D` | 6.51 |
| `#FFFFFF` on `#8A5A00` | 5.93 |
| `#FFFFFF` on `#8E1D1D` | 8.96 |

## Field register, 17 November 2026

Reviewed against the source after Harbor daylight was replaced. A browser screenshot was not available in this session. Contrast below is calculated for the new pairs. `npm test` and `npm run build` are the functional check.

1. Purpose. The status page still opens on a stamp and a sentence. Directory, account, billing, collections, and connections keep their existing sentences and forms.
2. Identity. Cloth `#D5DDD0`, leaf `#F6F7F2`, spine `#1E3A2F`, square stamp. Not the cool floating sheet and not a card grid.
3. Hierarchy. One h1, then navigation on the app pages, then the task. Status order is unchanged.
4. Layout. The page is left-bound to a 16px spine. Under 640px the spine becomes a 10px top band and the page meets the side edges.
5. Type. Rockwell (slab) for titles and the status headline. Candara for reading and forms. Cascadia Mono only inside examples.
6. Color. Status colors are the stamp and the row strip. Links are `#1A4E86`, separate from operational green. Buttons are leaf text on the spine.
7. Components. Rows, ruled entries, and the stamp share one system. The class `card` is still a ruled entry, not a shadowed box.
8. Clutter. No icon set, no load animation, no second palette.
9. Template check. Not cream and terracotta, not acid green on black, not a rounded SaaS grid, not the rejected Harbor sheet.
10. Mobile. One breakpoint. Navigation wraps. The stamp shrinks to 3rem.
11. Access. Focus outline is 3px `#1A4E86`. The stamp keeps its accessible name. Calculated contrast, leaf `#F6F7F2` underneath unless noted:

| Pair | Ratio |
| --- | --- |
| `#172117` on `#F6F7F2` | 15.40 |
| `#3A463C` on `#F6F7F2` | 9.20 |
| `#1A4E86` on `#F6F7F2` | 7.87 |
| `#F6F7F2` on `#1E3A2F` | 11.46 |
| `#FFFFFF` on `#0E6B45` | 6.55 |
| `#FFFFFF` on `#8A5300` | 6.33 |
| `#FFFFFF` on `#8E2D28` | 8.22 |

12. Interaction. Routes, forms, and button names are unchanged. The current navigation item is an underline, not a new destination.
