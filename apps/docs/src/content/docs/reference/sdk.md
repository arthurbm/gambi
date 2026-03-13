---
title: SDK Reference
description: Complete reference for the Gambiarra SDK.
---

The Gambiarra SDK provides Vercel AI SDK integration for using shared LLMs in your applications.

The SDK is `OpenResponses-first` by default and keeps explicit legacy `chat/completions` support when you need it.

## Installation

```bash
npm install gambiarra-sdk
# or
bun add gambiarra-sdk
```

## Basic Usage

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
```

By default, `gambiarra.any()`, `gambiarra.model()`, and `gambiarra.participant()` use `openResponses`.

## Configuration

### `createGambiarra(options)`

Creates a Gambiarra provider instance.

**Options:**

| Option | Type | Description | Required |
|--------|------|-------------|----------|
| `roomCode` | `string` | Room code to connect to | Yes |
| `hubUrl` | `string` | Hub URL | No (auto-discover) |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | Default protocol used by the top-level routing helpers | No |

### Protocol Selection

Use the default `OpenResponses` mode:

```typescript
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  defaultProtocol: "openResponses",
});
```

Use explicit legacy `chat/completions` mode:

```typescript
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});
```

You can also choose explicitly per namespace:

```typescript
const gambiarra = createGambiarra({ roomCode: "ABC123" });

gambiarra.openResponses.any();
gambiarra.chatCompletions.any();
```

## Model Routing

### `gambiarra.any()`

Route to any available participant.

```typescript
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Explain quantum computing",
});
```

### `gambiarra.participant(id)`

Route to a specific participant by nickname.

```typescript
const result = await generateText({
  model: gambiarra.participant("joao"),
  prompt: "Write a haiku about TypeScript",
});
```

### `gambiarra.model(name)`

Route to a participant with a specific model.

```typescript
const result = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "What is the meaning of life?",
});
```

These routing helpers are also available under `gambiarra.openResponses` and `gambiarra.chatCompletions`.

## Streaming

```typescript
import { streamText } from "ai";

const stream = await streamText({
  model: gambiarra.model("llama3"),
  prompt: "Write a story about a robot",
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Advanced Options

```typescript
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Explain recursion",
  temperature: 0.7,
  maxTokens: 500,
});
```
