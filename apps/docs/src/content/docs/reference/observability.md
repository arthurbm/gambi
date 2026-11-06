---
title: Observability
description: SSE events, metrics, and participant connection state emitted by the Gambi hub.
---

The hub reports inference activity and participant state as room events. This page documents that public contract.

Read the events from the management SSE stream:

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

The hub emits three inference events once routing has selected a participant.

| Event | When it fires |
| --- | --- |
| `llm.request` | routing has selected a participant and the hub is about to send the tunnel request |
| `llm.complete` | the participant returned a final response or the stream ended cleanly |
| `llm.error` | dispatching to the selected participant failed, or its response stream broke |

A request that fails routing (no available participant, busy participant, closed tunnel, harness participant) gets an HTTP error and emits no event. See [Inference errors](/reference/api/#inference-errors).

Management-level events (`participant.joined`, `participant.updated`, `participant.left`, `participant.offline`, `room.created`) are documented in the [API reference](/reference/api/) and [SDK reference](/reference/sdk/#clienteventswatchroom-roomcode-signal-).

Harness participants add three lifecycle signals:

| Event | Data |
| --- | --- |
| `harness.session.opened` | `participantId`, `sessionId` |
| `harness.session.closed` | `participantId`, `sessionId` |
| `harness.artifact` | `participantId`, `sessionId`, incremental `version` |

Artifact file content is not placed on SSE. Consume the attach channel when the actual artifact is required.

The session events confirm that the local ACP session opened or closed. They do not include ACP prompts, responses, local authentication, or workspace files. `harness.artifact` reports only that a new artifact version is available. Use `client.harness.attach()` to receive its files.

Application-local event streams are outside this public hub contract. For
example, an application can persist its own audit sequence in a database.
That does not add storage or replay to `/v1/rooms/:code/events`.

### `llm.request`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | correlation identifier shared across `llm.request`, `llm.complete`, and `llm.error` |
| `participantId` | `string` | participant selected by routing |
| `model` | `string` | the `model` value from the request body, that is, the selector (`*`, `model:llama3`, a participant ID) |
| `protocol` | `"openResponses" \| "chatCompletions"` | API the request used against the hub |

### `llm.complete`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | same as in `llm.request` |
| `participantId` | `string` | participant that produced the response |
| `model` | `string` | model name the participant serves |
| `protocol` | `"openResponses" \| "chatCompletions"` | API of the request |
| `metrics` | `Metrics` | see below |

### `llm.error`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | correlation identifier |
| `participantId` | `string` | participant selected by routing |
| `nickname` | `string` | participant nickname |
| `endpoint` | `string` | participant-local provider endpoint |
| `model` | `string` | the request's `model` value for `dispatch` errors; the participant's model name for `stream` errors |
| `protocol` | `"openResponses" \| "chatCompletions"` | API of the request |
| `stage` | `"dispatch" \| "stream"` | `dispatch`: sending the request through the tunnel or reading the response failed. `stream`: a streaming response broke after it started. |
| `error` | `string` | human-readable failure message |

## Metrics

`llm.complete.metrics` carries six fields:

| Field | Unit | Source | Notes |
| --- | --- | --- | --- |
| `ttftMs` | milliseconds | hub-observed | time to first token (streaming) or first byte (non-streaming) |
| `durationMs` | milliseconds | hub-observed | total request time |
| `inputTokens` | tokens | provider `usage` | may be absent when the upstream provider does not expose token counts |
| `outputTokens` | tokens | provider `usage` | may be absent when streaming without usage reporting |
| `totalTokens` | tokens | provider `usage` or derived | falls back to `inputTokens + outputTokens` when either is known |
| `tokensPerSecond` | tokens/second | derived | `outputTokens / durationMs * 1000`; present only when `outputTokens` is known and `durationMs` is above zero |

### What you can rely on

- `ttftMs` and `durationMs` are always present for successful requests, because the hub measures them.
- Token counts depend on the upstream provider. Streaming endpoints that do not include a `usage` object will leave them unset.
- The hub measures these metrics on its side. They do not include latency experienced on the client side of the HTTP request, and they do not replace end-to-end distributed tracing.

## Participant connection state

Every management payload that includes a participant exposes a `connection` block:

| Field | Type | Description |
| --- | --- | --- |
| `kind` | `"tunnel"` | transport in use |
| `connected` | `boolean` | whether the tunnel is currently open |
| `lastTunnelSeenAt` | `number \| null` | Unix epoch milliseconds of the most recent tunnel frame, or `null` when no tunnel is open |

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

These are for the operator running the hub. Programs should read the SSE stream.

## What is out of scope

The hub does not provide:

- persistent storage or replay of past events
- aggregated dashboards (p50/p95 latency, error rate over time)
- sampling or export pipelines (OpenTelemetry, Prometheus)
- end-to-end tracing across client, hub, and participant

You can build any of these on top of the SSE stream.
