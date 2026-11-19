# Gambi Observability

This document records the observability baseline implemented in the current hub, plus the next layer of work that should happen separately.

## Current Baseline

The hub emits an operational baseline directly from the inference path.

Current signals:

- SSE room events (`GET /v1/rooms/:code/events`):
  - `llm.request`
  - `llm.complete`
  - `llm.error`
  - the participant status events (`participant.online`, `participant.busy`, `participant.offline`, ...)
- Structured log lines through Effect's logger, annotated with the room, the participant, and the request id where there is one (for example `room created`, `tunnel opened`, `tunnel dropped`, `participant status changed`, `inference request refused`, `inference request failed`). The CLI writes them to stderr, as JSON when the output is structured; `--log-level` filters them. The SDK's hosting entries hand them to `onLog`.
- Spans named after each operation (`Hub.listModels`, `Participants.dispatch`, ...). No trace exporter is wired; OTLP export stays off.

`llm.request` includes:

- `requestId`
- `participantId`
- `model` (the participant's model)
- `protocol`
- `modelSelector` (what the app asked for)

`llm.complete` includes:

- `requestId`
- `participantId`
- `model`
- `protocol`
- `status` (the HTTP status the provider answered with)
- `metrics`

`llm.error` includes:

- `requestId`
- `participantId`
- `model`
- `protocol`
- `stage` (`dispatch` or `stream`)
- `code` (the inference error code the app got, or `request_cancelled`)
- `error` (the message)

`requestId` is the id of the HTTP request on the hub: the same in the three events of one request and in the hub's log lines about it.

Participant summaries in the room snapshot and status events include the current owner's `runtimeId`. An explicit removal emits `participant.removed` with `participantId` and `reason: "left"`. A runtime that has already joined reports `left` with `reason: "removed"` to its host when it receives `4002`.

Harness sessions and artifacts are not room events. A consumer that needs them attaches to the harness participant with `client.harness.attach()` (`GET /v1/rooms/:code/participants/:id/harness/events`).

The room stream has no replay: events have no id, a subscriber more than 256 events behind loses the oldest, and each connection starts with a `room.snapshot`. Applications above the hub may keep their own event streams (the event board in `gambiarra-lab` keeps one backed by SQLite). That never makes the hub's room stream persistent.

## Metrics Model

The hub currently computes and exposes:

- `ttftMs`: milliseconds from the dispatch to the first piece of the answer's body, as the hub saw it
- `durationMs`: milliseconds from the dispatch to the end of the answer
- `inputTokens`, `outputTokens`, `totalTokens`: from the provider's `usage`
- `tokensPerSecond`: derived from the output tokens and the duration

Notes:

- Token counts come only from the `usage` of an answer that is not a stream. A streamed answer has latency metrics and no token counts.
- Metrics are hub-observed, not end-user UI-observed. They are the right baseline for room-level operations, but not a substitute for full client tracing.

## Product Positioning

This baseline belongs in the current work because it makes the tunnel-first design operable:

- it helps debug routing and participant behavior
- it gives the TUI and future tooling a stable event contract
- it provides enough signal to compare model behavior in real rooms

This is intentionally not a full observability platform yet.

## Explicitly Out Of Scope For This Phase

These should be treated as follow-up work:

- persistent metric storage and retention
- end-to-end tracing across client, hub, and participant
- request lineage across multi-step agent workflows
- aggregated dashboards and historical comparisons
- sampling, export pipelines, or OpenTelemetry integration
- unified log viewer inside the TUI

## Recommended Phase 2

The next observability phase should converge logs, metrics, and tracing around a single request identity.

Recommended direction:

1. Promote `requestId` to the canonical correlation key across CLI, SDK, hub, TUI, and future agent runtimes.
2. Persist room-level inference events for replay and comparison.
3. Add explicit streaming lifecycle milestones beyond completion, such as first token seen, provider done, and cancellation.
4. Add participant- and room-level aggregate views:
   - p50/p95 TTFT
   - p50/p95 total duration
   - throughput over time
   - error rate by participant and model
5. Define a tracing shape that can later support `gambi agents` without breaking the current hub contract.
