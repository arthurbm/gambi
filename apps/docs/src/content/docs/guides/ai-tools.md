---
title: Using Gambi with AI Tools
description: Use Gambi as an OpenAI-compatible LLM backend in Lovable, v0, Cursor, Claude Code, or any AI tool and SDK.
---

Gambi exposes an **OpenAI-compatible API**. Any tool, library, or AI agent that supports a custom OpenAI base URL can use Gambi as its LLM backend — no code changes, no special SDK required.

## Connection Details

Every Gambi room exposes a standard OpenAI-compatible endpoint:

| Setting | Value |
|---------|-------|
| **Base URL** | `http://<hub-ip>:<port>/rooms/<ROOM_CODE>/v1` |
| **API Key** | Any string (not validated — Gambi is designed for trusted local networks) |
| **Model** | `*` (any available), `model:<name>`, or `<participant-id>` |

Example: `http://192.168.1.100:3000/rooms/ABC123/v1`

Supported protocols:
- **Chat Completions** — `POST /chat/completions` (works with virtually every tool)
- **Responses API** — `POST /responses` (OpenAI Responses API format)

## Prerequisites

Before connecting any tool, you need a running Gambi hub with at least one participant. Quickest path:

```bash
# 1. Start the hub
gambi serve --port 3000

# 2. Create a room
gambi create --name "My Room"
# → Room created! Code: ABC123

# 3. Join with your LLM (e.g. Ollama)
gambi join --code ABC123 --model llama3
```

See the [Quick Start](/guides/quickstart/) for detailed instructions and installation.

## AI App Builders (Lovable, v0, Bolt)

These tools let you configure a custom OpenAI-compatible provider. Set:

- **Base URL:** `http://<hub-ip>:3000/rooms/<CODE>/v1`
- **API Key:** `gambi` (any non-empty string)
- **Model:** `*`

That's it. The tool will use Gambi's room as its LLM backend, routing requests to any available participant.

To target a specific model instead of random routing, use `model:<name>` (e.g. `model:llama3`).

## AI Code Editors (Cursor, Windsurf, Cline)

Most AI-powered editors support custom OpenAI-compatible endpoints:

**Cursor:** Settings → Models → OpenAI API Key + Override OpenAI Base URL

**Cline:** Settings → API Provider → OpenAI Compatible

Use the same connection details:

| Setting | Value |
|---------|-------|
| Base URL | `http://<hub-ip>:3000/rooms/<CODE>/v1` |
| API Key | `gambi` |
| Model | `*` or `model:<name>` |

## Python (openai library)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.100:3000/rooms/ABC123/v1",
    api_key="not-needed",
)

# Non-streaming
response = client.chat.completions.create(
    model="*",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="model:llama3",
    messages=[{"role": "user", "content": "Write a poem"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## JavaScript/TypeScript (Vercel AI SDK)

The `gambi-sdk` package provides a native [Vercel AI SDK](https://sdk.vercel.ai/) provider:

```bash
npm install gambi-sdk ai
```

```typescript
import { createGambi } from "gambi-sdk";
import { generateText, streamText } from "ai";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://192.168.1.100:3000",
});

// Generate text — random participant
const { text } = await generateText({
  model: gambi.any(),
  prompt: "Explain recursion briefly",
});

// Generate text — specific model
const { text: code } = await generateText({
  model: gambi.model("llama3"),
  prompt: "Write a fizzbuzz function in Python",
});

// Stream text
const stream = streamText({
  model: gambi.any(),
  prompt: "Write a short story",
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

Use `defaultProtocol: "chatCompletions"` if your participants only support Chat Completions.

## JavaScript/TypeScript (OpenAI SDK)

If you prefer the OpenAI SDK directly:

```bash
npm install openai
```

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://192.168.1.100:3000/rooms/ABC123/v1",
  apiKey: "not-needed",
});

const response = await client.chat.completions.create({
  model: "*",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

## curl / HTTP

```bash
# Chat Completions (non-streaming)
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Chat Completions (streaming)
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model:llama3",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Responses API
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model": "*", "input": "Hello!"}'

# List available models
curl http://localhost:3000/rooms/ABC123/v1/models
```

## Programmatic Room Management

Use the SDK's HTTP client to create rooms and manage participants from code:

```typescript
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });

// Create a room
const { room } = await client.create("My Room");
console.log(room.code); // "ABC123"

// Join as a participant
await client.join(room.code, {
  id: "my-bot",
  nickname: "Bot",
  model: "llama3",
  endpoint: "http://localhost:11434",
});

// Keep alive (call every 10s)
setInterval(() => client.healthCheck(room.code, "my-bot"), 10_000);

// List participants
const participants = await client.getParticipants(room.code);
```

Or use the HTTP API directly:

```bash
# Create room
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "My Room"}'

# Join
curl -X POST http://localhost:3000/rooms/ABC123/join \
  -H "Content-Type: application/json" \
  -d '{"id": "bot-1", "nickname": "Bot", "model": "llama3", "endpoint": "http://localhost:11434"}'

# Health check (every 10s)
curl -X POST http://localhost:3000/rooms/ABC123/health \
  -H "Content-Type: application/json" \
  -d '{"id": "bot-1"}'
```

See the [SDK Reference](/reference/sdk/) for the full `createClient` API and the [API Reference](/reference/api/) for all HTTP endpoints.

## Model Routing Cheatsheet

| `model` value | Behavior | Example |
|---------------|----------|---------|
| `*` or `any` | Random online participant | `"model": "*"` |
| `model:<name>` | First participant with that model | `"model": "model:llama3"` |
| `<participant-id>` | Specific participant by ID | `"model": "abc123"` |
| `<model-name>` | Tries participant ID first, then model match | `"model": "llama3"` |
