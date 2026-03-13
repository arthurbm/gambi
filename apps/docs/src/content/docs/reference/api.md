---
title: API Reference
description: Complete HTTP API reference for the Gambiarra hub. OpenAI-compatible endpoints for chat completions and responses.
---

The Gambiarra hub exposes an OpenAI-compatible HTTP API. Any tool or library that works with the OpenAI API can work with Gambiarra by changing the base URL.

## Base URL

All LLM endpoints are scoped to a room:

```
http://<hub-host>:<port>/rooms/<ROOM_CODE>/v1/
```

Example: `http://192.168.1.100:3000/rooms/ABC123/v1/`

## Authentication

No authentication is required. Gambiarra is designed for trusted local networks. CORS is enabled for all origins.

## Model Routing

The `model` field in requests controls which participant handles it:

| Value | Behavior | Example |
|-------|----------|---------|
| `*` or `any` | Random online participant | `"model": "*"` |
| `model:<name>` | First online participant with that model | `"model": "model:llama3"` |
| `<participant-id>` | Specific participant by ID | `"model": "abc123"` |
| `<model-name>` | Tries participant ID first, then model match | `"model": "llama3"` |

## LLM Endpoints

### POST /rooms/:code/v1/chat/completions

OpenAI-compatible chat completions proxy. Supports streaming.

**Request:**

```json
{
  "model": "*",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 500
}
```

**curl (non-streaming):**

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**curl (streaming):**

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

Streaming responses use Server-Sent Events (`data: {...}` chunks, terminated by `data: [DONE]`).

### POST /rooms/:code/v1/responses

OpenAI Responses API proxy (primary protocol). Supports streaming.

**Request:**

```json
{
  "model": "*",
  "input": "Hello!",
  "stream": false
}
```

**With instructions:**

```json
{
  "model": "*",
  "input": "Translate to Portuguese",
  "instructions": "You are a translator",
  "stream": true
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model": "*", "input": "Hello!"}'
```

### GET /rooms/:code/v1/models

List available models and participants in the room. Returns OpenAI-compatible format.

**curl:**

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "participant-id",
      "object": "model",
      "created": 1234567890,
      "owned_by": "alice",
      "gambiarra": {
        "nickname": "alice",
        "model": "llama3",
        "endpoint": "http://192.168.1.10:11434",
        "capabilities": {
          "openResponses": "supported",
          "chatCompletions": "supported"
        }
      }
    }
  ]
}
```

## Room Management

### POST /rooms

Create a new room.

```bash
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "My Room"}'
```

Optional: `"password": "secret"` for password-protected rooms.

**Response:**

```json
{
  "room": {
    "id": "uuid",
    "code": "ABC123",
    "name": "My Room",
    "hostId": "uuid",
    "createdAt": 1234567890
  },
  "hostId": "uuid"
}
```

### GET /rooms

List all rooms.

```bash
curl http://localhost:3000/rooms
```

### POST /rooms/:code/join

Register a participant in a room.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/join \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-unique-id",
    "nickname": "alice",
    "model": "llama3",
    "endpoint": "http://192.168.1.10:11434"
  }'
```

Optional fields: `"password"`, `"specs"`, `"config"`, `"capabilities"`.

### DELETE /rooms/:code/leave/:participantId

Remove a participant from a room.

```bash
curl -X DELETE http://localhost:3000/rooms/ABC123/leave/my-unique-id
```

### GET /rooms/:code/participants

List all participants in a room with their status.

```bash
curl http://localhost:3000/rooms/ABC123/participants
```

### POST /rooms/:code/health

Send a health check heartbeat. Participants must send this every 10 seconds to stay online. After 30 seconds without a heartbeat, the participant is marked offline.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/health \
  -H "Content-Type: application/json" \
  -d '{"id": "my-participant-id"}'
```

### GET /health

Check if the hub is running.

```bash
curl http://localhost:3000/health
```

## SSE Events

### GET /rooms/:code/events

Server-Sent Events stream for real-time monitoring.

```bash
curl -N http://localhost:3000/rooms/ABC123/events
```

Events emitted:
- `room:created` — new room created
- `participant:joined` — participant joined the room
- `participant:left` — participant left the room
- `participant:offline` — participant stopped sending health checks
- `llm:request` — request was routed to a participant
- `llm:error` — request to a participant failed

## Using with AI Tools

Point any tool that accepts an OpenAI-compatible base URL to:

```
http://<hub>:<port>/rooms/<CODE>/v1
```

### Lovable / Cursor / any OpenAI-compatible client

- **Base URL:** `http://192.168.1.100:3000/rooms/ABC123/v1`
- **API Key:** any string (not validated)
- **Model:** `*` (any available) or a specific model name

### Python (openai library)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.100:3000/rooms/ABC123/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="*",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### JavaScript (fetch)

```javascript
const response = await fetch(
  "http://localhost:3000/rooms/ABC123/v1/chat/completions",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "*",
      messages: [{ role: "user", content: "Hello!" }],
    }),
  }
);
const data = await response.json();
console.log(data.choices[0].message.content);
```
