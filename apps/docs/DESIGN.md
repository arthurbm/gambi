---
name: Gambi
description: Hand-painted feira signage for a hub that every stall dials out to.
colors:
  lona: "#1e4fb4"
  lona-deep: "#133679"
  stripe: "#ffffff"
  ovo: "#f5c11b"
  tomate: "#c8281c"
  folha: "#11804a"
  ground: "#eef0ea"
  ground-2: "#e2e6dc"
  board: "#fbfbf6"
  ink: "#161a22"
  ink-soft: "#3d4452"
  rule: "rgb(22 26 34 / 0.2)"
  code-ink: "#e9ecf2"
  code-dim: "#9aa3b5"
  night-ground: "#14244f"
  night-ground-2: "#1a2d5e"
  night-board: "#20356a"
  night-ink-soft: "#b9c1d0"
  night-rule: "rgb(238 240 234 / 0.18)"
  night-lona: "#2a5fd0"
  night-lona-deep: "#0d1a3d"
  night-stripe: "#d6dbe6"
  night-tomate: "#d43a22"
  night-alarm: "#ff6b55"
  night-folha: "#4fd08a"
  night-line-harness: "#8fb0ff"
  night-line-keys: "#3cc27a"
  night-sombra: "#04070d"
  night-code-bg: "#0a1330"
typography:
  display:
    fontFamily: "Bungee, Archivo Variable, sans-serif"
    fontSize: "clamp(2.2rem, 5.55vw, 5.4rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "0em"
  headline:
    fontFamily: "Bungee, Archivo Variable, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "0em"
  headline-board:
    fontFamily: "Bungee, Archivo Variable, sans-serif"
    fontSize: "clamp(1.9rem, 3.4vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1
  title:
    fontFamily: "Bungee, Archivo Variable, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 400
  title-text:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
  lead:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.08rem, 1.4vw, 1.28rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    fontVariation: "'wdth' 90"
  label-caps:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 700
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 88"
  button:
    fontFamily: "Bungee, Archivo Variable, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.01em"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  inline: "4px"
  command: "6px"
  code: "8px"
  control: "10px"
  panel: "12px"
  board: "14px"
  pill: "999px"
spacing:
  gutter-min: "1.1rem"
  gutter-max: "4rem"
  measure: "84rem"
  cluster: "0.85rem"
  stack: "1.1rem"
  block: "2.25rem"
  section-min: "3.5rem"
  section-max: "6.5rem"
components:
  button-paint:
    backgroundColor: "{colors.tomate}"
    textColor: "{colors.stripe}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0.85rem 1.35rem"
  button-filete:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0.85rem 1.35rem"
  till:
    backgroundColor: "{colors.ovo}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.6rem 0.5rem 1.05rem"
  command:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.command}"
    padding: "0.6rem 0.75rem"
  code-block:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.code}"
    padding: "1rem 1.15rem"
  nav-bar:
    backgroundColor: "{colors.lona-deep}"
    textColor: "{colors.stripe}"
    padding: "0.7rem clamp(1.1rem, 4vw, 4rem)"
  stall:
    backgroundColor: "{colors.board}"
    textColor: "{colors.ink}"
    padding: "1.6rem 1rem 1rem"
  stall-active:
    backgroundColor: "{colors.ovo}"
    textColor: "{colors.ink}"
  board-model:
    backgroundColor: "{colors.ovo}"
    textColor: "{colors.ink}"
    rounded: "{rounded.board}"
    padding: "clamp(1.4rem, 3vw, 2.25rem)"
  board-harness:
    backgroundColor: "{colors.lona}"
    textColor: "{colors.stripe}"
    rounded: "{rounded.board}"
    padding: "clamp(1.4rem, 3vw, 2.25rem)"
  aviso:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1.1rem 1.4rem"
  tag-shipping:
    backgroundColor: "{colors.folha}"
    textColor: "{colors.stripe}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.55rem"
---

# Design System: Gambi

## Overview

**Creative North Star: "The Painted Feira"**

Gambi looks like a Brazilian street market painted by an abridor de letras, the sign painter who letters stall boards by hand. The hub is the canopy: a tarp-blue striped awning with a painted valance and a scalloped hem. Participants are stalls that pack edge to edge underneath it, each wired up by its own cord. Fat sign capitals carry a stepped drop shadow (the painter's *sombra*). Boards are framed with a double pinstripe (*filete*), and price lists run dotted leaders out to the value. The gambiarra spirit shows up as confident, legible hand-painted signs, not as mess.

Daylight is lime-washed wall over cool off-white board. Night is market navy, with the yellow and the green turned up to read under lamps. Density is moderate. Each section is one board making one statement, separated by generous vertical rhythm, and each board is a flat, solid field of color. Monospace appears only where the content is literal: commands, frame types, file paths, code.

The world rejects the dark terminal dev-tool hero and the cream-and-orange editorial page this site used before. Neither gets reintroduced on surfaces that adopt this system.

**Key Characteristics:**
- Flat, saturated sign-board fields (egg-yolk yellow, tarp blue) on a pale lime-wash ground.
- Bungee sign capitals with a three-step painted drop shadow for every display line.
- Double-pinstripe borders made from a solid border plus an inset outline.
- Dotted leaders that run from a label to its value, price-board style.
- Tomato red reserved for the primary action and the trust warning.
- Leaf green means live or yours: open tunnels, and what stays on your machine.
- One literal motion story: cords rise from the stalls to the canopy, then a token travels down one cord.

## Colors

The palette is feira paint: two strong pigments (tarp blue, egg yolk), one alarm red, one leaf green, over neutrals that carry a faint lime cast by day and a navy cast by night.

### Primary
- **Tarp Blue / Lona** (`lona`): the hub. It covers the canopy stripes, the valance plate, the harness board, the roof scallop on harness stalls, and the mobile rail. Light-theme text in this hue marks things that cross the tunnel: the second hero line, frame-type names, the "Goes to the hub" ledger column. At night it lifts to `night-lona`, and the text role moves to `night-line-harness` so it stays legible on navy.
- **Deep Tarp / Lona Deep** (`lona-deep`): the plain bar under the canopy, used for the top nav and the footer. It also provides the drop shadow on the painted valance name. At night it becomes `night-lona-deep`.

### Secondary
- **Egg-Yolk Yellow / Ovo** (`ovo`): the painted board. It fills the install till, the model board, the "Gambi today" layer, the step-number discs, the selected stall, the dispatch token, the copy icon, link-hover underlines, text selection, and the focus ring. It also paints the sombra under the first hero line by day and under section titles in light mode. Its value is the same in both themes. Text on yellow is always `ink`.

### Tertiary
- **Tomato Red / Tomate** (`tomate`, `night-tomate`): the primary action button and nothing else.
- **Warning Red / Alarm** (`tomate` by day, `night-alarm` at night): the "Trusted networks only" notice, both its title and its double border. The token is separate from tomate so the warning can brighten at night while the button keeps its pigment.
- **Leaf Green / Folha** (`folha`, `night-folha`): live and yours. It colors the "tunnel open" state and lamp on every stall, the third hero line ("Keep your keys", via `night-line-keys` at night), the "Stays at your stall" ledger column, the square bullets in a stall's stays list, and the "Shipping" tag.

### Neutral
- **Lime-Wash Ground** (`ground` / `night-ground`): the page wall behind everything.
- **Shaded Wall** (`ground-2` / `night-ground-2`): recessed panels. It backs the stall detail drawer and the "layer above" board, which reads as chalked, not yet painted.
- **Board White** (`board` / `night-board`): stall faces, the ledger book, the "What you build" layer.
- **Sign Ink** (`ink`): text on light grounds, and all text on yellow. In light mode the same hex is also the painted sombra and the code-board background. At night, body ink becomes the light ground value, the sombra becomes `night-sombra`, and code boards become `night-code-bg`.
- **Faded Ink** (`ink-soft` / `night-ink-soft`): lede, section leads, secondary notes, the stall kind line.
- **Pencil Rule** (`rule` / `night-rule`): hairlines between stalls and between ledger rows.
- **Chalk** (`code-ink`, `code-dim`): text on code boards and on the recipes board. Code-dim is used for "see the pattern" hints.
- **Stripe White** (`stripe` / `night-stripe`): the light stripe on the tarp, and text on blue and on red.

Code syntax runs on Shiki's css-variables theme, mapped to the palette: strings in egg yolk, functions in a light tarp blue (#8fb4ff), constants in a light leaf (#6fdca0), keywords in a salmon (#ff8a73), comments in #8a93a6.

### Named Rules
**The Red Is Spent Rule.** Red appears on the primary action and the trust warning only, one red button per action row. Red never colors a heading, a stall, a tag, or a decoration.

**The Green Means Yours Rule.** Leaf green marks things that are live or that stay with the participant: open tunnels, local keys, logins, and anything shipping. Don't use it as a generic success or brand accent.

**The Ink on Yolk Rule.** Text on egg yolk is always sign ink (`ink`), in both themes. Yellow never carries white text.

## Typography

**Display Font:** Bungee (with Archivo Variable, sans-serif)
**Body Font:** Archivo Variable, width axis in use (with system-ui)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace)

**Character:** Bungee is a sign-painter's capital, fat and all-caps by design, made to be read from across the aisle. Archivo does the talking underneath. Its width axis narrows labels (`wdth` 88–94) so they read like stencilled price tags, while body text stays at full width.

### Hierarchy
- **Display** (Bungee 400, clamp(2.2rem, 5.55vw, 5.4rem), line-height 1.02): the hero only. Three stacked lines, each in its own ink (sign ink with a yellow sombra, tarp blue, leaf green), left-aligned.
- **Headline** (Bungee 400, clamp(1.75rem, 3.6vw, 3rem), line-height 1.02, max 22ch): section titles. Sign ink with a two-step sombra in yellow by day and tarp blue by night.
- **Headline Board** (Bungee 400, clamp(1.9rem, 3.4vw, 2.75rem), line-height 1): the title painted on a menu board, with a three-step sombra in white on yellow or #0a1a40 on blue.
- **Title** (Bungee 400, 1.35rem): sub-board titles such as the stall detail name, the warning title, and the recipes title. The ledger column headers (1rem), stall names (clamp(1.3rem, 2vw, 1.7rem)), and layer titles (clamp(1.1rem, 2vw, 1.4rem)) use the same face.
- **Title Text** (Archivo 700, 1.15rem): step titles in the setup list, where a painted capital would be too loud.
- **Lead** (Archivo 400, clamp(1.08rem, 1.4vw, 1.28rem), line-height 1.55, max 62ch): the hero lede. Section leads sit at 1.12rem with the same measure.
- **Body** (Archivo 400, 1.0625rem, line-height 1.55): everything else. Measure caps between 44ch (board copy) and 75ch (warning copy).
- **Label** (Archivo 600, 0.8–0.98rem, `wdth` 90–92): nav links, stall kind and state, price-list keys (700).
- **Label Caps** (Archivo 700, 0.75–0.82rem, letter-spacing 0.04–0.06em, uppercase): column headings inside a detail drawer, footer column headings, and status tags.
- **Mono** (JetBrains Mono, 0.85rem in code boards, 0.86em inline, line-height 1.6): commands, frame types, file names, paths.

### Named Rules
**The Sombra Rule.** Every Bungee line at headline size or larger carries a painted drop shadow made of hard, stepped, zero-blur offsets: `0.02em / 0.035em / 0.05em` for display, `0.03em / 0.055em` for headlines, or 1px/2px/3px for wordmarks and boards. The sombra is a sign-painting technique and belongs to the world. It applies to type only, never to boxes.

**The Literal Mono Rule.** Monospace is for text a person could copy or a machine would parse: commands, frame types, paths, file names, package names. Prose never switches into mono for emphasis.

**The No Tracking Rule.** Bungee runs at 0 letter-spacing (0.01–0.02em at button and till sizes). Its capitals are already spaced for signage.

## Layout

Content sits in a single centered column capped at 84rem. Side gutters run clamp(1.1rem, 4vw, 4rem), and the canopy bar and footer bleed edge to edge. Sections are separated by clamp(3.5rem, 8vw, 6.5rem) of top padding. A section title is followed by its lead at 1.1rem and its main content at 2.25rem. Action rows use a 0.85rem gap and wrap.

Paired content uses two equal columns: model and harness boards, two code snippets, the two ledger columns, the two columns of the stall detail, and the two-column recipe list. The layer stack is a single column of boards, each split into a title column (min 14rem) and a body column (2fr).

The aisle is a six-column grid of stalls packed edge to edge with no gap, separated only by pencil-rule hairlines. Cords 4.25rem tall hang between the canopy hem and the stalls.

Breakpoints:
- **68rem**: the footer drops from four columns to three, and the brand spans the full row.
- **56rem**: the aisle rotates. The canopy beam stays on top, the stalls stack in one column against a 6px tarp-blue rail on the left, and cords run sideways (1.6rem). Stalls become rounded cards.
- **44rem**: every two-column pair collapses to one column. The till and its command go full width with wrapping commands. Price-list leaders drop and labels stack over values. The ledger becomes labelled entries separated by double rules. Code blocks wrap with a 2ch hanging indent instead of scrolling. Secondary nav links hide.

## Elevation & Depth

The system is flat. Depth comes from paint and layering, not light. Boards are solid fields, the recessed drawer is a darker wall tone, and the painted sombra on type gives the dimensionality. The few soft shadows imitate a physical object casting a shadow on the wall. None is used as a generic card lift.

### Shadow Vocabulary
- **Canopy cast** (`filter: drop-shadow(0 6px 8px rgb(0 0 0 / 0.16))`): the whole beam (tarp, valance, hem), so the scalloped silhouette casts a true shadow.
- **Tarp fold** (`box-shadow: inset 0 -4px 6px -2px rgb(0 0 0 / 0.18)`): the crease where the tarp meets the valance.
- **Ledger rest** (`box-shadow: 0 10px 30px -18px rgb(0 0 0 / 0.45)`): the account book lying on the wall. It is the only board with an ambient shadow.
- **Paint button rest / lift** (`0 2px 4px rgb(0 0 0 / 0.18)` at rest, `0 6px 14px rgb(0 0 0 / 0.2)` with translateY(-1px) on hover): the primary action only.

### Named Rules
**The Paint Not Plastic Rule.** Boards are flat at rest and do not lift on hover. State is shown by a paint change (yellow wash, selected yolk fill), not by elevation. The primary button is the one exception.

## Shapes

Corners are gently rounded, like sign boards cut from sheet metal, and the radius grows with the object. Inline code and the focus ring use 4px, command chips 6px, code boards 8px, controls (till, buttons) and the stall drawer's bottom edge 10px, the ledger and warning 12px, and painted boards, layers, the recipe board, and the tarp's top corners 14px. Status tags, step discs, the theme toggle, and lamps are full circles or pills.

Two recurring silhouettes define the world:
- **The scallop.** Radial-gradient masks cut a scalloped edge on the canopy hem (2.4rem period) and a small scalloped roof on each stall (1.25rem period). Model stalls get a yellow roof, harness stalls a blue one, and the selected stall a sign-ink roof.
- **The filete.** A double pinstripe made from a solid border or fill plus a 1–1.5px outline inset by 5–9px. It appears on the filete button, the till, both menu boards, the "What you build" layer, and the warning. The ledger header uses a CSS `3px double` rule for the same effect.

Dotted leaders (2px dotted, currentColor at 0.55 opacity on boards, white at 0.35 on the recipe board) connect labels to values.

## Components

### Buttons
Painted signs you can press: Bungee capitals on a solid field, never a gradient.
- **Shape:** gently rounded (10px), padding 0.85rem 1.35rem, Bungee 0.95rem.
- **Paint (primary):** tomato field, white text with a 1px dark text-shadow, small resting shadow. On hover it darkens 14% toward black (color-mix in oklab) and lifts 1px. Active returns to 0. Transitions run 160ms on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Filete (secondary):** transparent, sign-ink text, 1.5px ink border plus a 1px ink outline inset 5px. Hover washes 8% ink into the background.
- **Focus (all interactive):** 3px egg-yolk outline at 3px offset, with a 6px sign-ink halo behind it, 4px radius.

### The Till (install command board)
The one working command, painted on a yellow board.
- **Shape:** 10px radius, yellow field, 1.5px ink outline inset 5px. A Bungee "Install" label sits beside a dark command chip.
- **Command chip:** sign-ink field, chalk mono text that scrolls horizontally with a thin yellow scrollbar, and a yellow copy icon. Hover goes to pure black. On copy, the icon swaps to a green check (#5fe39a) for 1.6s, and a live region announces "Copied" or a failure message.
- **Small variant:** the same chip at 0.82rem, used in a wrapping row for the curl, npm, and bun installs.

### Stall (selectable participant)
One stall per participant, packed edge to edge under the canopy.
- **Shape:** square edges in the row, with a hairline divider between stalls. Below 56rem it becomes an 8px-rounded card.
- **Content:** scalloped roof (yellow for model, blue for harness), Bungee name, mono offer, kind label, and "tunnel open" state with a green lamp pinned to the bottom.
- **States:** hover washes 22% yolk into the board. Selected (`aria-pressed`) fills full yolk with ink text, an ink roof, and the state in #0b5a33. Selecting a stall shows its detail drawer and sends a dispatch token down its cord.
- **Detail drawer:** shaded-wall panel under a 3px ink top rule. It has a title, two columns ("Down the tunnel" frame list, "Stays at …" list with green square bullets), and the join command as a code board.

### Menu Boards (cards)
- **Corner Style:** 14px.
- **Background:** solid yolk (models) or tarp blue (harnesses). Text is ink on yolk and white on blue.
- **Border:** filete in currentColor, inset 9px.
- **Content:** a painted headline-board title, a short description, a price list with dotted leaders, and a bold underlined link with a CSS chevron that nudges 3px right on hover.
- **Internal Padding:** clamp(1.4rem, 3vw, 2.25rem).
- **Shadow Strategy:** none (see Paint Not Plastic).

### Ledger (comparison table)
A ruled account book on board white, with a soft resting shadow and a 12px radius. Bungee column headers are colored by meaning (tarp blue for "goes to the hub", leaf green for "stays at your stall") over a 3px double rule. Cells are divided by pencil hairlines. Below 44rem each row becomes a labelled entry.

### Warning Notice (aviso)
The trust warning. It has a transparent field, a 2px alarm-red border with a 1px inset pinstripe (7px offset), a Bungee title in red, 12px radius, and a bold inline link. This is the only bordered element in red.

### Code Boards
Sign-ink field (navy-black at night), chalk text, 8px radius, 1rem 1.15rem padding, line-height 1.6, Shiki css-variables palette. Above 44rem they scroll with a thin yellow scrollbar. Below that they wrap with a hanging indent.

### Recipe Board (cardápio)
A dark code-ground board (14px) with a yellow Bungee title and a two-column list. Each row is a bold dish name, a dotted leader, and a dim hint. On hover the dish is underlined in yolk and the hint turns yolk.

### Layer Stack
Three stacked boards, outermost first. "What you build" is board white with a filete. "The layer above" is shaded wall with no border, chalked and unfinished. "Gambi today" is solid yolk. Paint saturation tracks how real each layer is.

### Tags
Pill (999px), Archivo 700 at 0.75rem, uppercase, 0.04em tracking. **Shipping** is solid leaf green with white text. **Being explored** is outlined at 1.5px in faded ink.

### Navigation
A plain deep-tarp bar (0.7rem vertical padding, full bleed). The left side holds a Bungee wordmark in yolk with a 1px/2px/3px black sombra. The right side holds Archivo 600 links in white with a 2px yolk underline on hover, plus a round 2.25rem outlined theme toggle (sun/moon SVG) that turns yolk on hover. Below 44rem only Docs, GitHub, and the toggle remain. The footer repeats the bar's ground: four columns, yolk uppercase column labels, white links, and a hairline strip at 0.72 opacity.

### Canopy and Cords (signature)
The canopy (tarp stripes 0.8rem wide alternating lona and stripe white, a valance plate painted "Gambi hub", and a scalloped hem) spans the aisle. Each stall hangs from it by a 4px ink cord with a small clamp at the top. On load the cords rise (scaleY from 0, 720ms, staggered 95ms per stall, starting at 240ms). Once they have all risen, the hub sends one yolk token with an ink ring down the first cord (820ms). Under `prefers-reduced-motion` the cords render already drawn, no token travels, and the button lift is removed.

## Do's and Don'ts

### Do:
- **Do** set every display or headline line in Bungee at weight 400 with its stepped, zero-blur sombra (`0.02em / 0.035em / 0.05em` for display).
- **Do** put sign ink (`ink`) on egg yolk in both themes, and white on tarp blue and tomato.
- **Do** frame painted boards with the filete: a solid edge plus a 1–1.5px outline inset 5–9px.
- **Do** run dotted leaders between a label and its value on price-list style content.
- **Do** keep red to one primary action per action row and to the trust warning.
- **Do** use leaf green for anything live or anything that stays on the participant's machine.
- **Do** show interactive state with paint (yolk wash, yolk fill) and focus with the 3px yolk ring on a 6px ink halo.
- **Do** keep motion literal to the tunnel: things rise from the participant toward the hub, and work travels down. Use `cubic-bezier(0.16, 1, 0.3, 1)`, and give every animation a reduced-motion state that shows the end frame.

### Don't:
- **Don't** bring back the dark terminal dev-tool hero or the cream-and-orange editorial page.
- **Don't** use red for headings, decoration, tags, or a second button.
- **Don't** put box shadows on boards or lift cards on hover. The canopy cast, tarp fold, ledger rest, and paint button are the whole shadow vocabulary.
- **Don't** apply the hard stepped sombra to boxes. It belongs to painted letters.
- **Don't** set prose, labels, or emphasis in monospace.
- **Don't** add letter-spacing to Bungee beyond 0.02em, or set it in a weight other than 400.
- **Don't** place an eyebrow or kicker line above section titles. Section titles stand alone, and uppercase labels exist only as column headings inside a board or footer.
- **Don't** use gradients as fills. The only gradients are the stripe pattern and the scallop masks.

## Scope and Known Drift

This system currently governs the splash route (`/`) only. Its tokens are declared as `--f-*` custom properties on `:root[data-has-hero]` (light) and `:root[data-has-hero][data-theme="dark"]` (night) in `src/components/Lander.astro`. Fonts are self-hosted through @fontsource: Bungee, Archivo Variable (width axis), and JetBrains Mono Variable.

The rest of the docs site (Starlight header, sidebar, and every content page) still uses the older system in `src/styles/custom.css`: warm paper `hsl(40, 30%, 97%)`, orange accent `hsl(25, 95%, 55%)`, Inter, 2–6px radii, and soft shadow tokens. The splash route overrides that file's content-panel padding and heading colors so it can bleed edge to edge. The two systems have not been reconciled. Treat `custom.css` as legacy for any surface that adopts this world.

Known one-off values in the build that are not tokens: #fff and #000 used directly (nav text, button text, wordmark sombra, command hover), the copy-success green #5fe39a, the selected-stall state green #0b5a33, the harness-board sombra #0a1a40, and a hard-coded #11804a on the Shipping tag (it does not switch to `night-folha`; it sits on yolk in both themes).
