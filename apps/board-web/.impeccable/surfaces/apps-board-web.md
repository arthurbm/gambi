---
version: 1
slug: "apps-board-web"
primary_target: "apps/board-web"
related_targets: []
---

# Event board surface brief

## Scope and mode

- Target: `apps/board-web`, all event routes with `/` as the projector-first anchor.
- Mode: Operate. People join, deliberate, dispatch, review, and watch the shared city during a live room.
- Audience: 20 to 50 club participants on phones and PCs, plus a facilitator using a projector.
- Primary job: keep the city, current phase, squad ownership, and next human action legible within seconds.
- Approved comp: `.impeccable/mocks/spec68/comp-2-map-led.png`.

## Direction contract

THESIS: The event is one living cadastral plan. The shared city leads, and recorded human decisions change it. Refuse the generic card dashboard.

OWN-WORLD: Survey paper, drafting ink, measured parcel lines, field ledgers, painted stakes, graphite notes, and dated registration stamps. Status color stays on boundaries and marks.

STORY: A person sees the current round and city, finds their squad, records a decision, dispatches it, then accepts or returns the result with authorship intact.

FIRST VIEWPORT: The city map owns about 70 percent. A slim squad gutter sits left, phase and admin controls sit right, and the decision ledger runs below.

FORM: Map-led field book, selected from the comp round seeded by `80af7246`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Visual inventory

| Ingredient | Approved-comp commitment | Medium |
|---|---|---|
| Page ground | Warm paper `#ECE0CE`, with restrained survey grain | CSS color plus one generated reusable paper texture if the finish needs visible grain |
| Map field | Lighter plan sheet around `#F4E9D4`, occupying about 70% of desktop | Semantic HTML/CSS grid with SVG parcel lines |
| Ink | Dark drafting ink `#25322E` | CSS token and semantic text |
| Registration red | Approx. `#B94031`, only for returns, irreversible warnings, and dated stamps | CSS token, borders no thicker than 1px, authored stamp component |
| Survey teal | Approx. `#38524B`, for connected/live boundaries and active navigation | CSS token and SVG strokes |
| Measured yellow | Approx. `#CDAA68`, for pending/current round markers | CSS token and SVG stakes |
| City parcels | Six coherent lots with fixed camera/light and distinct squad tiles | Responsive CSS grid, sandboxed artifact iframes, SVG overlay |
| Squad gutter | Bound field-book list with people, harness, and steerer | Semantic nav/list; shadcn composition for controls only |
| Phase margin | Room, round, timing, and admin advance action | Semantic aside and accessible form controls |
| Event ledger | Draft, decision, dispatch, accepted/returned, author, timestamp | Responsive table that becomes a labelled list on phones |
| Decision marks | Dated stamps and graphite annotations remain in history | CSS/SVG geometry; no rasterized text |
| Primary action | A measured field control with an explicit action label | shadcn Button using direction tokens, no decorative animation |
| Publication transition | A new accepted tile becomes perceptible without moving readable content | CSS opacity plus transform, 200ms, strong ease-out, reduced-motion fade |

## Responsive and interaction rules

- Desktop/projector: city first, edge gutters, ledger below.
- Phone: the city remains the `/` landing view; Cidade, Meu squad, Orquestrador, and Admin become route tabs rather than squeezed columns.
- No device role is fixed. Authorization and steering follow the named person and current round.
- Keep all controls keyboard reachable with visible focus. Use semantic tokens and the configured icon library.
- Empty or broken tiles show the measured lot and squad plate. They never collapse the city grid.
- The approved comp supplies topology and material, not literal dates, fictitious credentials, or rasterized UI copy.
