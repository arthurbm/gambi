---
title: Observability Reference
description: SSE events, metrics, and participant connection state emitted by the Gambi hub.
---

The Gambi hub emits an operational baseline for inference activity. This page documents the public contract.

Observability is consumed through the management SSE stream:

```text
GET /v1/rooms/:code/events
```

Or through the SDK:

```ts
for await (const event of client.events.watchRoom({ roomCode })) {
  // ...
}
```

## Event types

Three inference-related event types are emitted on every request that reaches routing.

| Event | When it fires |
| --- | --- |
| `llm.request` | routing has selected a participant and the hub is about to send the tunnel request |
| `llm.complete` | the participant returned a final response or the stream ended cleanly |
| `llm.error` | the request failed in any stage — routing, tunnel transport, or provider |

Management-level events (`participant.joined`, `participant.updated`, `participant.left`, `participant.offline`, `room.created`) are documented in the [API Reference](/reference/api/) and [SDK Reference](/reference/sdk/#clienteventswatchroom-roomcode-signal-).

### `llm.request`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | correlation identifier shared across `llm.request`, `llm.complete`, and `llm.error` |
| `participantId` | `string` | participant selected by routing |
| `model` | `string` | model name as seen by the hub |
| `protocol` | `"openResponses" \| "chatCompletions"` | surface the request used against the hub |

### `llm.complete`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | same as in `llm.request` |
| `participantId` | `string` | participant that produced the response |
| `model` | `string` | model name |
| `protocol` | `"openResponses" \| "chatCompletions"` | surface of the request |
| `metrics` | `Metrics` | see below |

### `llm.error`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | correlation identifier |
| `participantId` | `string \| null` | participant, when one was selected |
| `nickname` | `string \| null` | participant nickname, when known |
| `endpoint` | `string \| null` | participant-local provider endpoint, when known |
| `model` | `string \| null` | model name, when known |
| `protocol` | `"openResponses" \| "chatCompletions"` | surface of the request |
| `stage` | `string` | where the failure happened (`routing`, `tunnel`, `provider`, etc.) |
| `error` | `string` | human-readable failure message |

## Metrics

`llm.complete.metrics` carries six fields:

| Field | Unit | Source | Notes |
| --- | --- | --- | --- |
| `ttftMs` | milliseconds | hub-observed | time to first token (streaming) or first byte (non-streaming) |
| `durationMs` | milliseconds | hub-observed | total request time |
| `inputTokens` | tokens | provider `usage` | may be absent when the upstream provider does not expose token counts |
| `outputTokens` | tokens | provider `usage` | may be absent when streaming without usage reporting |
| `totalTokens` | tokens | provider `usage` or derived | falls back to `inputTokens + outputTokens` when available |
| `tokensPerSecond` | tokens/second | derived | `outputTokens / durationMs`, only present when `outputTokens` is known |

### What you can rely on

- `ttftMs` and `durationMs` are always present for successful requests, because the hub observes them directly.
- Token counts depend on the upstream provider. Streaming endpoints that do not include a `usage` object will leave them unset.
- Metrics are **hub-observed**. They do not include latency experienced on the client side of the HTTP request, and they do not replace end-to-end distributed tracing.

## Participant connection state

Every management payload that includes a participant exposes a `connection` block:

| Field | Type | Description |
| --- | --- | --- |
| `kind` | `"tunnel"` | transport in use |
| `connected` | `boolean` | whether the tunnel is currently open |
| `lastTunnelSeenAt` | `string \| null` | ISO timestamp of the most recent tunnel activity |

This appears in:

- `PUT /v1/rooms/:code/participants/:id` responses
- `GET /v1/rooms/:code/participants` list entries
- `participant.joined` / `participant.updated` SSE payloads
- `ParticipantSummary` returned by the SDK

Combine `connection.connected` with the participant's `status` field to distinguish "registered but offline" from "live and ready to handle a request".

## Structured logs

The hub also emits structured console logs parallel to the SSE events:

- `[gambi] llm.request`
- `[gambi] llm.complete`
- `[gambi] llm.error`

These are intended for the operator running the hub; the SSE stream is the canonical surface for programmatic consumers.

## What is out of scope

This baseline is intentionally narrow. The following are not provided by the hub today:

- persistent storage or replay of past events
- aggregated dashboards (p50/p95 latency, error rate over time)
- sampling or export pipelines (OpenTelemetry, Prometheus)
- end-to-end tracing across client, hub, and participant

You can build any of these on top of the SSE stream — the event contract is stable enough for that. Treat this reference as the floor, not the ceiling.
