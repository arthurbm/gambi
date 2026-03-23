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

## Local Network Discovery

For local Node.js or Bun applications, the SDK can discover hubs and rooms announced over mDNS/Bonjour.

These helpers are optional. `createGambi()` and `createClient()` stay explicit and keep working with `hubUrl` and `roomCode` directly.

```typescript
import { createClient, createGambi, resolveGambiTarget } from "gambi-sdk";
// or import only discovery: import { resolveGambiTarget } from "gambi-sdk/discovery";

const target = await resolveGambiTarget({
  roomCode: "ABC123", // optional if exactly one room is available
  timeoutMs: 1500,
});

const gambi = createGambi({
  hubUrl: target.hubUrl,
  roomCode: target.roomCode,
});

const client = createClient({ hubUrl: target.hubUrl });
```

### `discoverHubs(options?)`

Discover reachable hubs from the configured `hubUrl` seed plus mDNS services on the local network.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hubUrl` | `string` | `http://localhost:3000` | Seed hub to probe before mDNS results |
| `timeoutMs` | `number` | `1500` | How long to listen for mDNS announcements |

Returns `Promise<DiscoveredHub[]>`.

### `discoverRooms(options?)`

Discover rooms by listing `/rooms` on each reachable hub found by `discoverHubs()`.

The options are the same as `discoverHubs(options?)`.

Returns `Promise<DiscoveredRoom[]>`.

### `resolveGambiTarget(options?)`

Resolve one room to a concrete `{ hubUrl, roomCode }` target you can pass into `createGambi()` or `createClient()`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `roomCode` | `string` | — | Resolve a specific room code across discovered hubs |
| `roomName` | `string` | — | Resolve a specific room name across discovered hubs |
| `hubUrl` | `string` | `http://localhost:3000` | Seed hub to probe before mDNS results |
| `timeoutMs` | `number` | `1500` | How long to listen for mDNS announcements |

Behavior:

- if exactly one room matches, it returns a `ResolvedGambiTarget`
- if no rooms are found, it throws `DiscoveryError`
- if multiple rooms match, it throws `DiscoveryError` with `code = "AMBIGUOUS_ROOM_MATCH"`

### `DiscoveryError`

Typed error thrown by `resolveGambiTarget()`.

| Field | Type | Description |
|-------|------|-------------|
| `code` | `"NO_HUBS_FOUND" \| "NO_ROOMS_FOUND" \| "ROOM_NOT_FOUND" \| "AMBIGUOUS_ROOM_MATCH"` | Discovery failure category |
| `matches` | `DiscoveredRoom[]` | Matching rooms when resolution is ambiguous |

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

## Querying the Room

### `gambi.listModels()`

Returns all models available in the room.

```typescript
const models = await gambi.listModels();
// [{ id, nickname, model, endpoint, capabilities }]
```

Each entry is a `GambiModel`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Participant ID |
| `nickname` | `string` | Display name |
| `model` | `string` | Model name (e.g. `"llama3"`) |
| `endpoint` | `string` | Participant endpoint URL |
| `capabilities` | `object` | `{ openResponses, chatCompletions }` — `"supported"`, `"not-supported"`, or `"unknown"` |

### `gambi.listParticipants()`

Returns all participants in the room with their full info (status, specs, config).

```typescript
const participants = await gambi.listParticipants();
for (const p of participants) {
  console.log(p.nickname, p.model, p.status);
}
```

### `gambi.baseURL`

The computed base URL for the room's OpenAI-compatible API. Useful when you need to pass the URL to another tool or library.

```typescript
console.log(gambi.baseURL);
// "http://localhost:3000/rooms/ABC123/v1"
```

## HTTP Client — `createClient(options)`

The SDK also exports an HTTP client for managing rooms and participants programmatically. This is separate from the AI SDK provider — use it when you need to create rooms, join participants, or manage lifecycle from code.

```typescript
import { createClient } from "gambi-sdk";

const client = createClient({
  hubUrl: "http://localhost:3000", // default
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hubUrl` | `string` | `http://localhost:3000` | Hub URL |

### `client.create(name, passwordOrOptions?)`

Create a new room. Returns `{ room, hostId }`.

```typescript
const { room, hostId } = await client.create("My Room");
console.log(room.code); // "ABC123"

// With password
const { room } = await client.create("Private Room", "secret123");

// With password and runtime defaults
const { room } = await client.create("Room", {
  password: "secret",
  defaults: { temperature: 0.7 },
});
```

### `client.list()`

List all rooms. Returns `RoomInfoPublic[]`.

```typescript
const rooms = await client.list();
for (const room of rooms) {
  console.log(room.code, room.name);
}
```

### `client.join(code, participant)`

Join a room as a participant.

```typescript
const { participant, roomId } = await client.join("ABC123", {
  id: "my-bot",
  nickname: "Bot",
  model: "llama3",
  endpoint: "http://localhost:11434",
  password: "secret123", // if room is protected
});
```

Full participant options:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique participant ID |
| `nickname` | `string` | yes | Display name |
| `model` | `string` | yes | Model name |
| `endpoint` | `string` | yes | LLM endpoint URL |
| `password` | `string` | no | Room password |
| `specs` | `object` | no | Machine specs (CPU, RAM, GPU) |
| `config` | `RuntimeConfig` | no | Runtime config overrides |
| `capabilities` | `object` | no | Protocol capabilities |
| `authHeaders` | `object` | no | Auth headers for the endpoint (kept in memory only) |

### `client.leave(code, participantId)`

Remove a participant from a room.

```typescript
await client.leave("ABC123", "my-bot");
```

### `client.getParticipants(code)`

List all participants in a room. Returns `ParticipantInfo[]`.

```typescript
const participants = await client.getParticipants("ABC123");
```

### `client.healthCheck(code, participantId)`

Send a health check heartbeat. Participants must send this every 10 seconds to stay online (30 seconds timeout = offline).

```typescript
// Keep alive loop
setInterval(() => {
  client.healthCheck("ABC123", "my-bot");
}, 10_000);
```

### `ClientError`

All client methods throw `ClientError` on failure. It includes the HTTP status and response body.

```typescript
import { ClientError } from "gambi-sdk";

try {
  await client.join("INVALID", { /* ... */ });
} catch (err) {
  if (err instanceof ClientError) {
    console.error(err.status);   // 404
    console.error(err.response); // { error: "Room not found" }
  }
}
```

## Key Types

| Type | Import | Description |
|------|--------|-------------|
| `GambiProvider` | `gambi-sdk` | Return type of `createGambi()` |
| `GambiClient` | `gambi-sdk` | Return type of `createClient()` |
| `GambiModel` | `gambi-sdk` | Model info from `listModels()` |
| `ParticipantInfo` | `gambi-sdk` | Full participant info |
| `RoomInfoPublic` | `gambi-sdk` | Room info from `client.list()` |
| `RuntimeConfig` | `gambi-sdk` | Generation config (temperature, maxTokens, etc.) |
| `ClientError` | `gambi-sdk` | Error class for client failures |
