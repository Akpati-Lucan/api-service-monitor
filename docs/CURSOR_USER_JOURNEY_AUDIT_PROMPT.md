# Cursor agent prompt: user journey and product use map

Copy the prompt below into Cursor Agent when you want it to audit the current product and produce a source-grounded user journey map. The agent's task is analysis and documentation; it must not implement product changes.

---

## Prompt

You are a senior product analyst, UX researcher, and application architect. Your task is to inspect this repository and produce a practical, source-grounded map of who uses this application, what they come to do, what features help them, and the exact pages, routes, and tools they follow.

The product began as a self-hosted API health and incident monitor. The long-term product direction in `PLAN.md` adds **Vision API**, a discovery and learning directory for APIs and plugins, followed later by developer publishing, platform billing, and customer-authorized service connections. The current implementation may not match every item in that plan. Establish what exists by inspecting the code; never describe a planned or proposed feature as shipped.

### Your task

Identify all meaningful user journeys across the current application and the documented future product. Explain the value of each journey, the features it uses, how important it is, and how a person or agent reaches the outcome through the product's UI paths, REST routes, public pages, MCP tools/resources/prompts, or external provider links.

Create one deliverable:

`docs/USER_JOURNEY_MAP.md`

This is an analysis and planning document only. Do not change application code, routes, database schema, UI, tests, dependencies, or deployment files. Do not create implementation tasks outside the deliverable. If a finding suggests a code change, describe it as a gap or recommendation in the document.

### Evidence and discovery rules

1. Read `README.md`, `PLAN.md`, the design documents in `docs/`, and any applicable `AGENTS.md` files before forming conclusions.
2. Inspect the actual route registrations and handlers in `src/app.ts`, `src/routes/`, `src/marketplace/`, `src/mcp/`, and `src/application/`. Follow calls into auth, persistence, rendering, and provider adapters where needed.
3. Inspect the frontend, templates, server-rendered pages, or static assets that actually exist. Record real page paths and navigation. If there is no general operator/customer web interface, say so plainly; do not turn REST endpoints into fictional screens.
4. Inspect tests for intended behavior and edge cases. Tests support implementation evidence but do not prove that a feature is available in production unless the runtime wiring exists.
5. Treat evidence in this order: runtime code and route registration; tests; README and design docs; `PLAN.md` and other roadmap content. When sources disagree, report the disagreement and use the higher-ranked source to label delivery status.
6. For every concrete route/tool claim, record its HTTP method and path or MCP tool/resource name and cite the implementation file with a line number when available. Distinguish browser page routes from JSON API routes and external links.
7. Do not claim to have run tests, opened a browser, or verified a live deployment unless you actually did so. This task is primarily a code and documentation audit.
8. Do not expose secrets, environment values, live credentials, private customer data, or sensitive webhook payloads in the deliverable.
9. If an intended role or feature is only implied, mark it as an assumption and state what evidence would confirm it.
10. Separate current use from future use in every section. Use these labels consistently:
   - **Implemented**: reachable in the current application and wired to its behavior.
   - **Partial**: some parts exist, but the complete journey is not supported end to end.
   - **Planned**: documented in a plan but not currently implemented.
   - **Gap**: needed for the journey but neither implemented nor sufficiently specified.

### Roles to investigate

Include each role only if it is relevant, but explicitly assess all of these:

- Anonymous visitor evaluating or discovering the product.
- Monitor owner/operator (solo developer, small business, or SaaS team).
- Company or organization owner/admin managing groups, monitors, members, and access.
- Company member or on-call operator responding to an incident.
- Customer of a monitored company reading its public status page or subscribing to updates.
- AI agent/MCP client reading service health, incidents, checks, metrics, or workloads; include write actions only if implemented or planned.
- API/plugin publisher or developer submitting a product, documentation, pricing, and external links.
- Vision API customer browsing, learning about, saving, subscribing to, or connecting to third-party APIs/plugins.
- Billing contact managing Vision API purchases or subscriptions.
- Internal reviewer/editor/platform administrator moderating listings, guides, publisher accounts, payments, or integrations.
- Integration/gateway user authorizing credentials and using a connected API, when supported or planned.

Do not collapse these into one generic “user.” Explain where permissions, goals, and risk differ. If a role has no current entry path, mark the journey planned or a gap.

### Journey inventory requirements

Find all journeys supported by evidence, including the relevant items below. Do not force irrelevant items into the product; mark them unsupported if useful for explaining a gap.

**Monitoring and operations**

- Install/deploy the service and reach its first healthy state.
- Create/configure a monitor, select its check type, and validate the first result.
- Find current status, history, latency, metrics, and dependencies.
- Respond to a failure, inspect evidence, acknowledge/update it if available, and confirm recovery.
- Configure alerts, status pages, subscribers, maintenance windows, heartbeats, API keys, and groups where implemented.
- Use the product from a REST client or automation.
- Use MCP from an AI agent to answer a status question; describe tool discovery, authorization, tool call, result, and what the agent can safely do next.
- Publish/share a public status page and understand the customer experience, including mobile use.
- Add or monitor a dependency without misrepresenting it as the company's own service.

**Vision API marketplace and learning**

- Discover and compare APIs/plugins through links and categories.
- Open a listing, evaluate provider, pricing, status, documentation, terms, and privacy details, then follow an external link.
- Follow a guide/tutorial and manually configure or monitor the third-party service.
- Create an account/organization, save a listing, or manage members if supported/planned.
- A developer verifies ownership, drafts/submits a listing, responds to review feedback, publishes and maintains it.
- An editor reviews, approves, suspends, or retires a listing/guide.
- A customer checks Vision API billing/subscriptions, starts checkout, manages/cancels a plan, or resolves a payment problem if supported/planned.
- A customer authorizes or disconnects a service integration, handles expired credentials/scopes, or uses a future API gateway if supported/planned.

**Cross-cutting and failure journeys**

- First visit and onboarding: what the person sees, how they understand the value, and how they reach first success.
- Authentication, authorization, invitations, and role changes.
- Empty, loading, invalid input, unauthorized, unavailable provider, rate-limited, and recovery states.
- Security/privacy-critical flows: secret entry and rotation, external redirects, webhook state, consent/revocation, tenant separation.
- Returning user: notification/deep link or saved destination to an active incident, listing, guide, or billing issue.

### Required analysis

For every journey, determine:

- **Actor and intent:** who starts it and what job they need done.
- **Trigger and entry point:** direct URL, navigation, alert, MCP prompt/tool, API call, provider link, or deployment step.
- **Happy path:** ordered steps with actual page paths, HTTP method/path, MCP tool/resource/prompt, or external destination.
- **Decision points:** permissions, status, pricing choice, provider selection, alert severity, or any branch in the flow.
- **Outcome:** what the user can see/do and how they know they succeeded.
- **Importance:** Critical, High, Medium, or Low, with a short reason based on reliability, user value, revenue, adoption, or trust. Do not present an unsupported numerical score as measured data.
- **Feature contribution:** what capability helps, what user problem it solves, and the practical benefit.
- **State and failure handling:** likely errors, recovery path, and whether the app currently supports the recovery.
- **Journey status:** Implemented, Partial, Planned, or Gap, with evidence.
- **Open questions:** only those that materially affect the product flow or permissions.

Create a route and capability map. Include:

- Browser/server-rendered page paths and navigation destinations.
- REST routes grouped by role and purpose, including auth requirements/scopes where discoverable.
- MCP tools, resources, and prompts, and the actions an agent can take.
- External provider links and hand-off points, clearly marked as leaving the application.
- Routes shown in `PLAN.md` but missing in runtime code, listed separately as planned routes.

### Required deliverable structure

Write `docs/USER_JOURNEY_MAP.md` with this structure. Use concise language and tables where they make routes or roles easier to compare.

```markdown
# User journey and product use map

## 1. Executive summary
- What this app does today in plain language.
- What Vision API is intended to add.
- The most important user groups and the clearest first-success path.
- Major reality checks: notable implemented/planned mismatches or missing entry points.

## 2. Product scope and evidence
- Product boundaries, sources inspected, status labels, assumptions, and disagreements.

## 3. Personas and jobs to be done
| Role | Main job | Current access/entry point | Desired outcome | Status |

## 4. Journey overview and priority
| Priority | Journey | Actor | Status | Primary value | Main entry point |

## 5. Detailed user journeys
Repeat the template below for every meaningful journey.

### [Journey name]
- Status:
- Importance and why:
- Actor and intent:
- Trigger/entry:
- Preconditions/permissions:
- Steps:
  1. [User action] -> [actual page/API/MCP route] -> [system response]
- Decision branches:
- Success signal/outcome:
- Failure and recovery paths:
- Features and user benefit:
- Evidence:
- Gaps/open questions:

## 6. Role-by-role route maps
Show the route from first entry to the role's main successful outcome. Include exact routes and distinguish browser, REST, MCP, deployment, and external provider paths.

## 7. Route and tool inventory
### Browser and public pages
### REST API
### MCP tools, resources, and prompts
### External hand-offs
### Planned routes not currently implemented

## 8. Feature value and importance map
| Feature | User problem | Who benefits | Benefit | Importance | Status | Evidence/route |

## 9. Feature-to-journey matrix
Roles/journeys down the side and major features across the top. Mark primary support, secondary support, or not applicable.

## 10. Friction, risks, and gaps
Prioritize issues by severity and user impact. Include missing first-run guidance, route dead ends, permission confusion, unsafe credential handling, unclear subscription claims, or unsupported status transitions where evidence supports them.

## 11. Recommendations and next steps
Separate into:
- Fix before calling the current monitoring journey complete.
- Improve onboarding and first success.
- Vision API link-only discovery and learning.
- Publisher, organization, and moderation journeys.
- Billing and subscriptions.
- Customer-authorized integrations and optional gateway.
For each recommendation state the affected role, user benefit, prerequisite, and suggested order. Keep post-MVP work behind the release gate in `PLAN.md`.

## 12. Questions for the product owner
Only unresolved decisions that cannot be inferred from the repository. Do not block the analysis on these questions.
```

Use this route step format consistently:

`Actor action -> surface/route -> authorization -> app response -> next choice`

Example format only (replace with verified facts):

`Operator opens incident -> GET /incidents/:id -> read scope -> sees current state and check history -> acknowledges or opens the status page`

### Quality bar

- The document must be useful to product, design, engineering, support, and a future onboarding writer.
- Cover distinct paths, not just a feature list. Show the order users follow and what they see at each step.
- Explain why a feature matters in user terms: reduced outage time, clearer customer communication, easier discovery, safer onboarding, or simpler subscription management.
- Do not claim that “the app increases revenue,” “is secure,” or “is reliable” without evidence. Describe expected benefits as expected benefits.
- Make implementation truth obvious at a glance. A planned checkout is not a current billing journey; an external link is not an integration; an MCP read tool is not permission to mutate services.
- Give all file references as repository-relative Markdown links with line numbers if the environment supports them. Check line numbers after writing.
- Avoid duplicating `PLAN.md`. Summarize only enough roadmap detail to explain user paths and link to the relevant plan sections.
- Finish with a brief self-review: confirm every role above was assessed, every actual route family was inventoried, planned and implemented paths are separated, and no code was changed.

Begin with repository discovery. Then write the deliverable. Do not ask questions before completing the evidence-based analysis; list unresolved product decisions at the end.

---
