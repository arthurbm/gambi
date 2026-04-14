# Agent-First Redesign for Gambi CLI, Core HTTP API, and SDK

## Summary
- Redesign Gambi’s operational surface as an agent-first system across three layers together: CLI, management HTTP API, and SDK.
- Treat the management plane as a first-class public contract with explicit schemas, typed events, deterministic errors, and retry-safe operations.
- Keep the inference plane focused on OpenAI-compatible routing for applications, but tighten how it is documented and how the SDK separates inference use cases from operational control use cases.
- Do not preserve old command names, old management endpoints, or old SDK method shapes for compatibility. This is a deliberate clean break.

## Scope
- In scope:
  - `packages/cli`
  - `packages/core` management HTTP API and event contracts
  - `packages/sdk` management client and AI SDK provider boundary
  - `README.md`
  - `docs/architecture.md`
  - `apps/docs/src/content/docs/reference/cli.mdx`
  - `apps/docs/src/content/docs/reference/api.md`
  - `apps/docs/src/content/docs/reference/sdk.md`
  - `AGENTS.md` guidance where relevant
- Out of scope:
  - adding authentication/authorization
  - changing the underlying proxy semantics for OpenAI-compatible inference unless required for clearer typing or docs
  - adding a web UI
  - folding TUI into the CLI binary

## Product Positioning Decisions
- `gambi` becomes the operational CLI for humans and agents.
- `gambi-tui` remains the human-first monitoring interface.
- The HTTP API exposed by `packages/core/src/hub.ts` is the source of truth for management-plane semantics.
- The SDK becomes explicitly split by audience:
  - inference use: `createGambi()` and provider namespaces
  - operational use: management client and room event watching
- The CLI must consume the same structured contracts exposed by the management HTTP API instead of inventing ad hoc prose behavior.

## Step 0: Persist This Plan in `docs/`
- Before implementation work, add this plan to the repo docs as a working design artifact.
- Canonical file path:
  - `docs/plan-agent-first-cli-http-sdk.md`
- The implementation workflow should create the markdown file once, then duplicate it with `cp` only if a second copy is needed elsewhere for review.
- If a second copy is desired inside the site docs tree for internal visibility, use:
  - `cp docs/plan-agent-first-cli-http-sdk.md apps/docs/src/content/docs/architecture/agent-first-cli-http-sdk-plan.md`
- This plan document is an internal engineering artifact, not part of the user-facing reference set unless explicitly linked later.

## Architectural Direction

### 1. Split the surface into two clear planes
- Management plane:
  - rooms
  - participants
  - health
  - events
  - operational status
  - used by CLI, TUI, and management parts of the SDK
- Inference plane:
  - `/v1/models`
  - `/v1/responses*`
  - `/v1/chat/completions`
  - used by SDK provider and external OpenAI-compatible clients

### 2. Make the management plane explicitly machine-oriented
- Every management response must be structured.
- Every management error must contain a code, message, and hint.
- Every long-running operation must have a structured event or lifecycle representation.
- Every retry-prone operation must be idempotent where that makes operational sense.
- The CLI should render from these primitives rather than defining its own implicit contract.

### 3. Accept a clean break
- No command aliases for the old verb-only CLI.
- No compatibility aliases for old unversioned management routes.
- No preservation of old SDK client method names if the new API is materially better.
- Docs should be rewritten to present only the new shape.

## CLI Redesign

## Canonical command structure
- Replace the current flat verbs with resource-oriented commands:
  - `gambi hub serve`
  - `gambi room create`
  - `gambi room list`
  - `gambi room get`
  - `gambi participant join`
  - `gambi participant leave`
  - `gambi participant heartbeat`
  - `gambi events watch`
  - `gambi self update`
- Root help should group commands by function:
  - `Hub`
  - `Rooms`
  - `Participants`
  - `Events`
  - `Maintenance`
- Each command help must include:
  - short description
  - longer intent description
  - 3-5 concrete examples
  - output mode notes when applicable

## Global CLI contract
- Add global flags:
  - `--format text|json|ndjson`
  - `--interactive`
  - `--no-interactive`
  - `--env <name>`
  - `--verbose`
  - `--quiet`
- Add global environment variables:
  - `NO_COLOR=1`
  - `GAMBI_FORMAT`
  - `GAMBI_ENV`
  - `GAMBI_NO_INTERACTIVE=1`
- Behavioral defaults:
  - if stdout is a TTY and the command is naturally one-shot, default to `text`
  - if stdout is piped, default to `json` for one-shot commands
  - if stdout is piped for a streaming command, default to `ndjson`
  - if `GAMBI_NO_INTERACTIVE=1` or `--no-interactive` is set, never prompt
  - if `--interactive` is set, prompting is allowed where the command supports it

## Prompting rules
- `hub serve` must not auto-prompt when invoked bare; safe defaults are enough.
- `room list`, `room get`, `events watch`, and `participant heartbeat` must never auto-prompt.
- `room create` and `participant join` may prompt only when required fields are missing and `--interactive` is in effect or the default interactive policy explicitly allows it on TTY.
- Interactive mode is a renderer path, not a distinct control path.
- No command may require arrow-key-based prompt usage to be automatable.

## Output contract
- `text`:
  - compact
  - readable
  - no unnecessary decoration
  - no spinner output when piped
- `json`:
  - valid JSON object
  - stable top-level shape
  - no prose prefix/suffix
- `ndjson`:
  - one event per line
  - each line is a complete JSON object
  - suitable for agents, pipes, and log processors

## Exit codes
- `0` success
- `1` internal/unexpected failure
- `2` invalid usage or validation error
- `3` connectivity/auth/dependency failure
- `4` remote rejection or state conflict
- These codes must be implemented consistently in the CLI, informed by structured management API errors.

## Command-specific CLI behavior

### `gambi hub serve`
- Flags:
  - `--host`
  - `--port`
  - `--mdns`
  - `--dry-run`
- `--dry-run` prints the resolved startup plan and exits.
- `--format json` returns resolved host, port, mdns, bind URL, and any warnings.
- `--format ndjson` for real execution emits:
  - `started`
  - `mdns_registered`
  - `signal_received`
  - `stopped`
  - `error`
- SIGINT and SIGTERM must share a single cleanup path.

### `gambi room create`
- Flags:
  - `--name`
  - `--password`
  - `--config <path|- >`
  - `--hub`
  - `--dry-run`
- `--config -` reads JSON from stdin.
- `--dry-run` validates payload and prints the request plan without creating.
- `--format json` returns the created room envelope from the management API.

### `gambi room list`
- Flags:
  - `--hub`
  - `--sort participant-count|created-at|name`
  - `--reverse`
- Never prompt for output format.
- Default sorting in machine and human mode:
  - participant count descending
  - then created date descending

### `gambi room get`
- Required:
  - `--code`
- Returns one room plus metadata like:
  - participant count
  - password protected
  - defaults summary

### `gambi participant join`
- Flags:
  - `--room`
  - `--participant-id`
  - `--nickname`
  - `--model`
  - `--endpoint`
  - `--network-endpoint`
  - `--header`
  - `--header-env`
  - `--password`
  - `--config <path|- >`
  - `--no-specs`
  - `--dry-run`
- `--participant-id` is required in strict machine mode and optional in interactive human mode if auto-generation remains allowed.
- `--dry-run` performs:
  - endpoint validation
  - model probe
  - capability detection
  - published endpoint resolution
  - request payload preview
- Real execution in `ndjson` mode emits:
  - `prepared`
  - `registered`
  - `heartbeat_ok`
  - `heartbeat_failed`
  - `leaving`
  - `left`
  - `error`

### `gambi participant leave`
- Explicit leave operation for operational tooling.
- Flags:
  - `--room`
  - `--participant-id`
- Returns structured success or conflict/error.

### `gambi participant heartbeat`
- Explicit heartbeat command for scriptability and testing.
- Flags:
  - `--room`
  - `--participant-id`
- Useful for automation and for testing participant liveness semantics independent of the long-running join process.

### `gambi events watch`
- Flags:
  - `--room`
  - `--hub`
- `text` mode is human-readable stream.
- `ndjson` mode mirrors management SSE payloads exactly.
- This becomes the CLI bridge between operational scripts and real-time room state.

### `gambi self update`
- Flags:
  - `--manager`
  - `--yes`
  - `--dry-run`
- `--yes` bypasses confirmation.
- `--format json` returns the resolved update plan and final result object.

## Core HTTP API Redesign

## Source of truth
- Confirmed source of truth for management HTTP behavior:
  - `packages/core/src/hub.ts`
- Confirmed source of truth for transport/domain schemas:
  - `packages/core/src/types.ts`

## Canonical management API
- Define management API under `/v1` only:
  - `GET /v1/health`
  - `GET /v1/rooms`
  - `POST /v1/rooms`
  - `GET /v1/rooms/:code`
  - `GET /v1/rooms/:code/participants`
  - `PUT /v1/rooms/:code/participants/:id`
  - `DELETE /v1/rooms/:code/participants/:id`
  - `POST /v1/rooms/:code/participants/:id/heartbeat`
  - `GET /v1/rooms/:code/events`
- Remove old management route shapes rather than aliasing them.

## Management response envelopes
- Standardize on a single transport pattern:
  - success object: `{ "data": { ... }, "meta": { ... } }`
  - success list: `{ "data": [...], "meta": { ... } }`
  - action success: `{ "data": { "success": true, ... }, "meta": { ... } }`
  - error: `{ "error": { "code": "...", "message": "...", "hint": "...", "details": ... }, "meta": { "requestId": "..." } }`
- `meta` should include:
  - `requestId`
  - optional pagination fields in future
  - optional timing fields if cheap to compute
- The CLI and SDK should preserve this information rather than stripping it away prematurely.

## Management error model
- Add explicit core error codes, for example:
  - `ROOM_NOT_FOUND`
  - `PARTICIPANT_NOT_FOUND`
  - `INVALID_REQUEST`
  - `INVALID_PASSWORD`
  - `ENDPOINT_NOT_REACHABLE`
  - `LOOPBACK_ENDPOINT_FOR_REMOTE_HUB`
  - `PARTICIPANT_CONFLICT`
  - `MODEL_NOT_FOUND`
- Every error should include a machine-usable `code` plus a human-usable `hint`.
- This is the basis for deterministic CLI exit codes and better SDK exceptions.

## Room model changes
- Public room summary should include:
  - `id`
  - `code`
  - `name`
  - `hostId`
  - `createdAt`
  - `participantCount`
  - `passwordProtected`
  - `defaults`
- Add `GET /v1/rooms/:code` so clients do not need to list-and-filter.
- Keep defaults redacted for sensitive data exactly as today, but make the redaction model explicit and documented.

## Participant registration semantics
- Replace join-style semantics with idempotent upsert:
  - `PUT /v1/rooms/:code/participants/:id`
- Behavior:
  - if absent, create participant and return `201`
  - if present and materially unchanged, return `200` with same participant representation
  - if present and changed, update and return `200`
- This directly supports retries by agents and long-running automation.
- Add `updatedAt` to public participant shape for event ordering and change detection.
- Add `registrationState` or equivalent if useful for debugging repeated joins, but do not overcomplicate unless tests show need.

## Heartbeat semantics
- Use canonical route:
  - `POST /v1/rooms/:code/participants/:id/heartbeat`
- Response body includes:
  - `success`
  - `status`
  - `lastSeen`
- This is a cleaner and more self-describing route than posting a body with `{ id }`.

## Leave semantics
- Use canonical route:
  - `DELETE /v1/rooms/:code/participants/:id`
- Response should be structured and deterministic:
  - success returns `200`
  - not found returns structured `404`
- This operation must be safe to call during cleanup and retries.

## Event stream contract
- Formalize SSE payloads in core.
- Each SSE event line should carry a JSON object with:
  - `type`
  - `timestamp`
  - `roomCode`
  - `data`
- Event types:
  - `connected`
  - `room.created`
  - `participant.joined`
  - `participant.updated`
  - `participant.left`
  - `participant.offline`
- Ensure the SSE helper in `packages/core/src/sse.ts` only emits this typed event contract.
- The CLI `events watch --format ndjson` should relay these objects directly, not reinterpret them.

## Discovery implications
- Discovery remains useful primarily for human and LAN-hosted workflows.
- The discovery layer in core can stay mostly as-is, but should consume the new management endpoints and envelopes:
  - `GET /v1/health`
  - `GET /v1/rooms`
- Discovery errors should remain typed and machine-usable.

## Inference plane adjustments
- Keep inference endpoints compatible and focused:
  - `/rooms/:code/v1/models`
  - `/rooms/:code/v1/responses*`
  - `/rooms/:code/v1/chat/completions`
- Do not wrap these in the management envelope because they need to remain OpenAI-compatible.
- Do tighten docs so the distinction is explicit:
  - management plane has Gambi-native contracts
  - inference plane is OpenAI-compatible transport

## Core types and schema work

## New transport types in `packages/core/src/types.ts`
- Add:
  - `ApiMeta`
  - `ApiErrorShape`
  - `ApiSuccess<T>`
  - `ApiErrorResponse`
  - `RoomSummary`
  - `ParticipantSummary`
  - `RoomEvent`
  - `RoomEventType`
- Keep domain types separate from transport wrappers.
- Public room and participant transport types should be intentionally documented as stable contracts.

## Participant and room transport shape updates
- Room transport:
  - add `participantCount`
  - add `passwordProtected`
- Participant transport:
  - add `updatedAt`
  - keep redacted config summary
  - keep capability summary
- Make sure the internal-to-public conversion logic is centralized rather than duplicated between handlers.

## SDK Redesign

## SDK audience split
- `createGambi()` stays the inference-focused entry point for app developers using AI SDK.
- Add a clearer management client surface for apps and tools that need operational control.
- Document the rule of thumb:
  - use `createGambi()` when your app wants to send model requests
  - use the management client when your app wants to create rooms, register participants, inspect state, or watch events

## Management client shape
- Replace the current flat `createClient()` method set with namespaced operations:
  - `client.rooms.create(...)`
  - `client.rooms.list(...)`
  - `client.rooms.get(...)`
  - `client.participants.upsert(...)`
  - `client.participants.list(...)`
  - `client.participants.remove(...)`
  - `client.participants.heartbeat(...)`
  - `client.events.watchRoom(...)`
- These methods should return structured responses or typed domain objects consistently, with documented metadata handling.

## SDK error model
- Upgrade `ClientError` to include:
  - `status`
  - `code`
  - `hint`
  - `details`
  - `requestId`
- Parse these fields from the new management error envelopes.
- This makes application-level retries and user guidance much easier.

## SDK event watching
- Add typed room event watching:
  - async iterator or callback-based API
- Example target shape:
  - `for await (const event of client.events.watchRoom({ roomCode })) { ... }`
- Event payloads should mirror core `RoomEvent` exactly.
- This gives application developers a clean operational surface without scraping SSE manually.

## SDK provider boundary
- Keep `createGambi()` and protocol namespaces intact conceptually:
  - `participant(id)`
  - `model(name)`
  - `any()`
  - `openResponses`
  - `chatCompletions`
- Review `listModels()` and `listParticipants()` so their return types are consistent with the new management and inference contracts.
- If `listParticipants()` stays on the provider, make sure it consumes the new management endpoint and preserves typed error semantics.

## Documentation Plan

## User-facing docs
- Update `README.md`:
  - present the new command structure only
  - explain the split between CLI and TUI
  - add examples for JSON and NDJSON usage
  - add examples for `participant join --dry-run`
- Update `docs/architecture.md`:
  - explicitly separate management plane and inference plane
  - document the role of CLI, SDK, and TUI against these planes
- Update `apps/docs/src/content/docs/reference/cli.mdx`:
  - rewrite around the new command tree
  - remove stale `gambi monitor`
  - document output modes, stdin config, and machine usage
- Update `apps/docs/src/content/docs/reference/api.md`:
  - define canonical `/v1` management API
  - define response envelopes and error schema
  - define room event schema
  - separately document inference routes
- Update `apps/docs/src/content/docs/reference/sdk.md`:
  - explain inference provider vs management client
  - document event watching and typed errors

## Agent guidance docs
- Update root `AGENTS.md` and any CLI-local instructions as needed to state:
  - the management API is canonical for operational automation
  - CLI must remain flag-first and structured-output friendly
  - SDK management surface should map directly to core contracts
  - compatibility is not a constraint for this redesign

## Testing Strategy

## Core tests
- Route coverage for every management endpoint under `/v1`
- Envelope shape tests for:
  - success object
  - success list
  - error response
- Participant upsert tests:
  - create
  - retry same payload
  - update changed nickname/config/capabilities
- Heartbeat tests:
  - success
  - missing participant
  - stale/offline transitions
- SSE tests:
  - event names
  - payload schema
  - room scoping
  - offline event emission
- Discovery tests adjusted to new `/v1` routes and envelopes

## SDK tests
- Management client method tests for each namespace
- `ClientError` parsing tests
- Event watching tests over typed SSE payloads
- Provider regression tests for inference routes and protocol selection
- Discovery tests if helper signatures or transport assumptions change

## CLI tests
- Root help and subcommand help snapshots
- TTY vs piped stdout behavior
- `--format text|json|ndjson`
- `--interactive` and `--no-interactive`
- `--config -` stdin ingestion
- deterministic exit code mapping from structured errors
- `participant join --dry-run`
- `participant join` retry behavior with explicit `--participant-id`
- `events watch --format ndjson`

## Acceptance Criteria
- A script or agent can perform all operational workflows without prompts:
  - start hub
  - create room
  - inspect room
  - register participant
  - heartbeat participant
  - remove participant
  - watch events
  - update installation plan
- Every management command has stable JSON or NDJSON output.
- Every management HTTP endpoint has a documented envelope and typed error model.
- The SDK provides a first-class management client and a separate inference provider story.
- The docs no longer describe stale commands or mixed contracts.
- The implementation contains no fallback compatibility layers for the old CLI or old management endpoints.

## Implementation Order
1. Persist this plan to `docs/plan-agent-first-cli-http-sdk.md`, and if desired duplicate it into the docs site tree with `cp`.
2. Define transport envelopes, error schemas, and typed room events in `packages/core/src/types.ts`.
3. Refactor management handlers in `packages/core/src/hub.ts` onto the new `/v1` API shape.
4. Implement participant upsert, canonical heartbeat, room detail endpoint, and typed SSE event payloads.
5. Update discovery in core to use the new management routes and envelopes.
6. Redesign the SDK management client around namespaces, typed errors, and room event watching.
7. Align `createGambi()`-related helper methods with the new management contracts where needed.
8. Rebuild the CLI on top of the new management API contracts and output modes.
9. Rewrite README and reference docs to match the new architecture and command tree.
10. Add or update tests across core, SDK, and CLI until the new contracts are locked.

## Assumptions and Defaults
- A clean break is acceptable; no compatibility layer is required.
- The management API is Gambi-native and versioned under `/v1`.
- The inference API remains OpenAI-compatible and is documented separately from management.
- `room create` remains non-idempotent by design.
- `participant` registration becomes idempotent by design.
- JSON remains the config format in this pass; YAML is not introduced.
- TUI remains a separate package and is not folded into this redesign.