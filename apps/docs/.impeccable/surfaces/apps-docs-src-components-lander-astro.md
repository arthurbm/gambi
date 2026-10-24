---
version: 1
slug: "apps-docs-src-components-lander-astro"
primary_target: "apps/docs/src/components/Lander.astro"
related_targets: ["apps/docs/src/content/docs/index.mdx","apps/docs/src/components/Hero.astro"]
---

# Landing surface brief

## Scope and mode

- Target: `apps/docs/src/components/Lander.astro` (rendered on `/` through the `Hero.astro` override; `index.mdx` frontmatter).
- Mode: Persuade.
- Audience: builders who want models and coding harnesses from several people behind one hub; club members bringing their own machine; room hosts.
- Job: understand in one viewport that each participant dials out to the hub, that models and harnesses both join, and that keys stay home; then install.
- Action: copy the working install command, then the quick start or the harness guide.
- Proof: real CLI commands and SDK calls checked against `packages/*`; an example room labelled as an example.
- Constraints: English copy (ADR-0001); hero names no category (no "room", "gateway", "substrate"); trusted network only, never suggest public exposure; board/agents are not part of the product; the lab repo is "coming soon" with no link; no promises about the layer above beyond "being explored".

## Direction contract

THESIS: Gambi is a feira. Every stall arrives on its own and plugs into the shared canopy; the canopy never goes to anyone's house. Refuse the dark terminal dev-tool hero and the cream editorial page the site used before.

OWN-WORLD: Hand-painted feira signage by an abridor de letras. Lime-wash wall by day, night-market navy after dark. Tarp-blue striped canopy with a scalloped valance, egg-yolk yellow boards, tomato red reserved for the primary action and the trust warning, and nothing else, leaf green for live tunnels. Fat sign capitals with a painted drop shadow ("sombra"), double pinstripe filete borders, dotted price-board leaders, mono only for real commands and frames.

STORY: The visitor reads three painted lines (bring your model, bring your harness, keep your keys), sees six stalls dial up to the canopy, learns which stall type serves what, sees exactly what crosses the tunnel and what never leaves, then copies the install command.

FIRST VIEWPORT: A plain navy nav bar. The H1 sits left-aligned in three painted lines at display scale. The subcopy and an action row follow: a yellow command board with a working copy control, a red Quick start, and a filete-outlined Bring your harness. The aisle starts at the bottom: the hub is one canopy (striped tarp, valance painted GAMBI HUB, scalloped hem), and six stalls (three models, the three supported harnesses) pack edge to edge below it, each with a tunnel cord rising to the hem.

FORM: Feira de letreiros, position 4 on the ordered list (1 power strip, 2 lambe-lambe, 3 switchboard, 4 feira signage, 5 metro diagram, 6 xerox flyer, 7 cordel). seed:d4ff3f5504353fc8. Raises: VU-meter bridge (identical stalls shoulder to shoulder, the room is read by sweeping the row); toy catalogue (the aisle packs edge to edge, no gaps); deco cinema lobby (staged arrival: canopy, aisle, back of the stall, the till); glazier partition (one board, one statement; red only for what matters now); paper automata (one timeline drives every cord and pulse). Signature interaction: cords draw upward from each stall to the hub beam (participant opens), then a dispatch token travels down one cord (hub dispatches into the tunnel). Focusing a stall shows what goes down its cord and what stays home. Reduced motion: cords drawn, no travel.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Starlight's own header and docs pages keep the incumbent tokens; only the splash route takes the new world.
