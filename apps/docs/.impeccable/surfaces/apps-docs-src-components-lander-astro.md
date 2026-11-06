---
version: 1
slug: "apps-docs-src-components-lander-astro"
primary_target: "apps/docs/src/components/Lander.astro"
related_targets: ["apps/docs/src/content/docs/index.mdx","apps/docs/src/components/Hero.astro","apps/docs/src/components/lander"]
---

# Landing surface brief

## Scope and mode

- Target: `apps/docs/src/components/Lander.astro` (rendered on `/` through the `Hero.astro` override; `index.mdx` frontmatter).
- Mode: Persuade.
- Audience: builders who want to make things where several people's models and coding harnesses take part; researchers and club hosts running those sessions.
- Job: vision first. Most orchestrators are one person driving many agents (1→N). Gambi is the base for many people, each with their own models and harnesses, working in one session (N↔N). Then: how it stays safe (participant dials out, keys and logins stay home, workspace chosen by its owner), what you build on it, install.
- Action: copy the install command, then Get started (the quick start). One primary CTA; a secondary in-page link to how it works.
- Proof: real CLI commands, SDK calls, event and frame names checked against `packages/*`; the 1→N vs N↔N display uses an example session labelled as an example; selectable examples (arena, jury, debate, draft/critique/polish, squads) with illustrative event logs; the squads example shows the gambiarra-lab dynamic without naming the repo, marked being explored.
- Constraints: English copy run through the unslop rules; no "gateway", "substrate", "primitive"; "agents" is allowed in public copy for coding harnesses (CONTEXT.md exception), product facts name the concrete thing; no permission system is claimed for the hub: the safety claims are tunnel-first, keys and logins never leave, the hub cannot write into a workspace, trusted networks only. Roles and approvals (steerer, decision before dispatch) belong to the app, shown as such. No named competitors.

## Direction contract

THESIS: Gambi as a detector event display: one session frozen at one instant, many people's tracks arriving at one hub from the outer ring. Refuses the generic dev-infra hero (headline left, boxes-and-arrows right, card grid below), the feira painting, and the terminal look.

OWN-WORLD: Detector-hall graphite ground (not black, no glow), steel-blue ring sections, signal yellow for model tracks, cyan for harness tracks, red only for the boundary where something stops (keys, logins, the trusted-network warning). Archivo set expanded for headlines, condensed and tabular for labels pinned to tracks; mono only for literal commands and frames. Light theme is the same display printed on paper.

STORY: The visitor reads that agent tools are built for one person, watches one bundle open into six machines (1→N to N↔N), compares one person with many on four questions, follows one request through the rings and sees what never leaves the machine, picks an example to watch, glances at the code, installs.

FIRST VIEWPORT: Plain nav. Left column: headline, lede, install command with working copy, one primary Get started, an in-page How it works link. Right 55%, unframed: the ring section at full height, six tracks bending the same way (never crossing) from named people on the machine band to the hub, a two-state switch "1 → N / N ↔ N" above the board and tabular readouts below it.

FORM: Collider event display, catalog challenger scientific-notation-particle-detector-event-display, fused with the category standard's reading order at the user's request (position: dealt challenger; grounded list led by transit diagram, concrete grid, hemicycle, switchboard, hub unit). seed:badb192a5fa31fba. Signature interaction: the 1→N / N↔N switch slides every track's origin along the machine band between one bundle and six machines, wedges and names travelling with them; selecting a person isolates their tracks and shows what crosses and what stays. Motion grammar: tracks draw inward (participant opens), pulses travel outward (hub dispatches); one timeline; reduced motion shows the end frame.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- None. The docs pass adopted the world (see the docs surface brief, `apps-docs-src-styles-docs-css.md`).
