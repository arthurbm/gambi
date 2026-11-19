---
title: Observability
description: SSE events, metrics, and participant status emitted by the Gambi hub.
---

The hub reports inference activity and participant state as room events. This page documents that public contract.

Read the events from the management SSE stream:

```text
GET /v1/rooms/:code/events
```

Or through the SDK:

```ts
for await (const event of client.events.watch(roomCode)) {
  // ...
}
```

Or from the CLI, one JSON line per event:

```bash
gambi events watch --room ABC123 --format ndjson
```

Every event has `type`, `roomCode`, and `timestamp` (milliseconds since the epoch, on the hub's clock) at the top level, next to its own fields.

## Event types

The first event of every connection is a snapshot of the room. After it, the stream carries every change of a participant and every inference request.

| Event | When it fires |
| --- | --- |
| `room.snapshot` | first event of every connection: `room` and its `participants` at that moment |
| `participant.joined` | a participant registered; it starts `offline` |
| `participant.updated` | a participant already in the room registered again; its status did not change |
| `participant.online` | its tunnel opened, or the request it was answering ended |
| `participant.busy` | the hub dispatched a request to it |
| `participant.offline` | its tunnel dropped |
| `participant.removed` | it left the room, or stayed offline for 60 seconds |
| `llm.request` | routing selected a participant and the hub dispatched the request into its tunnel |
| `llm.complete` | the provider's answer ended |
| `llm.error` | the request ended without the provider's whole answer |

A request that fails routing (no available participant, busy or offline participant, harness participant) gets an HTTP error and emits no event. See [Inference errors](/reference/api/#inference-errors).

Harness sessions and artifacts are not room events. To follow a harness participant, attach to it with `client.harness.attach()` or `GET /v1/rooms/:code/participants/:id/harness/events`; see [Harness attach](/reference/api/#harness-attach).

Events have no ID and the hub keeps no history. A subscriber that falls more than 256 events behind loses the oldest ones; reconnecting starts again from a fresh `room.snapshot`. An application that needs history keeps its own, for example by persisting events in a database. That does not add storage or replay to `/v1/rooms/:code/events`.

### Participant events

`participant.joined` and `participant.updated` carry the `participant` summary. The three status events carry the `participant` after the change and its `previousStatus`:

| Field | Type | Description |
| --- | --- | --- |
| `participant` | `ParticipantSummary` | the participant after the change |
| `previousStatus` | `"offline" \| "online" \| "busy"` | its status before the change |

`participant.removed` carries `participantId` and `reason`: `left` when it left the room, `reconnectDeadlinePassed` when it stayed offline for 60 seconds. A runtime notified of explicit removal reports `left` with `reason: "removed"` to its host. The snapshot and events that carry a participant summary include the owner's `runtimeId`.

### `llm.request`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | id of the HTTP request on the hub, shared by `llm.request`, `llm.complete`, and `llm.error`, and found in the hub's log |
| `participantId` | `string` | participant selected by routing |
| `model` | `string` | the participant's model, which is what its provider was asked for |
| `modelSelector` | `string` | the `model` value from the request body (`*`, `model:llama3`, a participant ID, ...) |
| `protocol` | `"openResponses" \| "chatCompletions"` | API the request used against the hub |

### `llm.complete`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | same as in `llm.request` |
| `participantId` | `string` | participant that produced the response |
| `model` | `string` | the participant's model |
| `protocol` | `"openResponses" \| "chatCompletions"` | API of the request |
| `status` | `number` | HTTP status the provider answered with; an error answer from the provider still completes |
| `metrics` | `Metrics` | see below |

### `llm.error`

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | `string` | correlation identifier |
| `participantId` | `string` | participant selected by routing |
| `model` | `string` | the participant's model |
| `protocol` | `"openResponses" \| "chatCompletions"` | API of the request |
| `stage` | `"dispatch" \| "stream"` | `dispatch`: the app had received nothing yet. `stream`: a streaming response broke after it started |
| `code` | `string` | the inference error `code` the app got (such as `participant_disconnected` or `inference_timeout`), or `request_cancelled` when the app itself gave the request up |
| `error` | `string` | human-readable failure message |

## Metrics

`llm.complete.metrics` carries up to six fields:

| Field | Unit | Source | Notes |
| --- | --- | --- | --- |
| `ttftMs` | milliseconds | hub-observed | time from the dispatch to the first piece of the answer's body |
| `durationMs` | milliseconds | hub-observed | time from the dispatch to the end of the answer |
| `inputTokens` | tokens | provider `usage` | answers that are not a stream only |
| `outputTokens` | tokens | provider `usage` | answers that are not a stream only |
| `totalTokens` | tokens | provider `usage` or derived | the provider's total, or `inputTokens + outputTokens` when it gives none |
| `tokensPerSecond` | tokens/second | derived | `outputTokens / durationMs * 1000`; present only when `outputTokens` is known and `durationMs` is above zero |

### What you can rely on

- `ttftMs` and `durationMs` are always present, because the hub measures them.
- Token counts come only from the `usage` of an answer that is not a stream. A streamed answer has no token counts.
- The hub measures these metrics on its side. They do not include latency experienced on the client side of the HTTP request, and they do not replace end-to-end distributed tracing.

## Participant status

Every participant has one `status`, derived from its tunnel:

| Status | Meaning |
| --- | --- |
| `offline` | registered, but its tunnel is not open; receives no requests |
| `online` | tunnel open and idle; the only status that receives new inference requests |
| `busy` | handling a request |

Each change emits a `participant.online`, `participant.busy`, or `participant.offline` event, so a monitor can follow the room from the event stream alone.

## Structured logs

The hub also writes structured log lines for the operator running it, such as `tunnel opened`, `tunnel dropped`, `participant status changed`, and `inference request failed`, with the room, the participant, and the request id attached. `gambi hub serve` writes them to stderr, as JSON when its output is not a terminal; `--log-level` filters them. A hub started with `createHub()` hands them to its `onLog` callback.

Programs should read the SSE stream, not the logs.

## What is out of scope

The hub does not provide:

- persistent storage or replay of past events
- aggregated dashboards (p50/p95 latency, error rate over time)
- sampling or export pipelines (OpenTelemetry, Prometheus)
- end-to-end tracing across client, hub, and participant

You can build any of these on top of the SSE stream.
