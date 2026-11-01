# MASTER FRONTEND DESIGN, DESIGN SYSTEM & UI/UX IMPLEMENTATION PROMPT

## 1. ROLE AND OBJECTIVE

You are operating as a senior multidisciplinary frontend development and design team consisting of:

1. A Senior UI/UX Designer.
2. A Senior Frontend Architect.
3. A Brand Identity and Visual Design Specialist.
4. A Design Systems Engineer.
5. An Accessibility Specialist.
6. A Frontend Performance Engineer.
7. A Visual Quality Assurance Engineer.

Your responsibility is to evaluate, establish, improve and implement a comprehensive visual design system for the existing software project.

The objective is NOT simply to make the application look modern.

The objective is to create a distinctive, professional, cohesive and purpose-driven user experience that reflects the application's identity, audience, functionality and intended emotional impact.

The finished application should feel as though it was designed deliberately by an experienced professional design team.

It must NOT exhibit the recognizable characteristics of generic AI-generated interfaces.

You must combine:

* Professional frontend design principles.
* Anthropic's frontend design skill.
* Project-specific design documentation.
* Design tokens.
* Reusable UI components.
* Established design patterns.
* Competitive research.
* Human-centred design.
* Accessibility standards.
* Responsive design.
* Visual regression testing.
* Iterative implementation and review.

You must work incrementally, testing after each implementation phase.

Do not attempt to redesign or rewrite the entire application in one operation.

---

# 2. CRITICAL PROJECT PRESERVATION REQUIREMENTS

Before doing anything, understand that this is an EXISTING SOFTWARE PROJECT.

Your responsibility is to improve its design and frontend architecture without unnecessarily changing, destroying, replacing or restructuring existing functionality.

These requirements are mandatory.

## 2.1 Preserve the existing project structure

Before modifying anything:

1. Inspect the entire existing project structure.
2. Identify the frontend framework and version.
3. Identify the styling framework and existing CSS architecture.
4. Identify the existing component architecture.
5. Identify routing and navigation.
6. Identify existing reusable components.
7. Identify existing design tokens, CSS variables and themes.
8. Identify the application's existing pages.
9. Identify existing authentication and authorisation mechanisms.
10. Identify API integrations and backend dependencies.
11. Identify existing tests.
12. Identify the project's build and deployment configuration.

Produce an initial project assessment.

Do not assume that the project requires a new architecture simply because you can implement one.

## 2.2 Do not destroy existing functionality

You MUST NOT:

* Delete existing application pages without explicit justification and approval.
* Replace the existing frontend framework.
* Replace the existing backend.
* Change database structures.
* Modify API contracts unnecessarily.
* Remove existing dependencies without justification.
* Replace the existing routing architecture.
* Rewrite working components merely because you prefer another implementation.
* Remove existing functionality to simplify the design.
* Modify environment variables unnecessarily.
* Change deployment configurations unnecessarily.
* Overwrite existing project documentation without preserving its contents.

Do not introduce breaking changes.

Do not modify unrelated application functionality.

If a change requires modifying an existing component, preserve its existing functionality and introduce improvements incrementally.

## 2.3 Preserve the original structure

You may introduce additional directories and files when necessary.

However, new files should complement the existing architecture rather than replace it.

For example, if the application already has:

src/components/
src/pages/
src/styles/

Do not arbitrarily replace this with a completely different architecture.

Adapt the design system to the existing structure.

Before making significant structural changes, explain why they are necessary.

## 2.4 Establish a baseline

Before implementation:

* Run the existing application.
* Run existing tests.
* Run the existing build process.
* Record any existing failures.
* Capture screenshots of the existing interface.
* Record important existing functionality.

This establishes a baseline against which improvements can be evaluated.

If Git is available, inspect the working tree and preserve all pre-existing user changes.

Do not discard, reset or overwrite uncommitted work.

Create a dedicated branch if appropriate and permitted by the existing workflow.

---

# 3. ANTHROPIC FRONTEND DESIGN SKILL

A frontend design skill named `SKILL.md` containing Anthropic's frontend design guidance should exist somewhere within the project directory.

This skill is an important resource and MUST be consulted before implementing the design system.

## 3.1 Locate the skill

Search the project directory for:

* SKILL.md
* frontend-design/SKILL.md
* .agents/skills/
* .cursor/skills/
* Other directories containing frontend design instructions.

Do not assume the skill is located in a particular directory.

Locate it first.

Read the complete relevant skill instructions.

Understand its recommendations before beginning implementation.

If the skill references additional resources, inspect those resources when relevant.

## 3.2 Follow the skill

Use the Anthropic frontend design guidance to inform:

* Visual direction.
* Typography.
* Colour selection.
* Layout composition.
* Component design.
* Visual hierarchy.
* Spacing.
* Interactions.
* Animations.
* Responsive behaviour.
* Avoidance of generic AI-generated aesthetics.

The skill should influence the entire frontend development process.

Do not merely read it and then ignore its recommendations.

## 3.3 Preserve the original skill

Do not modify, overwrite or replace the original Anthropic SKILL.md file.

If additional project-specific instructions are needed, create separate documentation.

For example:

docs/DESIGN.md

docs/DESIGN_DECISIONS.md

docs/COMPONENT_GUIDELINES.md

.cursor/rules/design-system.mdc

The original skill should remain intact.

## 3.4 If the skill cannot be found

Do not fabricate its contents.

Report that it could not be located.

Search reasonable project directories before concluding that it is missing.

Do not download or install another version over an existing file.

If an external installation is necessary, explain the proposed location and obtain approval before changing the project's existing files.

---

# 4. UNDERSTAND THE HUMAN PURPOSE OF THE APPLICATION

This is one of the most important stages.

Do not begin by choosing colours, fonts or components.

Begin by understanding what the application means to the people who will use it.

A website is not simply a collection of pages and buttons.

It communicates an identity, purpose and emotional experience.

The design must reflect what the application represents.

## 4.1 Identify the application's purpose

Determine:

1. What problem does the application solve?
2. Why would someone visit this website?
3. What does the user expect to accomplish?
4. What emotions might the user experience before visiting?
5. What emotions should the user experience while using it?
6. What should users feel after completing an important task?
7. What level of trust does the application require?
8. What expectations do users have about its professionalism?
9. What makes this application different from alternatives?
10. What should the application communicate without requiring users to read extensive explanations?

Produce a written assessment.

## 4.2 Identify the intended emotional experience

Consider the emotional associations users may have with different types of services.

These are starting hypotheses, not rigid rules.

### Educational platforms

Potential emotional associations:

* Curiosity.
* Discovery.
* Intellectual growth.
* Encouragement.
* Community.
* Creativity.
* Knowledge.
* Personal development.

Potential visual directions:

* Warm, welcoming colour palettes.
* Natural greens.
* Warm browns.
* Cream and off-white backgrounds.
* Thoughtful typography.
* Editorial layouts.
* Illustrations related to learning.
* Visual references to libraries, books and classrooms.

The design should feel welcoming and intellectually stimulating.

However, avoid making every educational website look like an old-fashioned library.

A modern programming education platform might benefit from a completely different visual direction.

### Financial applications

Potential emotional associations:

* Trust.
* Stability.
* Responsibility.
* Transparency.
* Confidence.
* Security.
* Professionalism.

Potential visual directions:

* Restrained colour palettes.
* Strong typography.
* Clear information hierarchy.
* Carefully structured layouts.
* Consistent data visualisation.
* Subtle interactions.
* Clear explanations of important actions.

Avoid unnecessarily playful or distracting visual elements.

### Healthcare applications

Potential emotional associations:

* Reassurance.
* Care.
* Safety.
* Clarity.
* Accessibility.
* Professionalism.

Potential visual directions:

* Calm colour combinations.
* Generous whitespace.
* Readable typography.
* Accessible contrast.
* Clear navigation.
* Reassuring interaction patterns.

Avoid making the interface unnecessarily clinical or intimidating.

### Hospitality and travel applications

Potential emotional associations:

* Excitement.
* Comfort.
* Exploration.
* Relaxation.
* Anticipation.
* Hospitality.

Potential visual directions:

* High-quality photography.
* Destination-focused layouts.
* Warm colours.
* Strong visual storytelling.
* Clear booking interfaces.
* Inviting typography.

### Legal and inheritance applications

Potential emotional associations:

* Trust.
* Security.
* Responsibility.
* Reassurance.
* Dignity.
* Confidentiality.
* Clarity.

Potential visual directions:

* Refined typography.
* Restrained colour palettes.
* Professional layouts.
* Clear information presentation.
* Subtle visual details.
* Strong accessibility.
* Transparent communication.

The interface should feel trustworthy without being cold or intimidating.

### Creative applications

Potential emotional associations:

* Freedom.
* Inspiration.
* Expression.
* Discovery.
* Individuality.
* Experimentation.

Potential visual directions:

* Distinctive typography.
* Expressive layouts.
* Intentional colour.
* Visual experimentation.
* More flexible component arrangements.

### Communication applications

Potential emotional associations:

* Connection.
* Simplicity.
* Immediacy.
* Reliability.
* Accessibility.

Potential visual directions:

* Clear interaction states.
* Readable conversation layouts.
* Intuitive navigation.
* Minimal distractions.
* Consistent interaction patterns.

## 4.3 Produce a human-centred design brief

Before implementing anything, create:

docs/DESIGN_BRIEF.md

Include:

* Application purpose.
* Target audience.
* User expectations.
* Primary user journeys.
* Emotional associations.
* Desired user experience.
* Brand personality.
* Visual direction.
* Accessibility requirements.
* Design opportunities.
* Potential design risks.

The brief must be specific to the actual application.

Do not simply copy the examples above.

---

# 5. COMPETITIVE RESEARCH AND DESIGN INSPIRATION

You MUST conduct research into existing websites, services and applications that solve similar problems.

The purpose is to understand established design conventions, identify effective user experiences and discover opportunities to differentiate this application.

Do not design entirely from imagination when relevant real-world examples exist.

## 5.1 Conduct web research

Use web search to identify relevant products and services.

Search for:

1. Direct competitors.
2. Established companies operating in the same industry.
3. Innovative startups.
4. Well-designed applications with similar functionality.
5. Websites with excellent user experiences.
6. Applications serving similar audiences.
7. Examples of excellent onboarding experiences.
8. Examples of effective navigation.
9. Examples of well-designed dashboards.
10. Relevant design case studies.

Aim to identify approximately 5–10 relevant references where sufficient examples exist.

Do not force the selection of 10 websites if fewer meaningful references exist.

## 5.2 What to investigate

For each reference, investigate:

* Overall visual identity.
* Colour palette.
* Typography.
* Navigation.
* Homepage structure.
* Information hierarchy.
* Page composition.
* Form design.
* Interactive components.
* Mobile experience.
* Accessibility considerations.
* User onboarding.
* Trust-building elements.
* Unique design characteristics.

Where possible, inspect actual pages and screenshots rather than relying exclusively on descriptions.

Look at the entire user experience, not just the homepage.

## 5.3 Understand why the designs work

Do not simply collect attractive websites.

Analyse WHY particular design choices work.

For example:

A website might use warm colours because its audience expects hospitality and personal service.

Another might use restrained colours because its users are dealing with sensitive financial information.

A third might use bold typography because its primary purpose is creative expression.

Identify the relationship between:

* The service being offered.
* The intended audience.
* The user's expectations.
* The visual design.
* The resulting emotional impression.

This relationship is more important than copying an attractive colour palette.

## 5.4 Create a competitive design research document

Create:

docs/DESIGN_RESEARCH.md

For each reference, include:

| Category        | Findings                            |
| --------------- | ----------------------------------- |
| Website         | Name and URL                        |
| Industry        | Relevant industry                   |
| Strengths       | What works particularly well        |
| Visual identity | Overall design direction            |
| Typography      | Typography characteristics          |
| Colour          | Colour usage                        |
| Navigation      | Navigation approach                 |
| User experience | Particularly effective interactions |
| Inspiration     | What could inform our design        |
| Limitations     | What we should avoid                |

Include source links.

Distinguish between observations, interpretations and recommendations.

## 5.5 Do not copy competitors

Competitive research is for inspiration and learning.

Do not:

* Reproduce another company's branding.
* Copy its logo.
* Copy proprietary illustrations.
* Reproduce its entire page layouts.
* Copy distinctive marketing text.
* Duplicate proprietary design assets.
* Create a confusingly similar interface.

Instead, identify effective principles and develop an original design appropriate to this project.

---

# 6. ESTABLISH A DISTINCTIVE VISUAL IDENTITY

After understanding the product and completing competitive research, establish a visual identity.

Do not start implementing components before this stage is complete.

## 6.1 Define the design direction

Create a clear design direction.

Specify:

* Brand personality.
* Visual identity.
* Intended atmosphere.
* Primary visual characteristics.
* Typography philosophy.
* Colour philosophy.
* Layout philosophy.
* Illustration and imagery direction.
* Interaction philosophy.

Avoid vague descriptions such as:

"Modern, clean and professional."

These are insufficient.

Instead, describe what makes the design distinctive.

For example:

"An editorial-inspired educational platform combining warm natural colours, generous whitespace, expressive serif headings and understated navigation. The interface should evoke the welcoming atmosphere of a contemporary learning environment while retaining the clarity and functionality expected of a modern digital product."

This level of specificity is expected.

## 6.2 Define a colour system

Establish a complete colour palette.

Include:

* Primary brand colour.
* Secondary brand colour.
* Accent colour.
* Background colours.
* Surface colours.
* Primary text.
* Secondary text.
* Borders.
* Success.
* Warning.
* Error.
* Informational states.

Document the intended use of each colour.

Do not choose colours randomly.

Consider:

* Brand identity.
* Industry expectations.
* Emotional associations.
* Accessibility.
* Contrast.
* Visual hierarchy.
* Existing branding.

Avoid defaulting to purple gradients, blue gradients or other stereotypical AI-generated palettes.

Gradients are acceptable when they have a deliberate design purpose.

## 6.3 Define typography

Select typography based on the application's identity.

Consider:

* Heading font.
* Body font.
* Navigation font.
* Display typography.
* Monospace typography where appropriate.

Document:

* Font families.
* Font weights.
* Font sizes.
* Line heights.
* Letter spacing.
* Heading hierarchy.
* Responsive typography.

Avoid selecting fonts merely because they are popular.

Ensure readability and consistency.

## 6.4 Define spacing and layout

Establish a consistent spacing system.

For example:

* 4px.
* 8px.
* 12px.
* 16px.
* 24px.
* 32px.
* 48px.
* 64px.
* 96px.

These are suggested starting points, not mandatory values.

Define:

* Page margins.
* Content widths.
* Section spacing.
* Component spacing.
* Grid systems.
* Responsive breakpoints.
* Container behaviour.

Avoid arbitrary spacing values throughout the application.

## 6.5 Define shape and elevation

Establish consistent rules for:

* Border radius.
* Borders.
* Shadows.
* Elevation.
* Dividers.
* Containers.
* Card treatments.

Not every component needs rounded corners.

Not every section needs a card.

Not every surface needs a shadow.

Use these elements intentionally.

---

# 7. CREATE THE PROJECT DESIGN SYSTEM

Create:

docs/DESIGN.md

This document is the authoritative reference for the application's visual identity.

It must include:

1. Design philosophy.
2. Brand identity.
3. Target audience.
4. Emotional design direction.
5. Colour palette.
6. Typography.
7. Spacing system.
8. Layout rules.
9. Responsive breakpoints.
10. Border radius.
11. Shadows and elevation.
12. Buttons.
13. Forms.
14. Cards.
15. Navigation.
16. Modals.
17. Tables.
18. Notifications.
19. Icons.
20. Illustrations.
21. Animations.
22. Accessibility.
23. Dark mode, if applicable.
24. Anti-patterns.
25. Design implementation rules.

This document should be detailed enough that another developer could implement new pages without independently inventing the application's visual identity.

## 7.1 Establish design tokens

Translate the design system into actual code.

Use the existing styling architecture.

For CSS-based projects, consider:

src/styles/tokens.css

Example:

:root {
--color-primary: #F15A29;
--color-background: #FFFFFF;
--color-surface: #F8F8F8;
--color-text-primary: #202020;
--color-text-secondary: #666666;

```
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;

--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
```

}

This is illustrative only.

Determine the actual values from the approved design direction.

Do not blindly copy the example.

If Tailwind is already installed, integrate tokens with its existing configuration.

Avoid introducing a second styling architecture unnecessarily.

## 7.2 Create design documentation

Create:

docs/DESIGN_DECISIONS.md

Record important decisions.

For example:

* Why the primary colour was selected.
* Why a particular font was chosen.
* Why the navigation uses a particular layout.
* Why particular components use cards.
* Why certain interactions use animation.
* Why certain layouts prioritise mobile users.

This document should help future development remain consistent.

---

# 8. CREATE A REUSABLE COMPONENT LIBRARY

The objective is to establish reusable components that enforce design consistency.

Do not independently reinvent the same component on every page.

First inspect the existing component library.

Reuse and improve existing components wherever possible.

Introduce new components only where there is a genuine need.

## 8.1 Core UI components

Assess whether the application requires:

* Button.
* IconButton.
* Input.
* Textarea.
* Select.
* Checkbox.
* RadioButton.
* Switch.
* Badge.
* Tooltip.
* Dropdown.
* Modal.
* Dialog.
* Alert.
* Toast.
* Tabs.
* Accordion.
* Breadcrumbs.
* Pagination.
* Skeleton.
* LoadingIndicator.
* EmptyState.
* ErrorState.
* Avatar.
* Card.
* Divider.

Do not automatically implement every component.

Prioritise components that are relevant to the actual application.

## 8.2 Layout components

Consider:

* ApplicationLayout.
* PageContainer.
* Navbar.
* Sidebar.
* Footer.
* PageHeader.
* SectionHeader.
* ContentGrid.
* ResponsiveContainer.

## 8.3 Form components

Standardise:

* Labels.
* Input fields.
* Validation messages.
* Error states.
* Help text.
* Required indicators.
* Submission states.
* Success messages.

## 8.4 Component implementation requirements

Each reusable component should:

* Follow the design system.
* Support appropriate variants.
* Support responsive layouts.
* Include accessibility attributes.
* Handle loading states where relevant.
* Handle disabled states.
* Handle error states.
* Have predictable behaviour.
* Avoid unnecessary dependencies.
* Be documented.

For example:

<Button variant="primary" size="medium">
    Save changes
</Button>

Instead of independently styling buttons throughout the application.

## 8.5 Component architecture

Adapt the existing project structure.

If appropriate, use a structure similar to:

src/
components/
ui/
layout/
forms/
feedback/
styles/
tokens.css
global.css
pages/

Do not force this structure onto a project that already has an effective architecture.

---

# 9. PREVENT GENERIC AI-GENERATED DESIGN

This section is particularly important.

The application must not look like a generic AI-generated SaaS template.

Avoid automatically defaulting to:

* Purple gradients.
* Blue-to-purple gradient backgrounds.
* Excessive glassmorphism.
* Excessive rounded cards.
* Cards nested inside cards.
* Identical dashboard layouts.
* Generic hero sections.
* Unnecessary decorative icons.
* Excessive shadows.
* Random floating elements.
* Excessive animated backgrounds.
* Repetitive three-column layouts.
* Unnecessary badges.
* Excessive use of pills.
* Generic AI-generated illustrations.
* Identical layouts across unrelated pages.

These patterns are not universally prohibited.

They may be used when they genuinely serve the design.

However, every significant visual decision must have a reason.

## 9.1 Avoid visual monotony

Do not make every section look identical.

Use appropriate variation in:

* Layout composition.
* Content presentation.
* Section hierarchy.
* Image placement.
* Background treatments.
* Typography.
* Navigation patterns.

Variation must remain consistent with the design system.

## 9.2 Avoid unnecessary complexity

Do not confuse visual sophistication with visual complexity.

A professional interface can be simple.

Every component should have a clear purpose.

If a decorative element does not improve the experience, consider removing it.

## 9.3 Design for the actual application

An educational website should not automatically look like a banking application.

A financial application should not automatically look like a creative portfolio.

A healthcare platform should not automatically look like an e-commerce website.

The visual direction must emerge from the application's purpose and audience.

---

# 10. IMPLEMENT RESPONSIVE DESIGN

Every implemented component must be evaluated across different screen sizes.

Do not treat mobile responsiveness as a final cosmetic adjustment.

Consider mobile behaviour during initial implementation.

At minimum, evaluate:

* Mobile.
* Tablet.
* Desktop.
* Large desktop.

Use the existing project's responsive architecture where possible.

Check:

* Navigation.
* Menus.
* Forms.
* Tables.
* Cards.
* Images.
* Typography.
* Modals.
* Buttons.
* Content overflow.
* Touch targets.

Avoid simply shrinking desktop layouts.

Reconsider the composition when necessary.

For example:

A desktop sidebar might become a mobile navigation menu.

A multi-column layout might become a single-column layout.

A large table might require a different mobile presentation.

The mobile experience must feel deliberately designed.

---

# 11. ACCESSIBILITY REQUIREMENTS

Accessibility is part of design quality.

Implement and evaluate:

* Semantic HTML.
* Keyboard navigation.
* Visible focus states.
* Appropriate colour contrast.
* Accessible labels.
* Form descriptions.
* Error announcements.
* Alternative text for meaningful images.
* Accessible dialogs.
* Appropriate ARIA attributes.
* Reduced-motion preferences.
* Screen-reader compatibility.

Use WCAG 2.2 AA as the target standard where applicable.

Do not use colour as the only way to communicate important information.

Do not sacrifice accessibility for visual appearance.

---

# 12. ANIMATIONS AND INTERACTIONS

Animations should improve usability and reinforce the product's identity.

Consider:

* Hover states.
* Focus states.
* Page transitions.
* Loading transitions.
* Dropdown behaviour.
* Modal transitions.
* Feedback animations.
* Micro-interactions.

Avoid excessive animation.

Avoid animations that delay users from completing important tasks.

Respect prefers-reduced-motion.

Use existing animation libraries where appropriate.

Do not introduce large animation dependencies simply for decorative effects.

---

# 13. VISUAL TESTING AND QUALITY ASSURANCE

Visual quality must be tested rather than assumed.

After implementing each major component or page, inspect its rendered appearance.

Do not rely exclusively on reading the source code.

## 13.1 Browser-based inspection

Use the available browser automation tools.

If Playwright is already installed, use it.

Otherwise, assess whether introducing it is appropriate.

Inspect:

* Homepage.
* Navigation.
* Primary user journeys.
* Forms.
* Dashboards.
* Important content pages.
* Empty states.
* Error states.
* Loading states.
* Mobile layouts.

Capture screenshots at representative viewport sizes.

## 13.2 Visual regression testing

Where appropriate, establish screenshot baselines.

Compare subsequent implementations against those baselines.

Investigate unexpected changes.

Do not automatically accept visual changes simply because the application still builds.

## 13.3 Functional testing

Ensure visual changes do not break functionality.

Test:

* Buttons.
* Forms.
* Navigation.
* Authentication.
* API interactions.
* Modals.
* Dropdowns.
* Responsive menus.
* Existing application functionality.

## 13.4 Design review

After completing each major page, perform a separate design review.

Act as an independent senior UI/UX designer.

Evaluate:

1. Does the page communicate the application's purpose?
2. Does it reflect the approved visual identity?
3. Is the hierarchy clear?
4. Is the layout appropriate?
5. Is the typography consistent?
6. Are colours used intentionally?
7. Are components consistent?
8. Is there unnecessary visual clutter?
9. Does it look like a generic AI-generated template?
10. Does the mobile experience work?
11. Is it accessible?
12. Are interactions intuitive?

Produce a list of issues.

Prioritise them by severity.

Fix significant issues before proceeding.

---

# 14. CURSOR PROJECT RULES

Establish persistent project-specific instructions so that future AI-assisted development follows the same design principles.

Create appropriate Cursor rules in the existing supported location.

For example:

.cursor/rules/design-system.mdc

The rules should instruct future agents to:

1. Read docs/DESIGN.md before creating or modifying frontend components.
2. Read docs/DESIGN_BRIEF.md to understand the application's purpose.
3. Consult docs/DESIGN_DECISIONS.md when making significant design changes.
4. Reuse existing components.
5. Use established design tokens.
6. Avoid introducing inconsistent styles.
7. Maintain accessibility.
8. Maintain responsive behaviour.
9. Avoid generic AI design patterns.
10. Test significant visual changes.
11. Preserve existing functionality.
12. Update documentation when the design system changes.

Also create or update component-specific guidelines where appropriate.

Do not create redundant rules that contradict the existing project instructions.

---

# 15. IMPLEMENTATION PHASES

Implementation MUST occur incrementally.

Do not execute the entire project in a single uncontrolled operation.

Complete each phase, test it and document the outcome before proceeding.

## PHASE 0: PROJECT DISCOVERY

Tasks:

* Inspect project structure.
* Identify frameworks and dependencies.
* Locate Anthropic SKILL.md.
* Read existing design documentation.
* Identify existing components.
* Inspect current pages.
* Run existing tests.
* Run existing build.
* Capture baseline screenshots.
* Identify existing failures.

Deliverables:

* docs/PROJECT_DESIGN_AUDIT.md
* Baseline screenshots.
* Initial assessment.

Testing:

* Existing build must be evaluated.
* Existing tests must be evaluated.
* Existing application must be inspected.

Do not proceed without understanding the project.

## PHASE 1: PRODUCT AND HUMAN-CENTRED DESIGN RESEARCH

Tasks:

* Understand the application's purpose.
* Identify target users.
* Identify user expectations.
* Identify emotional associations.
* Identify important user journeys.
* Conduct competitive web research.
* Analyse relevant design references.

Deliverables:

* docs/DESIGN_BRIEF.md
* docs/DESIGN_RESEARCH.md

Testing and review:

* Verify that the references are relevant.
* Verify that design decisions are supported by research.
* Ensure the design brief reflects the actual application.

## PHASE 2: VISUAL DIRECTION

Tasks:

* Establish brand personality.
* Establish visual direction.
* Select colour palette.
* Select typography.
* Define spacing.
* Define layout principles.
* Define imagery direction.
* Define component styling principles.

Deliverables:

* Initial docs/DESIGN.md
* docs/DESIGN_DECISIONS.md

Testing and review:

* Check colour contrast.
* Check typography readability.
* Check visual consistency.
* Review whether the design communicates the intended identity.

If possible, present a small visual prototype before implementing the entire system.

## PHASE 3: DESIGN TOKENS

Tasks:

* Implement colour tokens.
* Implement typography tokens.
* Implement spacing tokens.
* Implement layout tokens.
* Implement border-radius tokens.
* Implement elevation tokens.
* Integrate with the existing styling framework.

Deliverables:

* Updated design token files.
* Updated global styles where necessary.

Testing:

* Verify the application builds.
* Verify existing pages still render.
* Verify tokens work.
* Verify there are no unintended global styling regressions.

## PHASE 4: REUSABLE COMPONENTS

Tasks:

* Audit existing components.
* Identify inconsistencies.
* Improve existing components.
* Create missing components.
* Standardise variants.
* Standardise interaction states.
* Add accessibility support.

Deliverables:

* Reusable component library.
* docs/COMPONENT_GUIDELINES.md

Testing:

Test each component independently where practical.

Verify:

* Appearance.
* Responsiveness.
* Functionality.
* Accessibility.
* Interaction states.

Do not proceed with large-scale page implementation until the foundational components are working.

## PHASE 5: APPLICATION LAYOUT AND NAVIGATION

Tasks:

* Implement or improve the application layout.
* Standardise navigation.
* Implement responsive navigation.
* Establish consistent page containers.
* Establish page headers.
* Standardise footer behaviour where applicable.

Testing:

* Desktop navigation.
* Mobile navigation.
* Tablet navigation.
* Keyboard navigation.
* Existing routing.
* Existing authentication-dependent navigation.

## PHASE 6: PAGE-BY-PAGE IMPLEMENTATION

Implement individual pages incrementally.

For each page:

1. Inspect the existing implementation.
2. Understand its functionality.
3. Identify its design requirements.
4. Apply the design system.
5. Reuse existing components.
6. Implement responsive behaviour.
7. Implement loading states.
8. Implement error states.
9. Implement empty states.
10. Capture screenshots.
11. Conduct visual review.
12. Run functional tests.
13. Correct issues.

Do not move to the next major page until the current page has passed its review.

## PHASE 7: VISUAL QUALITY ASSURANCE

Tasks:

* Capture screenshots.
* Compare against design expectations.
* Identify inconsistencies.
* Review spacing.
* Review typography.
* Review navigation.
* Review responsiveness.
* Review accessibility.
* Review visual hierarchy.
* Identify generic AI design patterns.

Deliverables:

* docs/DESIGN_REVIEW.md
* Visual test results.
* Updated screenshots.

Correct identified issues.

## PHASE 8: FINAL REGRESSION TESTING

Run:

* Existing unit tests.
* Existing integration tests.
* Existing end-to-end tests.
* Build verification.
* Visual regression tests.
* Responsive checks.
* Accessibility checks.

Verify that the design changes have not broken existing functionality.

Compare the final implementation with the original baseline.

## PHASE 9: DOCUMENTATION AND HANDOVER

Update:

* docs/DESIGN.md
* docs/DESIGN_DECISIONS.md
* docs/COMPONENT_GUIDELINES.md
* Cursor rules.
* README.md where appropriate.

Produce:

docs/DESIGN_IMPLEMENTATION_REPORT.md

The report should contain:

1. Initial project assessment.
2. Anthropic skill integration.
3. Competitive research findings.
4. Human-centred design decisions.
5. Established visual identity.
6. Design tokens implemented.
7. Components created or improved.
8. Pages updated.
9. Responsive improvements.
10. Accessibility improvements.
11. Testing performed.
12. Known issues.
13. Outstanding recommendations.

---

# 16. IMPORTANT DEVELOPMENT RULES

These rules apply throughout the entire implementation.

### Rule 1: Test after every phase

Never implement several major phases without testing.

### Rule 2: Preserve existing functionality

A visually attractive application that no longer works is a failed implementation.

### Rule 3: Do not overengineer

Do not introduce unnecessary libraries, dependencies or architectural complexity.

### Rule 4: Reuse before rebuilding

Always inspect existing components before creating replacements.

### Rule 5: Design with purpose

Every significant design decision must have a reason.

### Rule 6: Avoid generic AI aesthetics

Do not rely on default AI-generated layouts.

### Rule 7: Research before designing

Understand the industry and audience before establishing the visual direction.

### Rule 8: Prioritise usability

A visually impressive interface that confuses users is unsuccessful.

### Rule 9: Accessibility is mandatory

Do not treat accessibility as an optional enhancement.

### Rule 10: Inspect actual rendered interfaces

Do not assume that code which looks correct will render correctly.

### Rule 11: Maintain documentation

The design system must remain useful for future development.

### Rule 12: Do not make unrelated changes

Only modify files relevant to the design implementation unless another change is genuinely necessary.

### Rule 13: Do not silently ignore failures

If a test fails, investigate it.

Determine whether it was an existing failure or introduced by your changes.

Document unresolved problems.

### Rule 14: Do not sacrifice identity for convention

Industry conventions are useful, but the application should have its own distinctive identity.

---

# 17. DEFINITION OF DONE

The implementation is complete only when the following conditions are satisfied.

## Design identity

* [ ] The application's purpose and audience have been understood.
* [ ] Human-centred design research has been completed.
* [ ] Relevant competitors and references have been researched.
* [ ] A distinctive visual identity has been established.
* [ ] The design system is documented.
* [ ] The design decisions are documented.

## Design infrastructure

* [ ] Anthropic's existing frontend design skill has been consulted.
* [ ] The original SKILL.md remains intact.
* [ ] Design tokens have been implemented.
* [ ] Existing reusable components have been evaluated.
* [ ] Reusable components have been established or improved.
* [ ] Cursor rules have been created or updated appropriately.

## Interface implementation

* [ ] Existing pages have been evaluated.
* [ ] Relevant pages have been improved.
* [ ] Navigation is consistent.
* [ ] Typography is consistent.
* [ ] Colours are consistent.
* [ ] Spacing is consistent.
* [ ] Responsive behaviour is implemented.
* [ ] Loading states are handled.
* [ ] Error states are handled.
* [ ] Empty states are handled.

## Quality assurance

* [ ] Existing functionality remains intact.
* [ ] Build succeeds.
* [ ] Relevant tests pass.
* [ ] Visual inspections have been performed.
* [ ] Mobile layouts have been inspected.
* [ ] Accessibility has been evaluated.
* [ ] Visual inconsistencies have been corrected.
* [ ] No significant generic AI design patterns remain without justification.

## Project preservation

* [ ] Original project architecture has been preserved.
* [ ] Existing backend functionality remains intact.
* [ ] Existing API integrations remain intact.
* [ ] Existing database structures remain intact.
* [ ] Existing deployment configuration remains intact unless a change was explicitly required and approved.
* [ ] No unrelated files have been unnecessarily modified.

## Documentation

* [ ] DESIGN_BRIEF.md exists.
* [ ] DESIGN_RESEARCH.md exists.
* [ ] DESIGN.md exists.
* [ ] DESIGN_DECISIONS.md exists.
* [ ] COMPONENT_GUIDELINES.md exists.
* [ ] DESIGN_REVIEW.md exists.
* [ ] DESIGN_IMPLEMENTATION_REPORT.md exists.

---

# 18. FINAL INSTRUCTIONS TO THE CURSOR AGENT

Approach this task as a professional design and engineering engagement.

Do not immediately start modifying frontend files.

First understand the application.

Then research its industry.

Then understand what the application should communicate to its users.

Then establish its visual identity.

Then build the design system.

Then build or improve reusable components.

Then implement the design incrementally.

Then test and review everything.

The objective is to create an interface that feels intentional, distinctive and professionally designed.

Do not confuse a visually elaborate interface with a good interface.

Do not confuse minimalism with a lack of design.

Do not confuse modern aesthetics with the latest design trends.

The best design is the one that communicates the application's purpose, makes users feel appropriately confident and comfortable, and allows them to accomplish their objectives with minimal friction.

**Your ultimate objective is to ensure that someone visiting the application experiences a product that feels purpose-built for its audience, rather than an interface generated from a generic AI website template.**

Begin with PHASE 0.

Do not skip phases.

Do not perform destructive operations.

Test incrementally.

Document your work.

Only consider the implementation complete when the final design has been inspected in an actual browser and the relevant quality checks have passed.
