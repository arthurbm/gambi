---
title: SDK Reference
description: Complete reference for the Gambiarra SDK.
---

The Gambiarra SDK provides a [Vercel AI SDK](https://sdk.vercel.ai/) provider for using shared LLMs through a Gambiarra hub.

## Installation

```bash
npm install gambiarra-sdk
# or
bun add gambiarra-sdk
```

## `createGambiarra(options)`

Creates a Gambiarra provider instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `roomCode` | `string` | — | Room code to connect to. Required. |
| `hubUrl` | `string` | Auto-discover via mDNS | Hub URL (e.g. `http://localhost:3000`) |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | Protocol used by the top-level routing helpers |

```typescript
import { createGambiarra } from "gambiarra-sdk";

const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});
```

## Protocol Selection

The SDK defaults to `openResponses`. Both protocols are first-class:

```typescript
// Default: Responses API
const gambiarra = createGambiarra({
  roomCode: "ABC123",
});

// Chat Completions
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});
```

You can also select per-call via namespaces:

```typescript
gambiarra.openResponses.any();      // Responses API
gambiarra.chatCompletions.any();    // Chat Completions
```

## Model Routing

Three routing methods are available. All return a Vercel AI SDK model instance.

### `gambiarra.any()`

Routes to a random online participant.

```typescript
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Hello",
});
```

### `gambiarra.participant(id)`

Routes to a specific participant by nickname or ID.

```typescript
const result = await generateText({
  model: gambiarra.participant("alice"),
  prompt: "Hello",
});
```

### `gambiarra.model(name)`

Routes to the first online participant running the specified model.

```typescript
const result = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "Hello",
});
```

All routing methods are also available under `gambiarra.openResponses.*` and `gambiarra.chatCompletions.*`.

## Streaming

Use `streamText` from the Vercel AI SDK:

```typescript
import { streamText } from "ai";

const stream = await streamText({
  model: gambiarra.any(),
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
  model: gambiarra.any(),
  prompt: "Explain recursion",
  temperature: 0.7,
  maxTokens: 500,
});
```

See the [Vercel AI SDK docs](https://sdk.vercel.ai/docs) for all available options.
