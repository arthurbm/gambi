# Board design record

The board is a map-led field book, not a dashboard. Its reference is the approved cadastral composition at `.impeccable/mocks/spec68/comp-2-map-led.png`, selected in the direction round seeded by `80af7246`. The complete six-part direction contract remains embedded in `index.html`; `.impeccable/surfaces/apps-board-web.md` is the surface brief.

## Hierarchy

On a projector, the city plan is the dominant field. A bound squad ledger sits to its left, the current phase and room state sit in the right margin, and the append-only event ledger runs below. Borders, parcel numbers, survey lines, and architectural corner marks establish structure. Controls support that structure rather than creating a grid of decorative cards.

On phones, the city stays first. Navigation becomes a fixed bottom route bar above tile content (`z-index: 20`), with 58px of page clearance reserved for it; squads, phase details, and the audit list follow in document order. The audit table becomes a labelled list that preserves sequence, event, author, and time. Interactive controls on the member and admin routes have a minimum 44px touch target.

## Material and type

- `#ECE0CE` is the page ground and `#F4E9D4` the plan sheet.
- `#25322E` is drafting ink; `#38524B` marks live and selected state.
- `#B94031` is reserved for destructive or irreversible state, and `#CDAA68` measures parcel boundaries.
- Inter carries prose. JetBrains Mono carries headings, labels, measurements, identifiers, and ledger language.
- Surfaces are flat and tinted. Paper character comes from linework and spacing, never a simulated CSS gradient. This release ships no raster asset.

## Interaction

Motion is reserved for one rare event: a newly published tile replacing a measured lot. Its opacity and small vertical offset settle over 200ms with a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`) so the state change is perceptible without making the replacement jarring. Do not add a city-wide entrance animation or use `transition-all`. Reduced-motion preferences remove the transform and keep only the 200ms opacity fade. Keyboard focus uses the survey-teal ring. The room register reports the real SSE state as connected, reconnecting, or offline through a polite live region. Admin phase changes are disabled before state is known and require an explicit current-to-next confirmation because the audit transition cannot be undone.

## Workflow surfaces

Interior routes keep the same field-book material at a smaller working scale. Proposed challenges sit in a measured register, seeded and human drafts read as adjacent paper slips, and the four Decision answers share one continuous interview. The "Use" action copies draft text into the local Decision form without changing the source. Dispatch and review remain in document order below the interview, while the live harness ledger keeps its dark terminal treatment.

Issue #75 adds the recoverable round workflow and `/orchestrator`. Issue #76 turns the measured lots into durable publication slots. A valid accepted artifact can occupy a squad parcel in a sandboxed tile viewport; empty, invalid, or runtime-broken artifacts leave the parcel's measured lot and squad plate intact. Tile version, harness, and model provenance stay visible without competing with the city plan. Metro dependencies and the finale remain later work.

## Finish evidence

The base visual proof is in `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. Issue #75 responsive evidence lives in `.impeccable/review/issue-75/`. Issue #76 proof is in `.impeccable/review/hero-repro.png` and `.impeccable/review/issue-76/mobile-city-tabs.png`, with admin, member, and steerer states beside them under `.impeccable/review/issue-76/`. The 1600×1000 desktop capture follows the approved map topology; the 380×822 mobile capture keeps the two-column city first, preserves broken and empty lots, and shows the fixed route bar above the tile content.
