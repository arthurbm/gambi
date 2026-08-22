# Board design record

The board is a map-led field book, not a dashboard. Its reference is the approved cadastral composition at `.impeccable/mocks/spec68/comp-2-map-led.png`, selected in the direction round seeded by `80af7246`. The complete six-part direction contract remains embedded in `index.html`; `.impeccable/surfaces/apps-board-web.md` is the surface brief.

## Hierarchy

On a projector, the city plan is the dominant field. A bound squad ledger sits to its left, the current phase and room state sit in the right margin, and the append-only event ledger runs below. Borders, parcel numbers, survey lines, and architectural corner marks establish structure. Controls support that structure rather than creating a grid of decorative cards.

On phones, the city stays first. Navigation becomes a fixed bottom route bar; squads, phase details, and the audit list follow in document order. The audit table becomes a labelled list that preserves sequence, event, author, and time. Interactive controls on the member and admin routes have a minimum 44px touch target.

## Material and type

- `#ECE0CE` is the page ground and `#F4E9D4` the plan sheet.
- `#25322E` is drafting ink; `#38524B` marks live and selected state.
- `#B94031` is reserved for destructive or irreversible state, and `#CDAA68` measures parcel boundaries.
- Inter carries prose. JetBrains Mono carries headings, labels, measurements, identifiers, and ledger language.
- Surfaces are flat and tinted. Paper character comes from linework and spacing, never a simulated CSS gradient. This release ships no raster asset.

## Interaction

One short survey-sheet unfold introduces the city without moving readable content afterward. Reduced-motion preferences collapse it to an effectively static transition. Keyboard focus uses the survey-teal ring. The room register reports the real SSE state as connected, reconnecting, or offline through a polite live region. Admin phase changes are disabled before state is known and require an explicit current-to-next confirmation because the audit transition cannot be undone.

## Issue boundary

Issue #73 renders recoverable lobby state: people, squad membership, phases, configuration, and audit events. `hostedHarnessCount` is stored now, but harness spawning, assignment, steerer rotation, `/squad/:id`, harness streams, and richer city tiles belong to #74 and later work. The measured empty lots are intentional placeholders, not missing #73 UI.

## Finish evidence

The final visual proof is in `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. The desktop capture follows the approved map topology; the 390×844 capture keeps the city first with no horizontal overflow. The Impeccable finish review informed the complete mobile ledger, guarded admin transitions, connection-state copy, and mobile touch targets.
