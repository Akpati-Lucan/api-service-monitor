export const statusPageCss = `
:root {
  --ink: #172117;
  --muted: #3a463c;
  --cloth: #d5ddd0;
  --leaf: #f6f7f2;
  --spine: #1e3a2f;
  --rule: #c5cfc0;
  --clear: #0e6b45;
  --slow: #8a5300;
  --down: #8e2d28;
  --unknown: #5a655c;
  --focus: #1a4e86;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
  --space-6: 64px;
  --measure: 44rem;
  color-scheme: light;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--spine);
  color: var(--ink);
  overflow-wrap: break-word;
  font-family: Candara, "Segoe UI", "Avenir Next", "Liberation Sans", sans-serif;
  font-size: 1.0625rem;
  line-height: 1.55;
}

main {
  max-width: none;
  min-height: 100vh;
  margin: 0 0 0 16px;
  padding: var(--space-6) max(var(--space-5), calc(100vw - 16px - var(--measure) - var(--space-5))) var(--space-6) var(--space-5);
  background: var(--leaf);
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

h1, h2, h3 {
  margin: 0;
  font-family: Rockwell, "Rockwell Nova", "American Typewriter", "Nimbus Roman", serif;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.15;
}

h1 { font-size: 2.5rem; }

h2 {
  font-size: 1.5rem;
  line-height: 1.25;
  margin-top: var(--space-6);
}

h3 { font-size: 1.2rem; line-height: 1.3; }

p { margin: var(--space-3) 0 0; }

nav {
  display: block;
  margin-top: var(--space-4);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--rule);
}

nav a {
  display: inline-block;
  margin: 0 var(--space-4) var(--space-2) 0;
  color: var(--ink);
  text-decoration: none;
  padding-bottom: 2px;
}

nav a:hover { color: var(--focus); }

nav a[aria-current="page"] {
  color: var(--ink);
  box-shadow: inset 0 -3px 0 var(--spine);
}

.signal {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.lamp {
  width: 4.75rem;
  height: 4.75rem;
  margin-top: 0.15rem;
  border-radius: 0;
  flex: none;
  background: var(--clear);
}

.lamp-degraded { background: var(--slow); }
.lamp-down { background: var(--down); }
.lamp-unknown { background: var(--unknown); }

.headline {
  margin: 0;
  font-family: Rockwell, "Rockwell Nova", "American Typewriter", "Nimbus Roman", serif;
  font-size: 1.85rem;
  font-weight: 700;
  line-height: 1.15;
}

.detail, .updated, .note, .state, .uptime, .meta, footer p { margin-top: var(--space-2); }

.detail, .updated, .note, .state, .uptime, .meta { color: var(--muted); }

.lede { max-width: 38rem; font-size: 1.125rem; line-height: 1.45; }

.rows { list-style: none; padding: 0; margin: var(--space-4) 0 0; }

.row {
  padding: var(--space-3) 0 var(--space-3) var(--space-3);
  border-left: 6px solid var(--unknown);
  border-bottom: 1px solid var(--rule);
}

.row + .row { margin-top: 0; }

.row-operational { border-left-color: var(--clear); }
.row-degraded { border-left-color: var(--slow); }
.row-down { border-left-color: var(--down); }
.row-unknown { border-left-color: var(--unknown); }

.row p { margin-top: var(--space-2); }
.row .name, .row h3 { margin-top: 0; }
.name { font-size: 1.15rem; }

.incident { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--rule); }
.incident h3 { font-size: 1.15rem; }
.incident ul { margin: var(--space-2) 0 0; padding-left: 1.15rem; }

ul { margin: var(--space-3) 0 0; padding-left: 1.15rem; }
li + li { margin-top: var(--space-2); }

footer {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule);
}

form { margin-top: var(--space-4); }

label { display: block; margin-top: var(--space-3); }

input, select, textarea, button {
  font: inherit;
  color: var(--ink);
  border-radius: 0;
}

input, select, textarea {
  display: block;
  width: 100%;
  max-width: 28rem;
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--leaf);
  border: 1px solid var(--spine);
}

input[type="hidden"] { display: none; }

input[type="checkbox"], input[type="radio"] {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  max-width: none;
  margin: 0 var(--space-2) 0 0;
  vertical-align: -2px;
}

textarea { min-height: 8rem; }

button {
  margin-top: var(--space-3);
  padding: 0.55rem 1rem;
  background: var(--spine);
  color: var(--leaf);
  border: 1px solid var(--spine);
  cursor: pointer;
}

button:hover { background: #15281f; }

::placeholder { color: var(--muted); }

a { color: var(--focus); text-underline-offset: 3px; }

a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

::selection { background: #c5d4c8; color: var(--ink); }

@media (max-width: 640px) {
  body { background: linear-gradient(180deg, var(--spine) 0 10px, var(--leaf) 10px); }
  main {
    margin: 10px 0 0;
    min-height: calc(100vh - 10px);
    padding: var(--space-4) var(--space-3) var(--space-5);
  }
  h1 { font-size: 2rem; }
  .headline { font-size: 1.5rem; }
  .lamp { width: 3rem; height: 3rem; }
  input, select, textarea { max-width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto; }
}
`;
