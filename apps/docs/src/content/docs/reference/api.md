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

## Management API

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
    "message": "Room 'ABC123' not found.",
    "hint": "Create the room first or verify the room code."
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

Error codes the hub returns:

- `ROOM_NOT_FOUND`
- `PARTICIPANT_NOT_FOUND`
- `INVALID_REQUEST`
- `INVALID_PASSWORD`
- `INTERNAL_ERROR`

The error code enum also declares `ENDPOINT_NOT_REACHABLE`, `PARTICIPANT_CONFLICT`, `PARTICIPANT_BUSY`, `PARTICIPANT_TUNNEL_NOT_CONNECTED`, and `MODEL_NOT_FOUND`. The hub does not return them today; treat them as reserved. The SDK uses `PARTICIPANT_TUNNEL_NOT_CONNECTED` for a client-side error when you send on a closed harness channel.

### GET /v1/health

Check whether the hub is running.

```bash
curl http://localhost:3000/v1/health
```

### GET /v1/rooms

List room summaries.

```bash
curl http://localhost:3000/v1/rooms
```

### POST /v1/rooms

Create a room.

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
- `endpoint`
- `status`
- `joinedAt`
- `updatedAt`
- `lastSeen`
- `specs`
- `config`
- `capabilities`
- `connection`
- `harness` (harness participants only)

`endpoint` is absent for a harness participant. Its `harness` object contains `id` (`opencode`, `claude-code`, `codex`, `pi`, or `fake`) and optional `model` and `hosted` fields.

`connection` currently has:

- `kind = "tunnel"`
- `connected`
- `lastTunnelSeenAt`

### PUT /v1/rooms/:code/participants/:id

Create or update a participant registration.

This route is idempotent and is the canonical registration path. The hub stores the participant `endpoint` as metadata and never connects to it.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nickname` | `string` | yes | display name shown to operators |
| `model` | `string` | yes | model name exposed by the participant |
| `endpoint` | `string (URL)` | for model participants | participant-local provider endpoint |
| `harness` | `{ id, model?, hosted? }` | for harness participants | local harness identity and display metadata |
| `password` | `string` | no | room password, required when the room is protected |
| `specs` | `MachineSpecs` | no | optional machine specs, see below |
| `config` | `RuntimeConfig` | no | participant runtime defaults, see below |
| `capabilities` | `ParticipantCapabilities` | no | participant protocol capabilities, see below |

When `harness` is present, `endpoint` may be omitted and `capabilities` is ignored. Harness participants remain visible in management responses but are never returned by `/rooms/:code/v1/models` or selected for inference.

Provider credentials are not part of participant registration. Do not send `authHeaders` to this route; pass them to `createParticipantSession()` or the CLI runtime so they stay local to the participant.

`MachineSpecs` fields (all optional):

| Field | Type | Description |
| --- | --- | --- |
| `cpu` | `string` | CPU description |
| `gpu` | `string` | GPU description |
| `ram` | `number` | system RAM in gigabytes |
| `vram` | `number` | GPU VRAM in gigabytes |

`ParticipantCapabilities` fields (each defaults to `"unknown"`):

| Field | Values | Description |
| --- | --- | --- |
| `openResponses` | `"supported" \| "unsupported" \| "unknown"` | whether the participant endpoint speaks the OpenAI Responses API |
| `chatCompletions` | `"supported" \| "unsupported" \| "unknown"` | whether the participant endpoint speaks OpenAI Chat Completions |

`RuntimeConfig` fields (all optional): `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`, `instructions`. These act as participant-level defaults and are merged under the room defaults and above request-time overrides. The `instructions` string is private to the participant runtime. Management responses show only `hasInstructions`.

```bash
curl -X PUT http://localhost:3000/v1/rooms/ABC123/participants/worker-1 \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "worker-1",
    "model": "llama3",
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
      "status": "offline",
      "connection": {
        "kind": "tunnel",
        "connected": false,
        "lastTunnelSeenAt": null
      }
    },
    "roomId": "room_123",
    "tunnel": {
      "url": "ws://localhost:3000/v1/rooms/ABC123/participants/worker-1/tunnel",
      "token": "bootstrap_token"
    }
  },
  "meta": {
    "requestId": "req_789"
  }
}
```

Behavior:

- `201` when the participant is created
- `200` when the participant already exists and is updated or unchanged

Participant runtimes, such as the CLI or the SDK's `createParticipantSession()`, use the returned `tunnel` bootstrap to open the tunnel.

### GET /v1/rooms/:code/participants/:id/tunnel

Open the participant tunnel using the bootstrap token returned by the registration route.

```text
GET /v1/rooms/:code/participants/:id/tunnel?token=<token>
```

This is an internal operational route for participant runtimes. Application clients should keep using the room-scoped HTTP inference API.

Token lifecycle:

- the bootstrap token is single-use: a successful upgrade consumes it
- the token expires 60 seconds after issuance
- re-registering via `PUT /v1/rooms/:code/participants/:id` returns a fresh token

Error responses:

| Status | Code | Condition |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | `token` query parameter is missing |
| `401` | `INVALID_REQUEST` | token is unknown, expired, or bound to a different participant |
| `404` | `ROOM_NOT_FOUND` | room code does not exist |
| `404` | `PARTICIPANT_NOT_FOUND` | participant is not registered in the room |

### GET /v1/rooms/:code/participants/:id/harness

Attach a management client to a registered harness participant using a WebSocket upgrade. The client initiates this connection; the hub never connects to the participant.

Clients send `tunnel.harness.message` and `tunnel.harness.control` frames. They receive `tunnel.harness.message`, `tunnel.harness.artifact`, and `tunnel.harness.status` frames. Every frame includes `sessionId`; ACP JSON-RPC lives in the opaque `message` field. Multiple clients may attach. Their sockets stay open if the participant tunnel closes and the participant later opens a new one; frames a client sends while no tunnel is open are dropped. The hub closes attached sockets when the participant leaves the room.

The route returns `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`, or `INVALID_REQUEST` when the target is not a harness participant.

### DELETE /v1/rooms/:code/participants/:id

Remove a participant from a room.

```bash
curl -X DELETE http://localhost:3000/v1/rooms/ABC123/participants/worker-1
```

### POST /v1/rooms/:code/participants/:id/heartbeat

Send a heartbeat for one participant.

```bash
curl -X POST http://localhost:3000/v1/rooms/ABC123/participants/worker-1/heartbeat
```

A participant that is registered but has a disconnected tunnel stays in the room and is not routable. See [Health timings](#health-timings).

### Health timings

Two constants in `packages/core/src/types.ts` drive liveness:

- `HEALTH_CHECK_INTERVAL = 10_000` ms: how often participant runtimes send a heartbeat and a tunnel ping.
- `PARTICIPANT_TIMEOUT = 30_000` ms: after this long without a heartbeat, the hub marks the participant offline. The hub also closes a tunnel that has been silent for this long.

A custom participant runtime must match these windows. `createParticipantSession()` does it for you.

### GET /v1/rooms/:code/events

Subscribe to room events as SSE.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/events
```

`GET /rooms/:code/events` serves the same stream. Prefer the `/v1` path.

Each SSE `data:` block contains a JSON event with:

- `type`
- `timestamp`
- `roomCode`
- `data`

Current event types:

- `connected`
- `room.created`
- `participant.joined`
- `participant.updated`
- `participant.left`
- `participant.offline`
- `llm.request`
- `llm.complete`
- `llm.error`
- `harness.session.opened`
- `harness.session.closed`
- `harness.artifact`

Observability events:

- `llm.request` includes `requestId`, `participantId`, `model`, and `protocol`
- `llm.complete` includes the same fields plus `metrics`
- `llm.error` includes request identity, participant info, protocol, stage, and error text
- harness session events include `participantId` and `sessionId`; `harness.artifact` adds `version` and omits file contents

`metrics` may include:

- `ttftMs`
- `durationMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `tokensPerSecond`

## Inference API

The inference API is room-scoped and OpenAI-compatible.

Base URL:

```text
http://localhost:3000/rooms/ABC123/v1/
```

### Model routing

The `model` field controls routing:

| Value | Behavior |
| --- | --- |
| `*` or `any` | a random available participant |
| `model:<name>` | the first available participant whose model is `<name>` |
| `<participant-id>` | that participant, if it is available |

If the value is not a `*`, `any`, or `model:` selector and no available participant has that ID, the hub treats the value as a model name and picks the first available participant serving it. So `"model": "llama3"` behaves like `model:llama3` unless a participant is registered with the ID `llama3`.

A participant is available only when:

- its tunnel is connected
- it is not offline
- it is not already handling another request
- it is a model participant (harness participants never receive inference requests)

### Inference errors

Inference routes do not use the management envelope. Errors are a JSON object with an `error` string and no code:

```json
{ "error": "Participant tunnel is not connected." }
```

| Status | `error` | Condition |
| --- | --- | --- |
| `400` | `Harness participants do not serve inference requests; attach through the management harness channel instead.` | the selector names a harness participant |
| `404` | `Room not found` | the room code does not exist |
| `404` | `No available participant for the requested model` | no available participant matches the selector |
| `409` | `Participant is already handling another request.` | the selector names a participant that is busy |
| `503` | `Participant tunnel is not connected.` | the selector names a participant whose tunnel is closed |
| `502` | `Failed to proxy request: …` | the tunnel request failed after a participant was selected |

### GET /rooms/:code/v1/models

List the room's available model participants in OpenAI list format. Each entry's `id` is the participant ID, so you can pass it back as `model`. Harness participants, offline participants, and participants without a connected tunnel are left out.

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

Each returned model includes a Gambi extension under `gambi` with:

- `nickname`
- `model`
- `endpoint`
- `capabilities`
- `connection`

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

Additional lifecycle endpoints:

- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`

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

The hub merges runtime defaults in this order:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is redacted from public management payloads.
