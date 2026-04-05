---
title: SDK Reference
description: Reference for the Gambi SDK provider, management client, and discovery helpers.
---

The Gambi SDK exposes two distinct entry points:

- `createGambi()` for inference through the room-scoped OpenAI-compatible endpoints
- `createClient()` for management operations against the native `/v1` API

## Installation

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

## SDK surfaces

| Surface | Primary use | Transport |
| --- | --- | --- |
| `createGambi()` | application inference | `/rooms/:code/v1/*` |
| `createClient()` | operational control | `/v1/*` |
| discovery helpers | local-network room and hub resolution | mDNS + management API |

## When to use what

| Use case | Recommended API |
| --- | --- |
| send prompts and receive model output | `createGambi()` |
| create a room or inspect rooms | `createClient().rooms.*` |
| register or remove participants | `createClient().participants.*` |
| watch live room events | `createClient().events.watchRoom()` |
| discover hubs and rooms on the local network | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()` |

## Local Network Discovery

For local Node.js and Bun applications, the SDK can discover hubs and rooms announced over mDNS/Bonjour.

These helpers are optional. `createGambi()` and `createClient()` stay explicit and keep working with `hubUrl` and `roomCode` directly.

```ts
import { createClient, createGambi, resolveGambiTarget } from "gambi-sdk";
// or import only discovery helpers:
// import { resolveGambiTarget } from "gambi-sdk/discovery";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
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
| --- | --- | --- | --- |
| `hubUrl` | `string` | `http://localhost:3000` | seed hub to probe before mDNS results |
| `timeoutMs` | `number` | `1500` | how long to listen for mDNS announcements |

Returns `Promise<DiscoveredHub[]>`.

Each discovered hub includes:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | display name for the hub |
| `hubUrl` | `string` | resolved base URL |
| `source` | `"configured" \| "mdns"` | where the hub came from |
| `host` | `string` | advertised host |
| `port` | `number` | advertised port |
| `addresses` | `string[]` | resolved addresses |
| `txt` | `Record<string, string>` | mDNS TXT records |

### `discoverRooms(options?)`

Discover rooms by listing `/v1/rooms` on each reachable hub found by `discoverHubs()`.

The options are the same as `discoverHubs(options?)`.

Returns `Promise<DiscoveredRoom[]>`.

Each discovered room extends the room summary with:

| Field | Type | Description |
| --- | --- | --- |
| `hubName` | `string` | human-readable hub name |
| `hubSource` | `"configured" \| "mdns"` | discovery source |
| `hubUrl` | `string` | hub base URL for the room |

### `resolveGambiTarget(options?)`

Resolve one room to a concrete `{ hubUrl, roomCode }` target you can pass into `createGambi()` or `createClient()`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `roomCode` | `string` | — | resolve a specific room code across discovered hubs |
| `roomName` | `string` | — | resolve a specific room name across discovered hubs |
| `hubUrl` | `string` | `http://localhost:3000` | seed hub to probe before mDNS results |
| `timeoutMs` | `number` | `1500` | how long to listen for mDNS announcements |

Behavior:

- if exactly one room matches, it returns a `ResolvedGambiTarget`
- if no hubs are found, it throws `DiscoveryError` with `code = "NO_HUBS_FOUND"`
- if no rooms are found, it throws `DiscoveryError` with `code = "NO_ROOMS_FOUND"`
- if no room matches the requested filters, it throws `DiscoveryError` with `code = "ROOM_NOT_FOUND"`
- if multiple rooms match, it throws `DiscoveryError` with `code = "AMBIGUOUS_ROOM_MATCH"`

### `DiscoveryError`

Typed error thrown by discovery helpers such as `resolveGambiTarget()`.

| Field | Type | Description |
| --- | --- | --- |
| `code` | `"NO_HUBS_FOUND" \| "NO_ROOMS_FOUND" \| "ROOM_NOT_FOUND" \| "AMBIGUOUS_ROOM_MATCH"` | discovery failure category |
| `matches` | `DiscoveredRoom[]` | matching rooms when resolution is ambiguous |

## Inference provider

## `createGambi(options)`

Creates a Gambi provider instance.

```ts
import { createGambi } from "gambi-sdk";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `roomCode` | `string` | — | room code to connect to. Required. |
| `hubUrl` | `string` | `http://localhost:3000` | hub URL |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | protocol used by the top-level routing helpers |

## Protocol selection

The SDK defaults to `openResponses`. Both protocols are first-class:

```ts
// Default: Responses API
const gambi = createGambi({
  roomCode: "ABC123",
});

// Chat Completions
const legacy = createGambi({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});
```

You can also select per-call via namespaces:

```ts
gambi.openResponses.any();   // Responses API
gambi.chatCompletions.any(); // Chat Completions
```

## Model routing

Three routing methods are available. All return a Vercel AI SDK model instance.

| Method | Description |
| --- | --- |
| `gambi.any()` | routes to a random online participant |
| `gambi.participant(id)` | routes to a specific participant by ID |
| `gambi.model(name)` | routes to the first online participant with that model |

Examples:

```ts
gambi.any();
gambi.participant("worker-1");
gambi.model("llama3");
```

All routing methods are also available under `gambi.openResponses.*` and `gambi.chatCompletions.*`.

## Streaming

Use `streamText` from the Vercel AI SDK:

```ts
import { streamText } from "ai";

const stream = await streamText({
  model: gambi.any(),
  prompt: "Write a story",
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Generation options

Standard Vercel AI SDK options are supported:

```ts
const result = await generateText({
  model: gambi.any(),
  prompt: "Explain recursion",
  temperature: 0.7,
  maxTokens: 500,
});
```

See the [Vercel AI SDK docs](https://sdk.vercel.ai/docs) for the full generation surface.

## Querying the room

### `gambi.listModels()`

Returns all models available in the room.

```ts
const models = await gambi.listModels();
```

Each entry is a `GambiModel`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | participant ID |
| `nickname` | `string` | display name |
| `model` | `string` | model name, such as `"llama3"` |
| `endpoint` | `string` | participant endpoint URL |
| `capabilities` | `object` | `{ openResponses, chatCompletions }` capability summary |

### `gambi.listParticipants()`

Returns all participants in the room using the management API.

```ts
const participants = await gambi.listParticipants();
for (const participant of participants) {
  console.log(participant.nickname, participant.model, participant.status);
}
```

### `gambi.baseURL`

The computed base URL for the room's OpenAI-compatible API. Useful when you need to pass the URL to another tool or library.

```ts
console.log(gambi.baseURL);
// "http://localhost:3000/rooms/ABC123/v1"
```

## Management client

## `createClient(options)`

The SDK also exports an HTTP client for managing rooms and participants programmatically. This is separate from the AI SDK provider.

```ts
import { createClient } from "gambi-sdk";

const client = createClient({
  hubUrl: "http://localhost:3000",
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `hubUrl` | `string` | `http://localhost:3000` | hub URL |

Management methods return enveloped results:

```ts
const result = await client.rooms.list();
console.log(result.data);
console.log(result.meta.requestId);
```

### Namespace overview

| Namespace | Methods |
| --- | --- |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `upsert`, `list`, `remove`, `heartbeat` |
| `client.events` | `watchRoom` |

### `client.rooms.create(input)`

Create a new room. Returns `{ data: { room, hostId }, meta }`.

```ts
const created = await client.rooms.create({
  name: "Demo",
  password: "secret",
  defaults: { temperature: 0.4 },
});

console.log(created.data.room.code);
```

Input fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | room name |
| `password` | `string` | no | room password |
| `defaults` | `RuntimeConfig` | no | room runtime defaults |

### `client.rooms.get(roomCode)`

Fetch one room summary.

```ts
const room = await client.rooms.get("ABC123");
console.log(room.data.name);
```

### `client.rooms.list()`

List all room summaries.

```ts
const rooms = await client.rooms.list();
for (const room of rooms.data) {
  console.log(room.code, room.name);
}
```

### `client.participants.upsert(roomCode, participantId, input)`

Create or update a participant registration. This maps to the idempotent management route.

```ts
const registered = await client.participants.upsert("ABC123", "worker-1", {
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://192.168.1.25:11434",
  capabilities: {
    openResponses: "supported",
    chatCompletions: "supported",
  },
});
```

Input fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nickname` | `string` | yes | display name |
| `model` | `string` | yes | model name |
| `endpoint` | `string` | yes | participant endpoint URL |
| `password` | `string` | no | room password |
| `specs` | `object` | no | machine specs |
| `config` | `RuntimeConfig` | no | participant runtime defaults |
| `capabilities` | `object` | no | protocol capability summary |
| `authHeaders` | `object` | no | endpoint auth headers, kept only in hub memory |

This method is retry-safe because the underlying management route is idempotent.

### `client.participants.list(roomCode)`

List all participants in a room.

```ts
const participants = await client.participants.list("ABC123");
```

### `client.participants.remove(roomCode, participantId)`

Remove a participant from a room.

```ts
await client.participants.remove("ABC123", "worker-1");
```

### `client.participants.heartbeat(roomCode, participantId)`

Send one health check heartbeat.

```ts
await client.participants.heartbeat("ABC123", "worker-1");
```

Participants must keep sending heartbeats to stay online. The hub currently uses:

| Constant | Value |
| --- | --- |
| heartbeat interval | `10_000 ms` |
| offline timeout | `30_000 ms` |

### `client.events.watchRoom({ roomCode, signal? })`

Watch room events as an async iterable.

```ts
for await (const event of client.events.watchRoom({ roomCode: "ABC123" })) {
  console.log(event.type, event.data);
}
```

The yielded event shape mirrors the management SSE contract:

| Field | Type | Description |
| --- | --- | --- |
| `type` | `string` | event name |
| `timestamp` | `number` | event timestamp in milliseconds |
| `roomCode` | `string` | room identifier |
| `data` | `unknown` | event payload |

## Errors

## `ClientError`

Management operations throw `ClientError` on failure.

| Field | Type | Description |
| --- | --- | --- |
| `status` | `number` | HTTP status |
| `code` | `string \| undefined` | typed management error code |
| `hint` | `string \| undefined` | human-readable remediation hint |
| `details` | `unknown` | optional structured details |
| `requestId` | `string \| undefined` | management request identifier |

Example:

```ts
import { ClientError } from "gambi-sdk";

try {
  await client.rooms.get("INVALID");
} catch (error) {
  if (error instanceof ClientError) {
    console.error(error.status);
    console.error(error.code);
    console.error(error.hint);
    console.error(error.requestId);
  }
}
```

## Key types

| Type | Description |
| --- | --- |
| `GambiProvider` | return type of `createGambi()` |
| `GambiClient` | return type of `createClient()` |
| `GambiModel` | model info from `gambi.listModels()` |
| `DiscoveredHub` | hub discovered through configured seed or mDNS |
| `DiscoveredRoom` | discovered room with hub metadata |
| `ResolvedGambiTarget` | resolved `{ hub, room }` target |
| `RoomSummary` | room summary transport type |
| `ParticipantSummary` | participant summary transport type |
| `RoomEvent` | typed room event payload |
| `ClientError` | management client error type |
