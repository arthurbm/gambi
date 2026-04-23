---
title: Using Gambi with AI Tools
description: Use Gambi as an OpenAI-compatible LLM backend in app builders, editors, SDKs, and scripts.
---

## What is Gambi?

Gambi is a local-first system for sharing LLM endpoints through a room-scoped hub. The hub does not run models itself. It routes requests to registered participants.

Participants now join through a tunnel-backed runtime, so their provider endpoint can stay local to their own machine.

## Connection Details

Every Gambi room exposes an OpenAI-compatible base URL:

| Setting | Value |
| --- | --- |
| Base URL | `http://<hub-ip>:<port>/rooms/<ROOM_CODE>/v1` |
| API Key | any non-empty string |
| Model | `*`, `model:<name>`, or `<participant-id>` |

Supported protocols:

- Responses API: default and preferred
- Chat Completions: compatibility path

## Prerequisites

```bash
# 1. Start the hub
gambi hub serve --port 3000

# 2. Create a room
gambi room create --name "My Room"

# 3. Join as a participant
gambi participant join --room ABC123 --participant-id bot-1 --model llama3
```

## App Builders and Editors

Any tool that supports a custom OpenAI-compatible endpoint can point at Gambi:

- Base URL: `http://<hub-ip>:3000/rooms/<CODE>/v1`
- API Key: `gambi`
- Model: `*` or `model:<name>`

That includes tools such as Cursor, Cline, Lovable, v0, Open WebUI, and similar products.

## Python Example

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.100:3000/rooms/ABC123/v1",
    api_key="not-needed",
)

response = client.responses.create(
    model="*",
    input="Hello!",
)

print(response.output_text)
```

## TypeScript Example

```ts
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://192.168.1.100:3000",
});

const result = await generateText({
  model: gambi.any(),
  prompt: "Explain recursion briefly",
});

console.log(result.text);
```

Use `defaultProtocol: "chatCompletions"` only if your tools or participants explicitly require it.

## OpenAI SDK Example

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://192.168.1.100:3000/rooms/ABC123/v1",
  apiKey: "not-needed",
});

const response = await client.responses.create({
  model: "*",
  input: "Hello!",
});

console.log(response.output_text);
```

## curl Example

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "input": "Hello!"
  }'
```

Compatibility example with Chat Completions:

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Programmatic Management

```ts
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });

const created = await client.rooms.create({ name: "My Room" });
console.log(created.data.room.code);

const participants = await client.participants.list(created.data.room.code);
console.log(participants.data);
```

See the reference docs for the full SDK and HTTP surfaces.
