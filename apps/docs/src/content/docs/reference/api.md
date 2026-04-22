---
title: API Reference
description: Reference for the Gambi management and inference HTTP APIs.
---

The Gambi hub exposes two HTTP contracts:

- Management API: native Gambi endpoints under `/v1`
- Inference API: OpenAI-compatible room-scoped endpoints under `/rooms/:code/v1/*`

The default protocol on the inference plane is the OpenAI Responses API. Chat Completions remains available as a compatibility surface.

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

The hub does not provide native authentication. It is designed for trusted local networks.

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

Common error codes:

- `ROOM_NOT_FOUND`
- `PARTICIPANT_NOT_FOUND`
- `INVALID_REQUEST`
- `INVALID_PASSWORD`
- `ENDPOINT_NOT_REACHABLE`
- `PARTICIPANT_CONFLICT`
- `PARTICIPANT_BUSY`
- `PARTICIPANT_TUNNEL_NOT_CONNECTED`
- `MODEL_NOT_FOUND`
- `INTERNAL_ERROR`

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

`connection` currently has:

- `kind = "tunnel"`
- `connected`
- `lastTunnelSeenAt`

### PUT /v1/rooms/:code/participants/:id

Create or update a participant registration.

This endpoint is idempotent and is the canonical registration path. The participant endpoint is treated as local metadata for the participant runtime. The hub does not need direct network reachability to it.

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nickname` | `string` | yes | display name shown to operators |
| `model` | `string` | yes | model name exposed by the participant |
| `endpoint` | `string (URL)` | yes | participant-local provider endpoint |
| `password` | `string` | no | room password, required when the room is protected |
| `specs` | `MachineSpecs` | no | optional machine specs, see below |
| `config` | `RuntimeConfig` | no | participant runtime defaults, see below |
| `capabilities` | `ParticipantCapabilities` | no | participant protocol capabilities, see below |

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

`RuntimeConfig` fields (all optional): `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`, `instructions`. These act as participant-level defaults and are merged under the room defaults and above request-time overrides. The `instructions` string is private to the participant runtime — management responses surface only `hasInstructions`.

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

The returned `tunnel` bootstrap is intended for participant runtimes such as the CLI or SDK `createParticipantSession()`.

### GET /v1/rooms/:code/participants/:id/tunnel

Open the participant tunnel using the bootstrap token returned by the registration route.

```text
GET /v1/rooms/:code/participants/:id/tunnel?token=<token>
```

This is an internal operational route for participant runtimes. Application clients should keep using the room-scoped HTTP inference API.

Token lifecycle:

- the bootstrap token is single-use — successful upgrade consumes it
- the token expires 60 seconds after issuance
- re-registering via `PUT /v1/rooms/:code/participants/:id` returns a fresh token

Error responses:

| Status | Code | Condition |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | `token` query parameter is missing |
| `401` | `INVALID_REQUEST` | token is unknown, expired, or bound to a different participant |
| `404` | `ROOM_NOT_FOUND` | room code does not exist |
| `404` | `PARTICIPANT_NOT_FOUND` | participant is not registered in the room |

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

Health constants:

- heartbeat interval: `10_000 ms`
- offline timeout: `30_000 ms`

Note that participant routability also depends on tunnel connectivity. A participant can remain registered but still be unroutable if its tunnel is disconnected.

### GET /v1/rooms/:code/events

Subscribe to room events as SSE.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/events
```

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

Observability events:

- `llm.request` includes `requestId`, `participantId`, `model`, and `protocol`
- `llm.complete` includes the same fields plus `metrics`
- `llm.error` includes request identity, participant info, protocol, stage, and error text

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
| `*` or `any` | random available participant |
| `model:<name>` | first available participant matching the model name |
| `<participant-id>` | specific participant |

A participant is available only when:

- its tunnel is connected
- it is not offline
- it is not already handling another request

### GET /rooms/:code/v1/models

List available room models in an OpenAI-compatible format.

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

Use this when you need explicit Chat Completions compatibility. For new integrations, prefer `/responses`.

## Runtime defaults

The hub merges runtime defaults in this order:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is redacted from public management payloads.
