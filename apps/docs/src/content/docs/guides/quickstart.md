---
title: Quick Start
description: Get up and running with Gambiarra in minutes.
---

This tutorial walks you through setting up Gambiarra from scratch. By the end, you'll have a hub running with participants sharing LLMs on your network.

## What You'll Need

- **A machine to run the hub** — any computer on the network (doesn't need a GPU, it just routes traffic)
- **At least one LLM endpoint** — Ollama, LM Studio, vLLM, or any OpenAI-compatible API
- **Bun or Node.js** installed

## Installation

### CLI

The CLI allows you to start hubs, create rooms, and join as a participant.

**Via curl (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/install.sh | bash
```

**Via npm:**

```bash
npm install -g gambiarra
```

**Via bun:**

```bash
bun add -g gambiarra
```

### SDK

The SDK provides [Vercel AI SDK](https://sdk.vercel.ai/) integration for using shared LLMs in your TypeScript/JavaScript applications. It defaults to the Responses API and also supports Chat Completions.

```bash
npm install gambiarra-sdk
# or
bun add gambiarra-sdk
```

## Basic Usage

### 1. Start the Hub Server

Pick a machine on the network to be the hub. It doesn't need a GPU — the hub only routes requests between participants.

```bash
gambiarra serve --port 3000 --mdns
```

The `--mdns` flag enables auto-discovery so other machines on the network can find the hub automatically.

### 2. Create a Room

```bash
gambiarra create --name "My Room"
# Output: Room created! Code: ABC123
```

Share this code with everyone who wants to join — via chat, projector, sticky note, whatever works.

### 3. Join with Your LLM

Each person with an LLM endpoint joins the room:

```bash
gambiarra join --code ABC123 \
  --model llama3 \
  --nickname joao
```

The default endpoint is `http://localhost:11434` (Ollama). For other providers, use `--endpoint`:

```bash
# LM Studio
gambiarra join --code ABC123 --model mistral --endpoint http://localhost:1234

# vLLM
gambiarra join --code ABC123 --model llama3 --endpoint http://localhost:8000
```

The CLI will probe your endpoint, detect available models, and register you in the room. Once joined, your LLM is available to everyone in the room.

### 4. Use the SDK

Now anyone can use the shared LLMs from their code:

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});

// Send to any available participant
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Hello, Gambiarra!",
});

console.log(result.text);
```

You can also target specific models or participants:

```typescript
// Use a specific model
const result = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "Explain quantum computing",
});

// Use a specific participant
const result = await generateText({
  model: gambiarra.participant("joao"),
  prompt: "Write a haiku",
});
```

To use Chat Completions instead of the default Responses API:

```typescript
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
  defaultProtocol: "chatCompletions",
});
```

### 5. Use the API Directly

No SDK needed. The hub is an OpenAI-compatible API — use it from any language or tool:

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Any tool that accepts a custom OpenAI base URL works — Lovable, Cursor, Open WebUI, Python's `openai` library, etc. Just point it at:

```
http://<hub-ip>:<port>/rooms/<ROOM_CODE>/v1
```

See the [API Reference](/reference/api/) for all available endpoints.

## Next Steps

- Learn about [CLI commands](/reference/cli/)
- Explore [SDK usage](/reference/sdk/)
- See the full [API Reference](/reference/api/)
- Using cloud LLMs? See [Remote Providers](/guides/remote-providers/)
- Running a group event? See [Challenges & Dynamics](/guides/challenges/)
