---
title: SDK Reference
description: Complete reference for the Gambi SDK.
---

The Gambi SDK provides a [Vercel AI SDK](https://sdk.vercel.ai/) provider for using shared LLMs through a Gambi hub.

## Installation

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

## `createGambi(options)`

Creates a Gambi provider instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `roomCode` | `string` | — | Room code to connect to. Required. |
| `hubUrl` | `string` | `http://localhost:3000` | Hub URL |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | Protocol used by the top-level routing helpers |

```typescript
import { createGambi } from "gambi-sdk";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});
```

## Protocol Selection

The SDK defaults to `openResponses`. Both protocols are first-class:

```typescript
// Default: Responses API
const gambi = createGambi({
  roomCode: "ABC123",
});

// Chat Completions
const gambi = createGambi({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});
```

You can also select per-call via namespaces:

```typescript
gambi.openResponses.any();      // Responses API
gambi.chatCompletions.any();    // Chat Completions
```

## Model Routing

Three routing methods are available. All return a Vercel AI SDK model instance.

### `gambi.any()`

Routes to a random online participant.

```typescript
const result = await generateText({
  model: gambi.any(),
  prompt: "Hello",
});
```

### `gambi.participant(id)`

Routes to a specific participant by nickname or ID.

```typescript
const result = await generateText({
  model: gambi.participant("alice"),
  prompt: "Hello",
});
```

### `gambi.model(name)`

Routes to the first online participant running the specified model.

```typescript
const result = await generateText({
  model: gambi.model("llama3"),
  prompt: "Hello",
});
```

All routing methods are also available under `gambi.openResponses.*` and `gambi.chatCompletions.*`.

## Streaming

Use `streamText` from the Vercel AI SDK:

```typescript
import { streamText } from "ai";

const stream = await streamText({
  model: gambi.any(),
  prompt: "Write a story",
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Generation Options

Standard Vercel AI SDK options are supported:

```typescript
const result = await generateText({
  model: gambi.any(),
  prompt: "Explain recursion",
  temperature: 0.7,
  maxTokens: 500,
});
```

See the [Vercel AI SDK docs](https://sdk.vercel.ai/docs) for all available options.
