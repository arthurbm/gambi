---
title: Using Gambi with AI tools
description: Use a Gambi room as an OpenAI-compatible model backend in editors, SDKs, and scripts.
---

Every Gambi room is an OpenAI-compatible API. Any tool or library that lets you set a custom OpenAI base URL can send requests to the model participants in a room. Harness participants (Claude Code, Codex, OpenCode) do not serve these requests; applications reach them through the [harness attach channel](#programmatic-management).

## Connection details

Every Gambi room exposes an OpenAI-compatible base URL:

| Setting | Value |
| --- | --- |
| Base URL | `http://<hub-ip>:<port>/rooms/<ROOM_CODE>/v1` |
| API key | any non-empty string (the hub ignores it) |
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

## Editors and chat apps

Any tool that supports a custom OpenAI-compatible endpoint can point at Gambi:

- Base URL: `http://<hub-ip>:3000/rooms/<CODE>/v1`
- API key: `gambi`
- Model: `*` or `model:<name>`

This works for tools that send requests from your machine or your network, such as Cline or a self-hosted Open WebUI. Hosted products that call the model from their own servers cannot reach a hub on a private network, and the hub must not be exposed to the internet without your own authentication layer in front of it.

## Python example

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

## TypeScript example

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

## OpenAI SDK example

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

## curl example

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

## Programmatic management

```ts
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });

const created = await client.rooms.create({ name: "My Room" });
console.log(created.data.room.code);

const participants = await client.participants.list(created.data.room.code);
console.log(participants.data);
```

Harness participants are managed separately from OpenAI-compatible inference. Attach to one when an app needs its ACP stream or artifacts:

```ts
const channel = await client.harness.attach({
  roomCode: created.data.room.code,
  participantId: "harness-1",
});

for await (const frame of channel.messages) {
  console.log(frame.type, frame.sessionId);
}
```

They stay out of `*`, `model:<name>`, and participant-id inference routing.

See the [SDK reference](/reference/sdk/) and the [API reference](/reference/api/) for the full contracts.
