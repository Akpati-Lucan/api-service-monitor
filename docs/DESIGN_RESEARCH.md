# Design research

Research for the public status page. Observations are what the sources show. Interpretations and recommendations are separate. Nothing here is copied into the page.

## How to read this

| Label | Meaning |
| --- | --- |
| Observation | Seen in the product, its docs, or a published comparison |
| Interpretation | Why that choice likely exists |
| Recommendation | What this project should take or refuse |

## Cachet

| Category | Findings |
| --- | --- |
| Website | Cachet, self-hosted status pages. https://cachethq.io/ and theme docs at https://cachethq.io/docs/v3.x/configuration/theme |
| Industry | Open-source status pages for teams that will not use a hosted vendor |
| Strengths | The public page is the product: components, incidents, maintenance, and a theme an operator can change. Data hooks keep custom themes from breaking the markup |
| Visual identity | A marketing site plus a status page that is mostly a banner and an accent color |
| Typography | Conventional UI sans-serif |
| Colour | Accent variables (`--accent`, `--accent-content`, `--accent-foreground`, `--accent-background`) drive the theme |
| Navigation | The public page is a single scroll. Admin is a separate application |
| User experience | One summary, then components, then incidents. That order matches what visitors already do |
| Inspiration | Keep one summary, a component list, and an incident list. Expose theme as tokens, not as a second app |
| Limitations | Do not copy the marketing line or the banner-and-button chrome. A generic Tailwind admin look is what this page is leaving |

Observation: Cachet is the closest peer because it is self-hosted. Interpretation: operators need the page to survive without Cachet’s cloud. Recommendation: ship HTML and CSS in one response, the way a self-hosted page has to work on a bad day.

## Atlassian Statuspage

| Category | Findings |
| --- | --- |
| Website | https://www.atlassian.com/software/statuspage/features and the reader guide at https://support.atlassian.com/statuspage/docs/read-the-statuspage-user-guide/ |
| Industry | Hosted status communication for larger companies |
| Strengths | A shared vocabulary: components, groups, incident states from investigating through resolved, scheduled maintenance, and subscribers |
| Visual identity | A full-width status banner, then rows. The green “all systems operational” bar is the picture people remember |
| Typography | Product sans-serif |
| Colour | Green, yellow, and red mapped to operational, degraded, and down |
| Navigation | The public page has almost no navigation. Subscribers and the admin live elsewhere |
| User experience | A visitor can stop at the banner. Component uptime and incident history are below for people who need them |
| Inspiration | One sentence for the whole page, then rows. Keep the incident state words this monitor already stores |
| Limitations | Do not copy the Atlassian wordmark, the full-bleed green bar, or the hosted-product chrome. Manual incident editing is their center; this monitor is driven by checks |

Observation: the banner is a convention, not a layout we have to repeat. Interpretation: it works because the first line answers the question. Recommendation: answer in a sentence and a lamp, not in a copied banner.

## Better Stack

| Category | Findings |
| --- | --- |
| Website | Product comparison that describes the status page behavior: https://betterstack.com/community/comparisons/better-stack-vs-statuspage/ |
| Industry | Monitoring that publishes a status page from checks |
| Strengths | The page moves when monitors move. That matches this project |
| Visual identity | Current SaaS marketing: bright product UI, rounded surfaces, soft elevation |
| Typography | Geometric sans |
| Colour | Brand color plus the usual status green and red |
| Navigation | Marketing site navigation is separate from the status page a customer sees |
| User experience | Automatic updates reduce the lie of a page nobody edited |
| Inspiration | Trust the checks. The page should change because a probe failed, which this app already does |
| Limitations | Do not import the marketing site’s rounded cards, gradients, or dashboard density onto a public status page |

## Instatus

| Category | Findings |
| --- | --- |
| Website | Compared at https://betterstack.com/community/comparisons/statuspage-vs-instatus/ and https://www.vibereference.com/cloud-and-hosting/status-page-providers |
| Industry | Fast hosted status pages for smaller teams |
| Strengths | A cheap, quick page. Component order is deliberate. Incident posts can be richer than a single line |
| Visual identity | Startup landing-page styling around a simple status document |
| Typography | Modern sans |
| Colour | Soft neutrals and a status accent |
| Navigation | Minimal on the status page itself |
| User experience | The page is one response and stays readable |
| Inspiration | Keep our page one response. Incident updates should be a short list a person can read, which the data model already has |
| Limitations | Do not copy a startup landing page onto an outage screen |

## GitHub status

| Category | Findings |
| --- | --- |
| Website | https://www.githubstatus.com/ |
| Industry | A large public status page people already trust |
| Strengths | Component groups, a 90-day uptime strip, and incidents in plain language. The page is dull on purpose |
| Visual identity | White page, small status dots, compact rows, almost no brand theater |
| Typography | System-like sans |
| Colour | Green, orange, and red dots beside words |
| Navigation | A single page. Impact and component name are the hierarchy |
| User experience | You can scan many components. The dot is never the only label |
| Inspiration | Words beside the mark. Uptime as a figure, not a decoration. Calm density |
| Limitations | Do not reproduce their component-group chrome or their uptime bars as a signature. Our page has fewer components and should not pretend to be a grid of ninety-day squares |

## Cloudflare status

| Category | Findings |
| --- | --- |
| Website | https://www.cloudflarestatus.com/ |
| Industry | Infrastructure status with many components |
| Strengths | The same overall banner plus rows pattern, built for scale |
| Visual identity | Close to the Statuspage family: banner, then a long component list |
| Typography | Compact sans |
| Colour | Status colors on a light field |
| Navigation | In-page anchors when the list is long |
| User experience | Works when there are dozens of rows. Our pages are short, so anchors would be noise |
| Inspiration | Only that a long list still needs a text label on every row |
| Limitations | Do not add anchor navigation or a dense table for a page that usually has a handful of components |

## Upptime

| Category | Findings |
| --- | --- |
| Website | https://upptime.js.org/ |
| Industry | GitHub-pages status sites generated from a repo |
| Strengths | The page is static and readable if the monitored site is down. Graphs are secondary to the up or down fact |
| Visual identity | Open-source documentation styling, often a README-like page |
| Typography | Default documentation fonts |
| Colour | Green and red summary badges |
| Navigation | A generated site, not an application shell |
| User experience | Honest and cheap to load |
| Inspiration | The page must not depend on the thing it is describing. Inline CSS and system fonts serve that |
| Limitations | Do not make the page look like a repository README |

## Hund

| Category | Findings |
| --- | --- |
| Website | https://hund.io/ |
| Industry | Hosted status pages aimed at European teams |
| Strengths | Public pages stay simple. Incidents and maintenance are first-class |
| Visual identity | Quiet product site, status pages that follow the banner-and-list convention |
| Typography | Neutral sans |
| Colour | Muted UI chrome, saturated status colors |
| Navigation | Status page is one column |
| User experience | Scheduled maintenance is visible before it becomes an incident. This monitor already has maintenance windows in the API; the public page does not yet list them as their own section |
| Inspiration | A later pass can show active maintenance in the same log voice. Not required to invent a new visual system |
| Limitations | Do not copy Hund’s marketing layout |

## What the set agrees on

Observation: every serious status page leads with one overall state, then components, then incidents. Interpretation: visitors arrive with a yes-or-no question. Recommendation: keep that order. Differentiate with the lamp, the left-aligned instrument sheet, the cool paper ground, and sentences instead of a pill.

Observation: status color is always paired with a word on the better pages. Interpretation: color-blind readers and grayscale embeds still need the word. Recommendation: the lamp has no text inside it; the sentence and the row label carry the word. The badge SVG keeps the status word in the image.

Observation: hosted products decorate the marketing site and keep the status page quieter. Interpretation: anxiety is the context. Recommendation: spend the only bold move on the lamp. Leave the rest as a log.
