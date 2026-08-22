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

## Workflow surfaces

Interior routes keep the same field-book material at a smaller working scale. Proposed challenges sit in a measured register, seeded and human drafts read as adjacent paper slips, and the four Decision answers share one continuous interview. The "Use" action copies draft text into the local Decision form without changing the source. Dispatch and review remain in document order below the interview, while the live harness ledger keeps its dark terminal treatment.

Issue #75 adds the recoverable round workflow and `/orchestrator`. Rich city tiles remain the boundary of #76, and metro dependencies plus the finale remain later work. The measured empty lots on the city route are still intentional placeholders.

## Finish evidence

The base visual proof is in `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. Issue #75 responsive evidence lives in `.impeccable/review/issue-75/`. The desktop workflow keeps the measured register readable at projector scale; the 390×844 capture reflows it into one column above the fixed four-route bar.
