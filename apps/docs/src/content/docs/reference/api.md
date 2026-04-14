---
title: API Reference
description: Reference for the Gambi management and inference HTTP APIs.
---

The Gambi hub exposes two HTTP contracts:

- Management API: native Gambi endpoints under `/v1`
- Inference API: OpenAI-compatible room-scoped endpoints under `/rooms/:code/v1/*`

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

The hub does not provide native authentication. It is designed for trusted local networks. CORS is enabled for all origins.

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
- `LOOPBACK_ENDPOINT_FOR_REMOTE_HUB`
- `PARTICIPANT_CONFLICT`
- `MODEL_NOT_FOUND`

### GET /v1/health

Check whether the hub is running.

```bash
curl http://localhost:3000/v1/health
```

Example response:

```json
{
  "data": {
    "status": "ok",
    "timestamp": 1743884000000
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

### GET /v1/rooms

List room summaries.

```bash
curl http://localhost:3000/v1/rooms
```

Each room summary includes:

- `id`
- `code`
- `name`
- `hostId`
- `createdAt`
- `participantCount`
- `passwordProtected`
- `defaults`

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

Example response:

```json
{
  "data": {
    "room": {
      "id": "room_123",
      "code": "ABC123",
      "name": "Demo",
      "hostId": "host_123",
      "createdAt": 1743884000000,
      "participantCount": 0,
      "passwordProtected": true,
      "defaults": {
        "temperature": 0.4
      }
    },
    "hostId": "host_123"
  },
  "meta": {
    "requestId": "req_234"
  }
}
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

### PUT /v1/rooms/:code/participants/:id

Create or update a participant registration.

This endpoint is idempotent and is the canonical registration path.

```bash
curl -X PUT http://localhost:3000/v1/rooms/ABC123/participants/worker-1 \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "worker-1",
    "model": "llama3",
    "endpoint": "http://192.168.1.25:11434",
    "capabilities": {
      "openResponses": "supported",
      "chatCompletions": "supported"
    }
  }'
```

Behavior:

- `201` when the participant is created
- `200` when the participant already exists and is updated or unchanged

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

Example response:

```json
{
  "data": {
    "success": true,
    "status": "online",
    "lastSeen": 1743884000000
  },
  "meta": {
    "requestId": "req_345"
  }
}
```

Health constants:

- heartbeat interval: `10_000 ms`
- offline timeout: `30_000 ms`

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

Example event:

```json
{
  "type": "participant.joined",
  "timestamp": 1743884000000,
  "roomCode": "ABC123",
  "data": {
    "id": "worker-1",
    "nickname": "worker-1",
    "model": "llama3"
  }
}
```

## Inference API

The inference API remains OpenAI-compatible and is scoped to a room.

Base URL:

```text
http://localhost:3000/rooms/ABC123/v1/
```

### Model routing

The `model` field controls routing:

| Value | Behavior |
| --- | --- |
| `*` or `any` | random online participant |
| `model:<name>` | first online participant matching the model name |
| `<participant-id>` | specific participant |

### GET /rooms/:code/v1/models

List available room models in an OpenAI-compatible format.

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

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

The hub prefers the Responses protocol first.

Additional lifecycle endpoints:

- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`

### POST /rooms/:code/v1/chat/completions

Proxy OpenAI-compatible chat completions.

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

## Runtime defaults

The hub merges runtime defaults in this order:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is redacted from public management payloads.
