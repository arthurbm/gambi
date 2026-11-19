---
title: API reference
description: Reference for the Gambi management and inference HTTP APIs.
---

The Gambi hub exposes two HTTP contracts:

- Management API: native Gambi routes under `/v1`
- Inference API: OpenAI-compatible, room-scoped routes under `/rooms/:code/v1/*`

The default protocol on the inference plane is the OpenAI Responses API. Chat Completions remains available for compatibility.

## Base URLs

Management:

```text
http://<hub-host>:<port>/v1/
```

Inference:

```text
http://<hub-host>:<port>/rooms/<ROOM_CODE>/v1/
```

## Authentication

The hub has no built-in authentication. Run it only on a trusted network, or behind your own proxy and authentication layer. A room password only protects participant registration; inference routes do not check it.

Both APIs answer CORS for any origin, so a browser app on another origin can call them.

## Management API

The management API is defined as one contract, and a running hub serves its OpenAPI document:

```bash
curl http://localhost:3000/v1/openapi.json
```

### Envelope contract

Successful management responses use:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

Management errors use:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Room 'ABC123' was not found.",
    "hint": "List the rooms of this hub to see the codes that exist.",
    "details": { "roomCode": "ABC123" }
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

`details` holds the structured fields of the error. `meta.requestId` is the id of the request in the hub's log.

Error codes:

| Code | Status | Meaning |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | `404` | the room code does not exist |
| `PARTICIPANT_NOT_FOUND` | `404` | the room has no participant with that ID |
| `INVALID_PASSWORD` | `401` | the room has a password and the request brought none, or the wrong one |
| `VERSION_MISMATCH` | `409` | the participant runs another minor version of Gambi than the hub; `details` has `hubVersion` and `participantVersion` |
| `TUNNEL_TOKEN_INVALID` | `401` | the tunnel upgrade came without a valid bootstrap token |
| `NOT_A_HARNESS_PARTICIPANT` | `409` | the participant shares a model endpoint, not a harness |
| `PARTICIPANT_UNREACHABLE` | `409` | the participant's tunnel is not open now |
| `HARNESS_SESSION_NOT_OPEN` | `409` | the message was sent to a harness session that is not open |
| `HARNESS_SESSION_OUTSIDE_WORKSPACE` | `403` | the harness session was asked to run outside the participant's workspace |
| `HARNESS_FAILED` | `502` | the harness did not answer, refused, or exited; `details.reason` says which |
| `INVALID_REQUEST` | `400` | the request does not match the contract; `details.issues` lists each problem with its `path` |
| `ROUTE_NOT_FOUND` | `404` | no management route for that method and path |
| `INTERNAL_ERROR` | `500` | a bug in the hub; look for the `requestId` in its log |

### GET /v1/health

Check whether the hub is running.

```bash
curl http://localhost:3000/v1/health
```

The response is `{ "status": "ok", "timestamp": ... }` inside the envelope.

### GET /v1/rooms

List room summaries.

```bash
curl http://localhost:3000/v1/rooms
```

Room summaries include:

- `id`
- `code`: six characters of `0-9A-Z`
- `name`
- `hostId`
- `createdAt`
- `passwordProtected`
- `participantCount`
- `defaults` (when the room has them), with the instructions text replaced by `hasInstructions`

### POST /v1/rooms

Create a room. Answers `201` with `{ "room", "hostId" }`.

```bash
curl -X POST http://localhost:3000/v1/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo",
    "password": "secret",
    "defaults": {
      "temperature": 0.4
    }
  }'
```

### GET /v1/rooms/:code

Fetch one room summary by code.

```bash
curl http://localhost:3000/v1/rooms/ABC123
```

### GET /v1/rooms/:code/participants

List participants in a room.

```bash
curl http://localhost:3000/v1/rooms/ABC123/participants
```

Participant summaries include:

- `id`
- `nickname`
- `model`
- `endpoint` (model participants only)
- `harness` (harness participants only)
- `status`: `offline`, `online`, or `busy`
- `joinedAt`
- `updatedAt`
- `specs`
- `config`
- `capabilities`

`status` comes from the participant's tunnel alone:

| Status | Meaning |
| --- | --- |
| `offline` | registered, but its tunnel is not open; receives no requests |
| `online` | tunnel open and idle; the only status that receives new inference requests |
| `busy` | handling a request |

A participant that stays `offline` for 60 seconds is removed from the room.

A harness participant has no `endpoint`. Its `harness` object contains `id` (`opencode`, `claude-code`, `codex`, or `fake`) and optional `model` and `hosted` fields.

### PUT /v1/rooms/:code/participants/:id

Create or update a participant registration. Participant runtimes (the CLI, the SDK's `gambi-sdk/participant` entry) call it for you; you rarely call it by hand.

This route is idempotent and is the canonical registration path. It always answers `200`. Registering an ID that is already in the room updates its profile and keeps its status. The hub stores the participant `endpoint` as metadata and never connects to it.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nickname` | `string` | yes | display name shown to operators |
| `model` | `string` | yes | model name exposed by the participant |
| `version` | `string` | yes | Gambi version of the participant runtime, such as `0.8.0` |
| `endpoint` | `string (URL)` | for model participants | participant-local provider endpoint |
| `harness` | `{ id, model?, hosted? }` | for harness participants | local harness identity and display metadata |
| `password` | `string` | no | room password, required when the room is protected |
| `specs` | `MachineSpecs` | no | optional machine specs, see below |
| `config` | `RuntimeConfig` | no | participant runtime defaults, see below |
| `capabilities` | `ParticipantCapabilities` | no | participant protocol capabilities, see below |

The hub checks `version` first: a participant on another minor version (`0.7.x` against a `0.8.x` hub, for example) is refused with `409 VERSION_MISMATCH`, whose message names the version the hub expects. Then it checks the room and the password.

Harness participants remain visible in management responses but are never returned by `/rooms/:code/v1/models` or selected for inference by `*`, `any`, or a model name.

Provider credentials are not part of participant registration. A body that carries `authHeaders` is refused with `400 INVALID_REQUEST`. Give provider headers to the participant runtime (the CLI's `--header`, or `authHeaders` in `createParticipantSession()`) so they stay on the participant machine.

`MachineSpecs` fields (all optional):

| Field | Type | Description |
| --- | --- | --- |
| `cpu` | `string` | CPU description |
| `gpu` | `string` | GPU description |
| `ram` | `number` | system RAM in gigabytes |
| `vram` | `number` | GPU VRAM in gigabytes |

`ParticipantCapabilities` fields. Without `capabilities`, both are `"unknown"`; when you send it, give both:

| Field | Values | Description |
| --- | --- | --- |
| `openResponses` | `"supported" \| "unsupported" \| "unknown"` | whether the participant endpoint speaks the OpenAI Responses API |
| `chatCompletions` | `"supported" \| "unsupported" \| "unknown"` | whether the participant endpoint speaks OpenAI Chat Completions |

`RuntimeConfig` fields (all optional): `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`, `instructions`. These act as participant-level defaults: they win over the room defaults, and the request's own fields win over both. Management responses never show the `instructions` string, only `hasInstructions`; the hub sends the text to the provider when the default applies to a request.

```bash
curl -X PUT http://localhost:3000/v1/rooms/ABC123/participants/worker-1 \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "worker-1",
    "model": "llama3",
    "version": "0.8.0",
    "endpoint": "http://localhost:11434",
    "capabilities": {
      "openResponses": "supported",
      "chatCompletions": "supported"
    }
  }'
```

Example response:

```json
{
  "data": {
    "participant": {
      "id": "worker-1",
      "nickname": "worker-1",
      "model": "llama3",
      "endpoint": "http://localhost:11434",
      "status": "offline"
    },
    "tunnel": {
      "token": "bootstrap_token",
      "expiresAt": 1763460060000
    }
  },
  "meta": {
    "requestId": "req_789"
  }
}
```

Set `version` to the version of your hub (`gambi --version` on the hub machine): any other minor is refused.

A participant registered this way stays `offline` until it opens its tunnel, and is removed after 60 seconds if it never does.

### GET /v1/rooms/:code/participants/:id/tunnel

Open the participant tunnel using the bootstrap token returned by the registration route.

```text
GET /v1/rooms/:code/participants/:id/tunnel?token=<token>
```

This is an internal route for participant runtimes. Application clients should keep using the room-scoped HTTP inference API. Over the tunnel, the hub and the runtime speak the wire format of the Effect RPC library, which changes between Gambi minor versions; that is why registration checks the version.

Token lifecycle:

- the bootstrap token is single-use: the hub spends it on the first request, before the upgrade
- the token expires 60 seconds after issuance
- re-registering via `PUT /v1/rooms/:code/participants/:id` returns a fresh token

A missing, unknown, expired, or spent token, a token of another participant, and an unknown room are all `401 TUNNEL_TOKEN_INVALID`. A request with a valid token and no WebSocket upgrade spends the token and gets `400 INVALID_REQUEST`.

### DELETE /v1/rooms/:code/participants/:id

Take a participant out of a room. The hub closes its tunnel and the room hears `participant.removed`.

```bash
curl -X DELETE http://localhost:3000/v1/rooms/ABC123/participants/worker-1
```

The response is `{ "participantId" }` inside the envelope. A participant runtime that is still running treats the closed tunnel as a drop and registers again about one second later.

### GET /v1/rooms/:code/events

Subscribe to room events as Server-Sent Events.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/events
```

Each event repeats its type on the `event:` line and carries one JSON object in `data:`:

```text
event: participant.online
data: {"type":"participant.online","roomCode":"ABC123","timestamp":1763460000000,"participant":{...},"previousStatus":"offline"}
```

Every event has `type`, `roomCode`, and `timestamp` at the top level, next to its own fields. The first event of every connection is `room.snapshot`. The hub writes a `: keepalive` comment every 15 seconds while the stream is quiet.

| Event | Fields |
| --- | --- |
| `room.snapshot` | `room`, `participants` |
| `participant.joined` | `participant` |
| `participant.updated` | `participant` |
| `participant.online` | `participant`, `previousStatus` |
| `participant.busy` | `participant`, `previousStatus` |
| `participant.offline` | `participant`, `previousStatus` |
| `participant.removed` | `participantId`, `reason` (`left` or `reconnectDeadlinePassed`) |
| `llm.request` | `requestId`, `participantId`, `model`, `protocol`, `modelSelector` |
| `llm.complete` | `requestId`, `participantId`, `model`, `protocol`, `status`, `metrics` |
| `llm.error` | `requestId`, `participantId`, `model`, `protocol`, `stage`, `code`, `error` |

Events have no ID and are not replayed. The hub holds up to 256 events for a subscriber that reads slowly and drops the oldest past that; reconnect to get a fresh `room.snapshot`. See [Observability](/reference/observability/) for the `llm.*` fields.

### Harness attach

A management client controls a harness participant with one event stream and three requests. The client calls the hub; the hub never connects to the participant. Any number of clients can attach to the same participant.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| `GET` | `/v1/rooms/:code/participants/:id/harness/events` | | SSE stream of attach events |
| `PUT` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | `{ "cwd"? }` | `{ "sessionId" }` |
| `POST` | `/v1/rooms/:code/participants/:id/harness/messages` | `{ "sessionId", "message" }` | `202` `{ "sessionId" }` |
| `DELETE` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | | `{ "sessionId" }` |

- The client picks the session ID. Opening a session that is already open leaves it as it is. `cwd` must be a folder inside the participant's workspace; it defaults to the workspace itself.
- `message` is one ACP v1 JSON-RPC object, passed to the harness as it is. The `202` means the harness received it; its answer arrives on the event stream.
- Every attached client reads every event of the participant, including answers to other clients. Filter `harness.message` by `sessionId` and match answers to your requests by JSON-RPC `id`. Give each client its own session ID: two clients that share a session and use the same request IDs cannot tell their answers apart.
- These routes answer `NOT_A_HARNESS_PARTICIPANT` for a model participant, and the three requests answer `PARTICIPANT_UNREACHABLE` while the participant's tunnel is down.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/participants/arthur-opencode/harness/events
```

Attach events use the same SSE shape as room events:

| Event | Fields | Meaning |
| --- | --- | --- |
| `harness.connected` | | the hub is receiving the harness; first event when the participant is connected, and again after each reconnection |
| `harness.disconnected` | `reason`, `message` | the hub is not receiving it; `reason` is `NoTunnel` when the participant had no tunnel when you attached |
| `harness.message` | `sessionId`, `message` | an ACP v1 message from the harness |
| `harness.session` | `sessionId`, `status` (`opened`, `closed`, `error`), `message` | a harness session changed |
| `harness.artifact` | `sessionId`, `version`, `reason` (`watch`, `final`), `files` | a snapshot of the participant's workspace |
| `harness.dropped` | `count` | this client read too slowly and lost `count` events here |
| `harness.detached` | `reason` (`left`, `reconnectDeadlinePassed`) | the participant left the room; last event |

Nothing is replayed for a client that attaches late. Each artifact is the whole workspace, and each file has `path`, `encoding` (`utf8` or `base64`), and `content`. A workspace larger than 8 MiB sends no artifact.

## Inference API

The inference API is room-scoped and OpenAI-compatible.

Base URL:

```text
http://localhost:3000/rooms/ABC123/v1/
```

The hub reads only `model` (a non-empty string) and `stream` (a boolean, or `null` for no stream) from the request body. Every other field goes to the participant's provider as it came, after the hub fills in what the request left out from the participant's config and the room defaults. The hub replaces `model` with the participant's model.

### Model routing

The `model` field controls routing:

| Value | Behavior |
| --- | --- |
| `*` or `any` | a random available participant |
| `model:<name>` | the first available participant whose model is `<name>` |
| anything else | the available participant with that ID; otherwise the first available participant whose model is that name; otherwise `participant_busy` or `participant_offline` when a participant with that ID exists but is not available |

With `model:<name>`, no participant ID is involved: when nobody serves the model, the answer is `model_not_found`. A bare value can also answer `participant_busy` or `participant_offline`, when a participant with that ID exists. So `"model": "llama3"` behaves like `model:llama3` unless a participant has the ID `llama3`, and a participant ID is not an exact target: when that participant is busy or offline, another one serving a model with the same name can take the request.

A participant is available only when it is `online`: its tunnel is open and it is not handling another request. Harness participants are never picked by `*`, `any`, or a model name.

### Cancellation and timeouts

- Closing the HTTP request (aborting `fetch`, stopping the stream) cancels the request on the participant's provider, and the participant becomes available again.
- If the participant sends nothing for 5 minutes, before the first chunk or between two, the hub cancels the request and answers `inference_timeout`.
- If your app reads a stream so slowly that more than 8 Mi characters of it are waiting, the hub cancels the request and ends the stream with `consumer_too_slow`.
- An answer that is not a stream is held by the hub until it is complete, up to 32 Mi characters.

### Inference errors

Inference routes do not use the management envelope. Errors use the OpenAI error format:

```json
{
  "error": {
    "message": "Participant 'worker-1' is already handling another request.",
    "type": "invalid_request_error",
    "param": null,
    "code": "participant_busy"
  }
}
```

`type` is `invalid_request_error` for a `4xx` and `api_error` for a `5xx`. Tell errors apart by `code`:

| Status | `code` | Condition |
| --- | --- | --- |
| `400` | `invalid_request` | the body is not a JSON object, `model` is not a non-empty string, or `stream` is neither absent, a boolean, nor `null` |
| `400` | `inference_not_supported` | the selector names a harness participant |
| `400` | `request_not_translatable` | the provider has no Responses API and the request uses something Chat Completions cannot carry |
| `404` | `room_not_found` | the room code does not exist |
| `404` | `model_not_found` | no available participant matches the selector |
| `404` | `response_not_found` | the hub knows no Response with that ID in the room |
| `408` | `consumer_too_slow` | the app read a stream too slowly. Only sent as the last event of a stream, whose HTTP status was already sent |
| `409` | `participant_busy` | the selector names a participant that is busy |
| `501` | `response_not_stored` | the Response was answered through Chat Completions and cannot be read back, deleted, or cancelled |
| `501` | `responses_not_supported` | the provider speaks neither the Responses API nor Chat Completions |
| `502` | `participant_disconnected` | the participant's tunnel dropped before the answer ended |
| `502` | `provider_unreachable` | the participant's provider did not answer |
| `502` | `provider_response_interrupted` | the provider's answer broke in the middle |
| `502` | `provider_response_too_large` | an answer that is not a stream exceeded what the hub holds |
| `503` | `participant_offline` | the selector names a participant whose tunnel is not open |
| `504` | `inference_timeout` | nothing arrived from the participant for 5 minutes |
| `500` | `internal_error` | a bug in the hub |

An error that happens after a stream started arrives as the last event of the stream, and no `[DONE]` follows it:

```text
event: error
data: {"type":"error","code":"participant_disconnected","message":"...","param":null,"error":{"message":"...","type":"api_error","param":null,"code":"participant_disconnected"}}
```

The OpenAI SDKs raise it as an error, for both the Responses API and Chat Completions.

### GET /rooms/:code/v1/models

List the room's available model participants in OpenAI list format. Each entry's `id` is the participant ID, so you can pass it back as `model`. Harness participants and offline participants are left out.

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

Each returned model includes a Gambi extension under `gambi` with:

- `nickname`
- `model`
- `endpoint`
- `capabilities`
- `status` (`online` or `busy`)

### POST /rooms/:code/v1/responses

Proxy the OpenAI Responses API.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "input": "Hello!",
    "stream": false
  }'
```

When the participant's provider has no Responses API, the hub creates the Response through Chat Completions and translates the answer.

Additional lifecycle endpoints:

- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`

They reach the participant whose provider created the Response, even while it is busy; while it is offline they answer `participant_offline`. The hub remembers up to 10 000 Responses; past that it forgets the one used longest ago, and its lifecycle routes answer `response_not_found`.

### POST /rooms/:code/v1/chat/completions

Proxy OpenAI-compatible Chat Completions.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

Use this when a tool requires Chat Completions. For new integrations, prefer `/responses`.

## Runtime defaults

For each field a request leaves out or sends as `null`, the hub uses:

1. the participant's config, when it sets the field
2. otherwise the room defaults

The fields the request sets to a value always win. In the Responses API, `max_tokens` fills `max_output_tokens` and `stop` fills `stop_sequences`. The default `instructions` become a leading `system` message in Chat Completions (unless the request already has one) and fill `instructions` in the Responses API. Sensitive config is redacted from public management payloads.
