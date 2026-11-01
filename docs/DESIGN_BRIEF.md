# Design brief

This brief is for the public status page of the API reliability monitor. It is not a brief for a marketing site or an operator console.

## Application purpose

The page answers one question for someone who depends on a service: is it working, and if not, what do we already know? The monitor writes the answer from checks. A person may add incident updates, but the page is not a dashboard for configuring monitors.

## Target audience

- A customer or partner who was sent a link, or who embedded the badge, and needs the truth in a few seconds
- An on-call engineer who opens the same page during an incident and needs the component, the reason, and the latest update
- A machine reading the JSON, badge, or Atom feed

They are often anxious, in a hurry, and on a phone. They are not browsing.

## User expectations

People already know status pages. They expect one overall sentence, a list of components, and a short incident history. They expect the words operational, degraded, and down, or plain equivalents. They expect the page to load when other systems are failing, which means no third-party font, no analytics script, and no second request for CSS.

## Primary journeys

1. Open the public URL. Read the headline and the lamp. Stop if the sentence says all clear.
2. If something is wrong, read which component is down or slow, then the newest incident and its updates.
3. If a dependency is listed, understand that an outside service can be unhealthy without the page itself being down.
4. Follow the footer to JSON, the badge, or the feed when a person or a tool needs a machine copy.
5. Open a private page without a key and receive 401. That response is API behavior, not a designed marketing screen.

## Emotional associations

A harbor light, not a product launch. Calm when healthy. Plain and serious when something is down. The page should feel like an instrument that has already looked, not like a brand trying to reassure with decoration.

## Desired experience

The first screen answers the question. The status word is always next to the color. Empty sections say what is absent (`No incidents in the last 14 days`) instead of a bare `None`. The column is a readable measure, left aligned, on a cool paper ground.

## Brand personality

Quiet, specific, and local. The product is self-hosted. The page should look like it belongs to the operator’s service (the page title is theirs) and like the instrument around that title is ours.

## Visual direction

Harbor daylight. Cool tide background, a flat instrument sheet, ink text, and one circular signal lamp. Status colors are dark enough to stand as marks. Words carry the meaning. No card grid, no pill as the identity, no all-caps eyebrows, no soft shadow.

## Accessibility

- WCAG 2.2 AA contrast for text
- Status is never color alone: a sentence and a status word sit beside the lamp, and each component row repeats the word
- `lang="en"`, a viewport meta tag, and a logical heading order
- Visible focus on the footer links
- `prefers-reduced-motion` respected. The page does not animate
- System font stacks so the page still renders if a font vendor is unreachable

## Design opportunities

The lamp can be the one memorable object. Component rows can be a log with a color strip instead of a card. The footer can finally point at the formats the API already serves.

## Design risks

- A green banner that copies hosted status products and says nothing of our own
- White text on a small green pill that fails contrast
- Saying “all clear” when every component is still unknown. The page must say it has not been checked
- Adding an operator UI under the excuse of a design system
- Loading fonts from a CDN that is down during the outage the page exists to explain
