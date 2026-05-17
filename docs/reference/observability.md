# Gambi Observability

This document records the observability baseline implemented in the current hub, plus the next layer of work that should happen separately.

## Current Baseline

The hub now emits an operational baseline directly from the inference path.

Current signals:

- SSE room events:
  - `llm.request`
  - `llm.complete`
  - `llm.error`
- Structured console logs:
  - `console.info("[gambi] llm.request", ...)`
  - `console.info("[gambi] llm.complete", ...)`
  - `console.error("[gambi] llm.error", ...)`
- Participant tunnel connection state exposed in management payloads through `participant.connection`

`llm.request` includes:

- `requestId`
- `participantId`
- `model`
- `protocol`

`llm.complete` includes:

- `requestId`
- `participantId`
- `model`
- `protocol`
- `metrics`

`llm.error` includes:

- `requestId`
- `participantId`
- `nickname`
- `endpoint`
- `model`
- `protocol`
- `stage`
- `error`

## Metrics Model

The hub currently computes and exposes:

- `ttftMs`: time to first token or first byte observed by the hub
- `durationMs`: total request duration observed by the hub
- `inputTokens`: prompt or input tokens when returned by the provider or adapter
- `outputTokens`: completion or output tokens when returned by the provider or adapter
- `totalTokens`: provider total when available, otherwise derived from input + output
- `tokensPerSecond`: derived from `outputTokens / durationMs`

Notes:

- Non-streaming requests can usually recover token counts from provider `usage`.
- Streaming requests always produce latency metrics, but token counts may be unavailable if the upstream provider does not expose them in the stream or final payload.
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
