export const statusPageCss = `
:root {
  --ink: #102833;
  --muted: #1c3a46;
  --paper: #e4eef2;
  --sheet: #f7fbfc;
  --line: #c5d6de;
  --clear: #0c6b4d;
  --slow: #8a5a00;
  --down: #8e1d1d;
  --unknown: #4e616b;
  --focus: #0a6a8a;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
  --space-6: 64px;
  --measure: 36rem;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  font-size: 1.05rem;
  line-height: 1.5;
}

main {
  max-width: var(--measure);
  margin: var(--space-6) 0 var(--space-6) max(24px, 8vw);
  padding: var(--space-6) var(--space-4) var(--space-5);
  background: var(--sheet);
  border: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}

h1, h2, h3, p { margin: 0; }

h1 {
  font-family: "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-size: 2.4rem;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

h2 {
  font-family: "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-size: 1.45rem;
  font-weight: 600;
  line-height: 1.25;
  margin-top: var(--space-6);
}

.signal {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.lamp {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 50%;
  flex: none;
  background: var(--clear);
}

.lamp-degraded { background: var(--slow); }
.lamp-down { background: var(--down); }
.lamp-unknown { background: var(--unknown); }

.headline {
  font-family: "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-size: 1.7rem;
  line-height: 1.2;
}

.detail, .updated, .note, .state, .uptime, footer p {
  color: var(--muted);
  margin-top: var(--space-2);
}

.rows { list-style: none; padding: 0; margin: var(--space-4) 0 0; }

.row {
  padding: var(--space-3) 0 var(--space-3) var(--space-3);
  border-left: 6px solid var(--unknown);
}

.row + .row { margin-top: var(--space-2); }

.row-operational { border-left-color: var(--clear); }
.row-degraded { border-left-color: var(--slow); }
.row-down { border-left-color: var(--down); }
.row-unknown { border-left-color: var(--unknown); }

.name { font-size: 1.15rem; }

.incident { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line); }
.incident h3 { font-size: 1.15rem; }
.incident ul { margin: var(--space-2) 0 0; padding-left: 1.1rem; }

footer { margin-top: var(--space-6); }

a { color: var(--focus); text-underline-offset: 3px; }

a:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

@media (max-width: 640px) {
  main {
    margin: 0;
    padding: var(--space-4) var(--space-3) var(--space-5);
    border-left: 0;
    border-right: 0;
  }
  h1 { font-size: 2rem; }
  .signal { align-items: flex-start; }
  .lamp { width: 3rem; height: 3rem; margin-top: var(--space-1); }
}

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto; }
}
`;
