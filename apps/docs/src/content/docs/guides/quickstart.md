---
title: Quick Start
description: Get up and running with Gambiarra in minutes.
---

This guide will help you set up Gambiarra and start sharing LLMs on your network.

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

The SDK provides Vercel AI SDK integration for using shared LLMs in your applications.
It defaults to `OpenResponses` and keeps legacy `chat/completions` available explicitly.

```bash
npm install gambiarra-sdk
# or
bun add gambiarra-sdk
```

## Basic Usage

### 1. Start the Hub Server

```bash
gambiarra serve --port 3000 --mdns
```

### 2. Create a Room

```bash
gambiarra create
# Output: Room created! Code: ABC123
```

### 3. Join with Your LLM

```bash
gambiarra join ABC123 \
  --endpoint http://localhost:11434 \
  --model llama3 \
  --nickname joao
```

### 4. Use the SDK

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});

const result = await generateText({
  model: gambiarra.any(),
  prompt: "Hello, Gambiarra!",
});

console.log(result.text);
```

If you need explicit legacy mode:

```typescript
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
  defaultProtocol: "chatCompletions",
});
```

## Next Steps

- Learn about [CLI commands](/reference/cli/)
- Explore [SDK usage](/reference/sdk/)
