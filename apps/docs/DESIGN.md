---
name: Gambi
description: A collider event display for a hub that many people's agents and models dial into.
colors:
  ground: "#f1f3f5"
  panel: "#e8ecf0"
  sheet: "#fbfcfd"
  ink: "#0c131d"
  ink-2: "#3c4859"
  ink-3: "#5d6a7c"
  line: "rgb(12 19 29 / 0.14)"
  line-2: "rgb(12 19 29 / 0.24)"
  steel: "#8a9bb1"
  model: "#8a6500"
  model-strong: "#c99a12"
  harness: "#086f88"
  stop: "#c2382a"
  hub: "#0c131d"
  hub-ink: "#f1f3f5"
  primary: "#0c131d"
  primary-ink: "#f6f7f9"
  code-bg: "#16181b"
  code-ink: "#dfe6ef"
  code-dim: "#8a929d"
  ground-dark: "#17191c"
  panel-dark: "#1d2024"
  sheet-dark: "#22262b"
  ink-dark: "#eceef1"
  ink-2-dark: "#b4bac3"
  ink-3-dark: "#939aa5"
  line-dark: "rgb(236 238 241 / 0.1)"
  line-2-dark: "rgb(236 238 241 / 0.2)"
  steel-dark: "#56626f"
  model-dark: "#f2cf3a"
  harness-dark: "#4fd1e8"
  stop-dark: "#ef5a44"
  hub-dark: "#e7ecf3"
  hub-ink-dark: "#17191c"
  primary-dark: "#f2cf3a"
  primary-ink-dark: "#17191c"
  code-bg-dark: "#121417"
  syntax-keyword: "#ff8f7a"
  syntax-string: "#f2cf3a"
  syntax-function: "#6fdcf0"
  syntax-constant: "#b9c7ff"
  syntax-comment: "#858d99"
  syntax-punctuation: "#a7b0bc"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 3.7vw, 3.75rem)"
    fontWeight: 680
    lineHeight: 1.02
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 108"
  headline:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 3.6vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.04
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 116"
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 680
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 110"
  title-sm:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 700
    lineHeight: 1.3
    fontVariation: "'wdth' 110"
  lede:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(1.08rem, 1.35vw, 1.24rem)"
    fontWeight: 400
    lineHeight: 1.55
    fontVariation: "'wdth' 100"
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
    fontVariation: "'wdth' 100"
  button:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.98rem"
    fontWeight: 600
    fontVariation: "'wdth' 100"
  control:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 650
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 90"
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.09em"
    fontVariation: "'wdth' 80"
  pinned-name:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(0.8rem, 2.7cqi, 1rem)"
    fontWeight: 700
    lineHeight: 1.15
    fontVariation: "'wdth' 104"
  pinned-offer:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "clamp(0.68rem, 2cqi, 0.8rem)"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 76"
  readout:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.1
    fontFeature: "'tnum'"
  wordmark:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 118"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.92rem"
    fontWeight: 400
    fontFeature: "'liga' 0, 'calt' 0"
  mono-code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  mark: "2px"
  sm: "4px"
  label: "6px"
  tab: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  pill: "999px"
spacing:
  gutter: "clamp(1rem, 4vw, 3.5rem)"
  measure: "84rem"
  section: "clamp(4.5rem, 10vw, 8rem)"
  columns: "clamp(2rem, 5vw, 4.5rem)"
  figure: "2.4rem"
  lead: "1.1rem"
  row: "1rem"
  inline: "0.75rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 1.3rem"
    height: "2.9rem"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-ink-dark}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 1.3rem"
    height: "2.9rem"
  button-text:
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
  command-copy:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "0.85rem 1rem"
  mode-switch:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-3}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "3px"
  mode-switch-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0.38rem 0.85rem"
  mode-switch-active-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-ink-dark}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0.38rem 0.85rem"
  hub-core:
    backgroundColor: "{colors.hub}"
    textColor: "{colors.hub-ink}"
    rounded: "{rounded.pill}"
  person-label:
    textColor: "{colors.ink}"
    typography: "{typography.pinned-name}"
    rounded: "{rounded.label}"
    padding: "0.2rem 0.35rem"
  tag:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.1rem 0.45rem"
  example-tab:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.tab}"
    padding: "0.65rem 0.9rem"
  example-tab-selected:
    textColor: "{colors.ink}"
    rounded: "{rounded.tab}"
    padding: "0.65rem 0.9rem"
  event-log:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    rounded: "{rounded.lg}"
    padding: "0.9rem 1rem"
    height: "17rem"
  code-tabs:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.xl}"
    padding: "1.1rem 1.2rem"
  ledger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.xl}"
    padding: "0.95rem 1.2rem"
  warning:
    textColor: "{colors.stop}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.2rem"
  doc-link:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0.85rem 0"
---

# Design System: Gambi

## Overview

**Creative North Star: "The Event Display"**

The Gambi landing reads as a particle detector's event display: one session frozen at one instant, with each person's track arriving at the hub from the outer ring. Concentric rings carry the meaning. The thick outer band is the people's machines, the dotted rings inside it are the tunnels, and the filled disc at the centre is the hub. Your app sits outside the rings and reaches them through the hub. Color is reserved for tracks and stops. Signal yellow marks a model, cyan marks an agent (a harness), and red appears only where something stays behind on its owner's machine.

Two themes share one display. Graphite is the detector hall: a near-black ground with no glow. Paper is the same display printed: a cool off-white ground with darker inks and the same roles. Code panels and the event log stay on a dark slab in both themes.

Surfaces are flat and drawn with hairlines. One variable family, Archivo, covers all reading text, and its width axis does the work a second typeface would: expanded for headlines and names, condensed for labels pinned to the display. Mono appears only for literal text a reader could type or receive. Each section is one figure with its explanation beside or under it, so density stays moderate and the figure carries the argument.

**Key Characteristics:**
- Concentric rings and curved tracks are the drawing vocabulary for every system diagram on the page.
- Yellow, cyan, and red have fixed meanings (model, agent, stop) on a neutral ink and steel base.
- One variable sans whose width axis encodes role, plus mono for literal strings.
- Flat surfaces, hairline borders, no shadows.
- Each figure animates on one timeline and settles to a meaningful end frame.

## Colors

A neutral ink-and-steel base with three signal colors whose meanings never change. Each token maps to the CSS custom property `--e-<name>` on `:root[data-has-hero]` (paper, the default). Keys ending in `-dark` are the values the same properties take under `[data-theme="dark"]` (graphite). Tokens without a `-dark` twin keep their paper value in graphite.

### Primary
- **Signal Yellow** (`model`, `model-dark`): model tracks, the model offer under a person's name, model dots in the comparison glyphs and example stages, model spokes, the outbound packet in the section cut, and the lit top rule of the active section-cut column. In graphite it is also the primary action fill (`primary-dark`).
- **Bright Signal** (`model-strong`): the hub dot in the wordmark and text selection. In graphite it equals `model-dark`.

### Secondary
- **Track Cyan** (`harness`, `harness-dark`): agent tracks and offers, harness dots and spokes, the "Crosses" label in the inspect panel, the "Crosses the tunnel" ledger header, the return packet in the section cut, the copy-success check, and the focus ring on every interactive element.

### Tertiary
- **Stop Red** (`stop`, `stop-dark`): the key wedges on the machine band, the wall at the outer edge of the section cut and its "key added here" label, the "Stays" and "Never leaves the machine" labels, the small square after "Their machine", the trusted-network warning, and a rejected step in an example (red packet and red log line).

### Neutral
- **Ground** (`ground`, `ground-dark`): page background and the color of every text halo.
- **Panel** (`panel`, `panel-dark`): background of inline code in running text.
- **Sheet** (`sheet`, `sheet-dark`): the raised-by-tone surfaces: command button, mode switch track, ledger, and the model box in the section cut.
- **Ink** (`ink`, `ink-dark`): headlines, names, the active half of the hero headline, primary text in the comparison grid.
- **Ink 2** (`ink-2`, `ink-2-dark`): ledes, section leads, body copy in cells and layers, nav links at rest.
- **Ink 3** (`ink-3`, `ink-3-dark`): uppercase labels, ring labels, the inactive half of the hero headline, the "one person" side of the comparison, footer strip.
- **Line** (`line`, `line-dark`) and **Line 2** (`line-2`, `line-2-dark`): 1px rules. Line separates rows; Line 2 marks a group's top edge, control borders, and spokes in the example stages.
- **Steel** (`steel`, `steel-dark`): ring strokes, the machine band at 30% opacity, tick marks, and comparison glyph rings.
- **Hub** (`hub`, `hub-dark`) on **Hub Ink** (`hub-ink`, `hub-ink-dark`): the hub disc and its label. On paper the hub is ink; in graphite it is a pale disc with dark text.
- **Primary** (`primary`) on **Primary Ink** (`primary-ink`): on paper the primary button and the active mode-switch segment are filled with ink. The selected example tab's underline also uses primary, so it is ink on paper and signal yellow in graphite.
- **Code slab** (`code-bg`, `code-bg-dark`, `code-ink`, `code-dim`): code tabs and the event log, dark in both themes. The `syntax-*` tokens color code on that slab; event names in the log use `syntax-function` and rejected steps use `syntax-keyword`.

### Named Rules
**The Track Color Rule.** Yellow means a model and cyan means an agent, wherever they appear: tracks, dots, offers, spokes, packets. Neither color is used for decoration or emphasis unrelated to a participant.

**The Red Stops Rule.** Red marks the place where something stops: the key wedges, the wall in the section cut, what never leaves the machine, the trusted-network warning, a rejected step. Nothing else on the page is red.

**The Printed Display Rule.** Paper is the same display printed. Every role keeps its meaning across themes and only the values shift for contrast. Code panels and the event log stay dark in both themes.

## Typography

**Display Font:** Archivo Variable (with system-ui, sans-serif), loaded with its width axis from `@fontsource-variable/archivo/wdth.css`
**Body Font:** Archivo Variable, same file
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, monospace), ligatures off

**Character:** One grotesque stretched and squeezed for every role. Expanded heavy weights read calm and engineered at headline size; condensed caps read like labels printed on an instrument.

### Hierarchy
- **Display** (680, clamp(2.3rem, 3.7vw, 3.75rem), 1.02, width 108, tracking -0.03em): the hero headline only. It is two block lines; the line that matches the display's current mode is ink and the other is ink 3, crossfading over 600ms.
- **Headline** (650, clamp(1.9rem, 3.6vw, 3rem), 1.04, width 116, tracking -0.025em, max 20ch, balanced): section titles.
- **Title** (680, 1.45rem, width 110): example titles. **Small title** (650 to 700, 1.08rem, width 106 to 110): comparison row questions and section-cut layer names; the warning title uses 700 at 1rem, width 108.
- **Lede** (400, clamp(1.08rem, 1.35vw, 1.24rem), 1.55): the hero lede at 52ch. Section leads use clamp(1.06rem, 1.3vw, 1.2rem) at 62ch.
- **Body** (400, 1.0625rem, 1.55, width 100): the page base. Cells, layers, ledger rows, and doc-link notes step down to 0.92 to 0.98rem; the inspect panel uses 0.86rem.
- **Label** (600 to 700, 0.7 to 0.78rem, width 76 to 80, tracking 0.08 to 0.09em, uppercase): readout names, comparison column headers, ledger headers, footer group labels, tags, inspect keys. Ring labels in the SVG use the same recipe at width 76 and tracking 0.14em.
- **Pinned name and offer**: names at 700, width 104; offers at 600, width 76, tabular numerals. Both are sized in container query units so they scale with the board.
- **Readout** (650, 1.5rem, tabular numerals, ink; 1.25rem under 44rem): the display's counters.
- **Mono** (JetBrains Mono): 0.86em inline in prose on a panel chip, 0.92rem in the command button, 0.86rem at 1.65 line height in code tabs, 0.82rem in the event log.

### Width axis
The width axis (`wdth`) is set with `font-variation-settings` on every role:

| Width | Role |
|---|---|
| 76 to 80 | Uppercase labels, ring labels, offers pinned to tracks |
| 90 to 96 | Controls: mode switch (90), example tabs (96) |
| 100 | Running text, ledes, buttons |
| 104 to 110 | Names, doc-link titles, small titles, example titles, warning title, hub label |
| 108 | Hero headline |
| 116 to 118 | Section titles (116), wordmark and footer mark (118) |

### Named Rules
**The Width Axis Rule.** Width encodes role. Condensed widths (76 to 80) are for uppercase labels and offers pinned to a figure; 100 is for anything read as prose; expanded widths (104 to 118) are for names, titles, and the wordmark.

**The Literal Mono Rule.** Mono is reserved for strings a reader could type or receive verbatim: the install command, the session code, frame and event names, endpoints, paths, and snippets. Labels that only look technical stay in Archivo.

**The Tabular Count Rule.** Anything that counts or changes in place uses tabular numerals: readouts, the 1 → N switch, and model offers.

## Layout

Content sits in one centered measure (`spacing.measure`) with a fluid side gutter (`spacing.gutter`); nav, sections, and footer all share them. Every section starts with `spacing.section` of top padding and no bottom padding, so sections are separated by space alone. The footer sits `clamp(5rem, 10vw, 8rem)` below the last section behind a 1px Line. Section leads sit `spacing.lead` under the title, and the section's figure starts 2.4 to 2.6rem under the lead.

- **Hero:** two columns at 0.82fr and 1fr with a gap of clamp(2rem, 4vw, 4.5rem), vertically centered, with a minimum height of min(100svh − 4.5rem, 58rem). The display board is square at min(100%, 100svh − 20rem, 46rem) and never smaller than 20rem, so the full ring, its header, and its readouts fit in the first viewport.
- **Comparison:** a three-column grid (0.8fr question, 1fr one person, 1fr many people), rows separated by Line, each cell a 5.25rem glyph beside its sentence.
- **Section cut:** the drawing spans the full measure in a 1000 by 200 viewBox, and the four explanation columns below (Your app, Hub, Tunnel, Their machine) start where the cut's zones start (every 250 units).
- **Examples:** tabs across the top, then copy at 0.62fr and the stage at 1.38fr; inside the stage, diagram and log split 1.15fr and 0.85fr.
- **Code:** copy and doc links at 0.85fr, code tabs at 1.15fr.
- **Footer:** brand at 1.6fr and three link columns at 1fr, then a strip with the gambiarra note and build date.

### Breakpoints
- **68rem:** the hero stacks to one column and drops its minimum height; the footer becomes three columns with the brand above.
- **60rem:** the examples body stacks.
- **56rem:** the section cut's labels grow to 40 viewBox units so they stay legible on the scaled strip, "key added here" hides, and the layers stack; the code section stacks.
- **52rem:** the comparison grid drops its header row, puts the question on its own line, and labels each cell "One person" or "Many people" with a condensed caption; glyphs shrink to 3.6rem.
- **44rem:** Patterns and SDK leave the nav, command buttons go full width and their command fades at the right edge to show it scrolls, the footer becomes two columns, ring labels grow to stay legible on the scaled board, readouts shrink, and the ledger turns each row into a stacked card with inline labels.
- **40rem:** the example stage and its log stack, the log shortens to 13rem, and the example tab row fades at the right edge to show it scrolls.

### Named Rules
**The Zone Alignment Rule.** When a figure explains layers, each layer's text sits under the part of the drawing it explains. The section cut's columns start exactly where its zones start.

## Elevation & Depth

The system is flat and uses no drop shadows. Depth comes from three things: 1px hairlines (Line for row separators, Line 2 for group edges and control borders), tonal steps from ground to panel to sheet, and the dark code slab. The only `box-shadow` on the page is `inset 0 -2px 0`, used as the selected-tab underline in the example and code tabs. Inside the figures, depth is concentric: the machine band in steel at 30% opacity, rings in steel at 75%, tracks in signal colors above them, and the solid hub disc on top.

### Named Rules
**The Hairline Rule.** Separate things with a 1px line or a tonal step. Surfaces never get drop shadows, glows, or blur.

## Shapes

Anything that depicts the system is drawn with circles and arcs: rings, the hub disc, participant dots, arc-shaped key wedges, and the curved slice in the section cut. UI containers are rectangles with soft corners that grow with the container: `rounded.sm` for inline code and the focus outline, `rounded.label` for the person hit area and the model box in the cut, `rounded.tab` for the top corners of example tabs, `rounded.md` for buttons and the command button, `rounded.lg` for the warning and the event log, `rounded.xl` for the ledger and code tabs. Pills (`rounded.pill`) are for the mode switch, tags, and the theme toggle. `rounded.mark` is the small red square after "Their machine".

Ring strokes follow one grammar: solid for the machine edges and dotted for tunnels (2 on, 8 off in the display). Apps are never drawn as a ring. Tick marks run around the machine band every 5°, with a longer tick every 30°. The wordmark glyph is the display reduced to a ring, a yellow hub dot, and three tracks.

### Named Rules
**The Same Bend Rule.** In the ring display and the example stages, every track is one quadratic curve from the machine ring into the hub, with its control point turned the same 14° and its end turned further the same way. All tracks swirl the same way, so no two ever cross.

**The Ring Grammar Rule.** Line style names the ring: solid for machines, dotted for tunnels. Your app is never a ring; where it is drawn at all, it is a small box outside the rings. The same grammar carries into the section cut, the example stages, and the link card.

## Components

### Ring display (signature)
The hero figure. A square board holds an SVG in a 1160-unit viewBox centred on the hub, built from `src/components/lander/geometry.ts`: machine ring at radius 392 with a 30-unit steel band, dotted tunnel rings at 300 and 210, and the hub at 46 with a faint outer ring. Six tracks start at 60° spacing on the machine ring; each owner has a red key wedge on the band at the track's origin. Ring labels (machines, tunnels) sit on one radial line at -79°, haloed in ground. Above the board: a condensed "Session" label, the session code in mono, an "example" tag, and the mode switch. Below it: three readouts in ink (People, Machines, Key holders) and an inspect panel. Picking a person dims every other track to 14% opacity, thickens theirs from 3.4 to 5 units, sends one comet round trip down it, and shows what crosses their tunnel and what stays home.

### Mode switch
A pill track in sheet with a Line 2 border and 3px inset, holding two segments: "1 → N" and "N ↔ N". The pressed segment fills with primary (ink on paper, signal yellow in graphite); the other is ink 3. Text is condensed (width 90) with tabular numerals. Switching morphs every track's origin between a tight bundle at the bottom ("You · 6 agents") and six separate people, flips the readouts between 1 and 6 halfway through, and moves the hero headline's emphasis.

### Person labels and text halos
Each person is a button pinned over the board at their angle on the label radius: name above, offer below. The offer takes the track color of what they bring. Text that sits over rings or tracks always carries a ground-colored halo: HTML labels use `-webkit-text-stroke: 0.32em` in ground with `paint-order: stroke fill`; SVG labels use `paint-order: stroke` with an 8-unit (ring labels) or 6-unit (cut labels) ground stroke; dots in the example stages carry a 3-unit ground stroke. Hover shows a Line 2 underline under the name; the pressed person gets a 2px underline in their track color.

### Comets
A comet is a bright head (14 units long, 9 wide) and a dimmer tail (110 units, 6 wide, 25 to 40% opacity) drawn as dashes on a copy of the track path, in the track's color. Outbound comets leave the hub for the machine; when one arrives, that owner's key wedge dims and returns over 520ms, which is where the key is added. The answer comet runs back to the hub 1250ms later. Each leg takes 1100ms on the in-out curve.

### Comparison grid and mini-ring glyphs
Four questions in rows, compared across "One person, many agents" and "Many people, many agents". The one-person side is ink 3 with its glyph at 62% opacity; the many-people side is ink. Each cell leads with a 5.25rem glyph in a -60 to 60 viewBox drawn from the same vocabulary as the display: a steel ring at radius 44, an ink hub dot, and colored participant dots. The four glyphs show where agents run (dots clustered at the bottom versus spread around the ring), whose keys pay (one long red arc versus six short ones), where an agent can write (one dashed box versus six small boxes on the ring), and who opens the connection (spokes pointing out from the hub versus spokes pointing in from each machine).

### Section cut
A slice through the display, flattened into a 1000 by 200 strip and read left to right: your app as a small sheet box outside the rings, then the hub disc with its faint outer ring, then three dotted tunnel arcs, the steel machine band, and an 8-unit red wall, all drawn around the hub and clipped to its right side only, and finally the model box with "key added here" in red under it. A straight Line 2 path runs from the app box to the model. A single packet (radius 11) runs the loop app → hub → model → hub → app: yellow on the way out, cyan on the way back. As it crosses each zone, the matching column's 2px top rule lights in the packet's color; at the machine the band brightens to 60% and the model box's stroke turns red. Under the cut, a ledger (sheet, `rounded.xl`, Line borders) sets "Crosses the tunnel" in cyan against "Never leaves the machine" in red, row by row.

### Example tabs, stage, and event log
A scrolling row of text tabs (width 96, ink 3) over a Line 2 rule; the selected tab turns ink with a 2px underline in primary. Arrow keys move between tabs. The selected panel shows a title, a short body at 46ch, and a link with a chevron that nudges 3px on hover. A tag reading "Being explored" (dashed border) marks the example that is not yet a guide. The stage is a small event display in the hero's vocabulary: a 16-unit steel machine band at radius 140 between two steel hairlines, a dotted tunnel ring at 90, a red key arc at each seat, curved same-bend tracks from each seat into the hub disc, and participant dots in track colors with name and offer labels at radius 184. Tracks rest at 50% opacity and go full while a token is on them. Tokens follow the track in 760ms on the in-out curve; a dot grows from 10 to 14 units for 380ms when a request lands. Beside it, the event log is a 17rem dark slab whose lines stack from the bottom and fade out at the top through a 2.5rem mask on the list, so the slab keeps a clean edge; each line is an event name in `syntax-function` mono and a plain description. The loop pauses when the section leaves the viewport or the tab is hidden.

### Code tabs
A dark slab (`code-bg`, `rounded.xl`, Line border) with a tab bar ("Models", "Agents") over a hairline in white at 8%. Tabs are dim (`code-dim`) and the selected one is `code-ink` with a 2px signal-yellow underline. Code is JetBrains Mono at 0.86rem and 1.65 line height, colored by the `syntax-*` tokens through Astro's `css-variables` theme. Under 44rem lines wrap instead of scrolling.

### Doc links
A list framed by a Line 2 top rule, each row split by Line: a title (650, width 104, ink), a note under it (0.92rem, ink 3), and a chevron in ink 3 at the right. On fine-pointer hover the chevron moves 3px right and darkens to ink.

### Command copy button
The install command as a button: sheet surface, Line 2 border, `rounded.md`, a muted `$` prompt, the command in mono, and a copy icon. Clicking copies to the clipboard and crossfades the copy icon to a cyan check for 1.6s, with a polite live-region message ("Copied" or a fallback instruction). Hover darkens the border to ink 3; press scales to 0.98. The command scrolls inside the button without a scrollbar; under 44rem the button goes full width and the command fades at its right edge.

### Buttons
- **Shape:** `rounded.md`, 2.9rem tall, 1.3rem side padding, 600 weight.
- **Primary:** filled with primary on primary ink: ink on paper, signal yellow with dark text in graphite. One per view: "Get started" in the hero and "Read the quick start" in the closing section.
- **Hover / press:** hover mixes 14% of ink 3 into the fill over 160ms; press scales to 0.97.
- **Text link:** "How it works" sits beside the primary as a plain 600-weight link in ink 2 with a down chevron; it jumps to the comparison section, and the chevron drops 2px on fine-pointer hover.

### Warning
The trusted-network warning: a 1px border of stop at 55% strength, a fill of stop mixed 7% into ground, `rounded.lg`, a stroked triangle icon in stop, a title in stop (700, width 108), and body text in ink 2 with an inline link in ink. It is the only tinted surface on the page.

### Tags
Small pill labels in the label recipe: "example" next to the session code (solid Line 2 border, ink 3) and "Being explored" next to an example title (dashed ink 3 border, ink 2 text). Tags state the status of what they sit next to.

### Navigation and footer
The nav is a plain bar over a Line rule: the wordmark (ring glyph with a yellow hub dot, Archivo 700 at width 118) on the left, then Docs, Patterns, SDK, GitHub in ink 2 (ink on hover), and a round theme toggle with a sun or moon icon. The footer repeats the wordmark at 1.3rem with a one-line tagline, three link columns under condensed uppercase labels, and a strip in ink 3.

### Motion
- **Easing:** `ease-out` for entrances and state changes; `ease-in-out` for anything that travels (the mode morph, comets, packets, example tokens). The in-out curve is solved numerically in script so rAF-driven morphs match the CSS curve.
- **Durations:** 160ms for color and border hovers; 180 to 200ms for icon swaps and chevron nudges; 220 to 260ms for content entering (inspect card, example panel, log line, readout flip); 600ms for the headline emphasis; 700 to 900ms for the ring layer and track draw; 1100ms per comet leg; 1500ms for the mode morph.
- **Hover gating:** movement on hover only runs under `(hover: hover) and (pointer: fine)`. Color changes on hover apply everywhere.
- **Intro sequence:** on load, the display starts in the 1 → N state. The ring layer fades in and settles from 96% scale (700ms opacity, 900ms scale). Key wedges fade in at 250ms. The six tracks draw inward from the machine ring to the hub over 900ms each, starting at 300ms and staggered by 45ms, because the participant opens the tunnel. At 1350ms one comet leaves the hub down every track, staggered by 40ms, because the hub dispatches. At 2900ms, unless the visitor has already used the switch or a person, the display morphs to N ↔ N over 1500ms, the bundle peeling open from the middle outward, with readouts flipping at 45%. After that an ambient round trip runs on a random track every 1.5s, or on the focused person's track, only in N ↔ N, only while the display is on screen and the tab is visible.
- **Reduced motion and no JS:** the page renders the end frame. The intro's hidden starting state only applies when JS has marked the document and the visitor allows motion. With reduced motion the display shows N ↔ N at rest, the switch changes state instantly, and comets and the ambient loop never run; the section cut shows its static drawing without the packet; the examples show the full event log for the selected tab.

### Named Rules
**The One Timeline Rule.** Each figure animates from one clock. The display's tracks, wedges, labels, and readouts all read one morph value; the section cut's column highlights read the packet's position; an example's tokens and log lines advance through one sequential step list. A figure never runs two independent loops.

**The Inward Outward Rule.** Tracks draw inward, from machine to hub, because the participant opens the connection. Requests travel outward, from hub to machine, because the hub dispatches into the tunnel; answers return inward.

**The End Frame Rule.** Without JS or with reduced motion, every figure shows its final, meaningful state. Animation plays into that state and never replaces it.

**The One Primary Rule.** A view has one filled primary button. Anything else beside it is a text link or the command button.

## Do's and Don'ts

### Do:
- **Do** draw new system diagrams from the ring vocabulary in `geometry.ts`: machines on the outside, tunnels between, the hub at the centre, and your app outside the rings.
- **Do** color every track, dot, spoke, packet, and offer by what the participant brings: signal yellow for a model, cyan for an agent.
- **Do** put a ground-colored halo behind any text that sits over rings or tracks (`paint-order: stroke` in SVG, `-webkit-text-stroke` with `paint-order: stroke fill` in HTML).
- **Do** set uppercase labels condensed (width 76 to 80) with 0.08 to 0.09em tracking, and headlines expanded (width 108 to 118) with negative tracking.
- **Do** keep one filled primary button per view and pair it with a text link or the command button.
- **Do** separate content with 1px Line or Line 2 rules and tonal steps between ground, panel, and sheet.
- **Do** render the end frame first, then animate into it, and pause any loop when its figure is off screen or the tab is hidden.
- **Do** use tabular numerals for counts and readouts, and keep mono for literal commands, frames, events, and code.

### Don't:
- **Don't** use red for anything except a stop: keys, logins, what stays on a person's machine, the trusted-network warning, a rejected step.
- **Don't** add drop shadows, glows, blur, or gradient fills to surfaces.
- **Don't** let tracks in a ring figure cross or bend in different directions.
- **Don't** run two independent animation clocks inside one figure.
- **Don't** set labels, headings, or numbers in mono when they are not literal strings.
- **Don't** put a second filled button next to the primary.
- **Don't** use yellow or cyan for decoration or for emphasis unrelated to a participant.
- **Don't** reintroduce a hand-painted or playful look; PRODUCT.md binds the visual to serious and direct.

## Scope and known drift

- **Splash route only.** This world applies to the landing at `/` only. `src/components/Hero.astro` renders `Lander.astro` when the slug is empty, and the tokens are scoped to `:root[data-has-hero]`. Every docs page still uses Starlight with the legacy `src/styles/custom.css` (its own `--gambi-*` variables and older animations) until a follow-up docs pass adopts these tokens.
- **Hard-coded code-slab colors.** The code-tab underline, event names and rejected steps in the log, the code scrollbar, and the selection text color are written as literal hex values in components instead of referencing tokens. The values match `model-dark`, `syntax-function`, `syntax-keyword`, `steel-dark`, and `hub-ink-dark`.
- **Link card.** `og/card.html` redraws the display in its N ↔ N graphite state with numbers copied by hand from `geometry.ts`, so the two can drift apart. Re-render `public/og.png` after any geometry or palette change.
