---
version: 1
slug: "apps-docs-src-styles-docs-css"
primary_target: "apps/docs/src/styles/docs.css"
related_targets: ["apps/docs/src/styles/tokens.css","apps/docs/src/plugins/mermaid.mjs","apps/docs/src/components/SiteTitle.astro","apps/docs/src/content/docs"]
---

# Docs surface brief

## Scope and mode

- Target: `apps/docs/src/styles/docs.css` (every Starlight page except `/`), with `src/styles/tokens.css`, `src/plugins/mermaid.mjs`, `src/components/SiteTitle.astro`, and the content under `src/content/docs/`.
- Mode: Read.
- Audience: builders wiring an app to a hub, people joining a room with a model or a harness, operators running a hub.
- Job: find the command, endpoint, or SDK call and understand why the transport works the way it does. Precision and legibility before expression.
- Constraints: same event-display world as the landing (tokens, Archivo width axis, mono only for literal strings, yellow model, cyan harness, red only for stops). "Harness" is the canonical term in docs; "agents" stays in landing copy. Facts come from `packages/*`.

## Direction contract

THESIS: the landing's display printed as a manual. Starlight's familiar layout (sidebar, content column, table of contents) stays; the world shows in type, hairlines, the dark code slab, and diagrams that use the track colors.

FORM: Read mode. Hairline-separated h2 sections, label-recipe group headers, tables without fills, asides as sheet panels (caution and danger in the stop recipe), Expressive Code on the slab, Mermaid diagrams drawn by Pele with token colors and a phone layout.

FINISH: DESIGN.md "Docs pages" and "Docs diagrams" record the rules; checked in light and dark at 1280px and 390px.
