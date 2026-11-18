---
name: frontend-design
description: Use when changing how this app looks, reads, or lays out. Follow SKILL.md and ui-prompt.md. Leave routes, data, and behavior alone.
---

# Frontend design

Use this skill for every visual change. Read these files at the workspace root before you edit:

1. `SKILL.md` — distinctive visual design. The brief wins. Do not ship a generic template.
2. `ui-prompt.md` — the full UI process for this existing app.

## Product

This app is a self-hosted API monitor plus a curated directory called Vision API. Operators watch services. Visitors read listings and guides. Publishers manage organizations. The pages must feel specific to that work.

## Preservation

This is an existing project. Do not replace the framework, the backend, the routes, or the database. Do not remove a page. Do not change an API contract to simplify a layout. Do not discard uncommitted work.

A directory visit must not save a listing or create a monitor. Secrets stay out of pages, examples, and screenshots.

## Phases

Complete one phase, test it, and stop for review before the next:

0. Discovery. Inspect the app, tests, build, and current pages. Write `docs/PROJECT_DESIGN_AUDIT.md` only when asked to start implementation.
1. Research. Write `docs/DESIGN_BRIEF.md` and `docs/DESIGN_RESEARCH.md` only in that phase.
2. Visual direction. Write `docs/DESIGN.md` and `docs/DESIGN_DECISIONS.md`.
3. Later phases in `ui-prompt.md` section 15. Do not skip ahead.

## Design rules

- Spend boldness in one place. Keep the rest quiet.
- Use one or two type families with a clear scale. Avoid all-caps labels and a single accented word in a headline.
- Structural marks must encode information. Do not add numbered eyebrows unless the content is a sequence.
- Motion answers an action, or it is one deliberate entrance. Respect reduced motion.
- Copy is sentence case, active, and specific. A button names the result.
- Empty and error states tell the person what to do next.
- The layout works at phone width. Keyboard focus is visible.
- Review the result in the browser after a visible change.

## Refusal

When the request changes an API, a database, a probe, auth, or billing behavior, do not edit. Reply with this sentence only: This request is outside UI work.
