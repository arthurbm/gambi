---
title: SDK Reference
description: Reference for the Gambi SDK provider, management client, participant session runtime, and discovery helpers.
---

The Gambi SDK exposes four distinct surfaces:

- `createGambi()` for inference through the room-scoped OpenAI-compatible endpoints
- `createClient()` for management operations against the native `/v1` API
- `createParticipantSession()` for running a tunnel-backed participant session
- discovery helpers for local-network hub and room resolution

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
| `createParticipantSession()` | participant runtime | management API + participant tunnel |
| discovery helpers | local-network room and hub resolution | mDNS + management API |

## `createGambi(options)`

Create a provider instance for application inference.

```ts
import { createGambi } from "gambi-sdk";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `roomCode` | `string` | — | room code to connect to |
| `hubUrl` | `string` | `http://localhost:3000` | hub URL |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | default protocol for top-level routing helpers |

### Model routing

The provider offers three routing strategies, all compatible with AI SDK v5.

```ts
import { generateText } from "ai";

await generateText({ model: gambi.any(), prompt: "..." });
await generateText({ model: gambi.model("llama3"), prompt: "..." });
await generateText({ model: gambi.participant("worker-1"), prompt: "..." });
```

| Helper | Selects | Use when |
| --- | --- | --- |
| `gambi.any()` | a random available participant | any online participant is acceptable |
| `gambi.model(name)` | the first available participant exposing `name` | you need a specific model but not a specific machine |
| `gambi.participant(id)` | the participant with that id | you need exact targeting (affinity, debugging, benchmarking) |

A participant is available only when its tunnel is connected, it is not offline, and it is not already handling another request.

### Protocol selection

The provider defaults to `openResponses`.

```ts
gambi.any();
gambi.model("llama3");
gambi.participant("worker-1");

gambi.openResponses.any();
gambi.chatCompletions.any();
```

Use `chatCompletions` only when you need explicit compatibility. New integrations should prefer the default Responses path.

### Streaming

Streaming works through the AI SDK like any other provider.

```ts
import { streamText } from "ai";

const result = streamText({
  model: gambi.any(),
  prompt: "Write a haiku about local-first infrastructure.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

You can also call the inference API directly with `fetch` and `stream: true` against `${gambi.baseURL}/responses` or `${gambi.baseURL}/chat/completions`.

### `gambi.listModels()`

Return room models in an OpenAI-compatible list shape.

Each `GambiModel` includes a `gambi` extension with:

- `nickname`
- `model`
- `endpoint`
- `capabilities`
- `connection`

`connection` exposes the participant tunnel state seen by the hub.

### `gambi.listParticipants()`

Return management-plane participant summaries for the room.

### `gambi.baseURL`

Return the room-scoped OpenAI-compatible base URL.

## `createClient(options)`

Create the management client.

```ts
import { createClient } from "gambi-sdk";

const client = createClient({
  hubUrl: "http://localhost:3000",
});
```

All management methods return `{ data, meta }` envelopes.

### Namespaces

| Namespace | Methods |
| --- | --- |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `upsert`, `list`, `remove`, `heartbeat` |
| `client.events` | `watchRoom` |

### `client.rooms.create(input)`

```ts
const created = await client.rooms.create({
  name: "Demo",
  password: "secret",
  defaults: { temperature: 0.4 },
});

console.log(created.data.room.code);
console.log(created.data.hostId);
```

### `client.rooms.get(roomCode)`

```ts
const { data } = await client.rooms.get("ABC123");
console.log(data.participantCount, data.passwordProtected);
```

### `client.rooms.list()`

```ts
const { data } = await client.rooms.list();
for (const room of data) {
  console.log(room.code, room.name, room.participantCount);
}
```

### `client.participants.upsert(roomCode, participantId, input)`

Create or update a participant registration.

```ts
const result = await client.participants.upsert("ABC123", "worker-1", {
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
  capabilities: {
    openResponses: "supported",
    chatCompletions: "supported",
  },
});

console.log(result.data.tunnel.url);
```

Input fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `nickname` | `string` | yes | display name |
| `model` | `string` | yes | model name |
| `endpoint` | `string` | yes | participant-local endpoint URL |
| `password` | `string` | no | room password |
| `specs` | `object` | no | machine specs |
| `config` | `RuntimeConfig` | no | participant runtime defaults |
| `capabilities` | `object` | no | protocol capability summary |

Return fields:

| Field | Type | Description |
| --- | --- | --- |
| `participant` | `ParticipantSummary` | public participant state |
| `roomId` | `string` | internal room identifier |
| `tunnel` | `TunnelBootstrap` | one-time tunnel bootstrap |

This method is retry-safe because the underlying management route is idempotent. The tunnel bootstrap token is single-use and short-lived.

### `client.participants.list(roomCode)`

```ts
const { data } = await client.participants.list("ABC123");
for (const participant of data) {
  console.log(participant.id, participant.status, participant.connection);
}
```

### `client.participants.heartbeat(roomCode, participantId)`

Send one heartbeat. Call this every ten seconds while your own participant runtime is alive. The hub marks a participant offline after thirty seconds without a heartbeat.

```ts
setInterval(() => {
  client.participants.heartbeat("ABC123", "worker-1").catch(console.error);
}, 10_000);
```

Both cadence and timeout come from `HEALTH_CHECK_INTERVAL` and `PARTICIPANT_TIMEOUT` in `@gambi/core`. If you use `createParticipantSession()`, this loop is managed for you.

### `client.participants.remove(roomCode, participantId)`

```ts
await client.participants.remove("ABC123", "worker-1");
```

### `client.events.watchRoom({ roomCode, signal? })`

Watch room events as an async iterable.

```ts
const controller = new AbortController();

for await (const event of client.events.watchRoom({
  roomCode: "ABC123",
  signal: controller.signal,
})) {
  console.log(event.type, event.data);
}
```

Event types:

- `connected`
- `room.created`
- `participant.joined`
- `participant.updated`
- `participant.left`
- `participant.offline`
- `llm.request`
- `llm.complete`
- `llm.error`

See [Observability](/reference/observability/) for the payload shapes of the `llm.*` events.

## `createParticipantSession(options)`

Create and manage a tunnel-backed participant runtime.

```ts
import { createParticipantSession } from "gambi-sdk";

const session = await createParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "worker-1",
  nickname: "worker-1",
  endpoint: "http://localhost:11434",
  model: "llama3",
  authHeaders: {
    Authorization: `Bearer ${process.env.PROVIDER_TOKEN}`,
  },
});

await session.waitUntilClosed();
```

What it does:

1. Probe the local endpoint.
2. Register the participant through the management API.
3. Open the participant tunnel.
4. Forward tunnel requests to the local provider endpoint.
5. Keep sending management heartbeats every ten seconds and tunnel pings on the same cadence.

`authHeaders` stay local to the participant runtime. They are applied only when the runtime talks to the provider endpoint.

For a walkthrough, see [Custom participant runtime](/guides/custom-participant/).

### Session return shape

| Field | Type | Description |
| --- | --- | --- |
| `participant` | registered participant summary |
| `roomId` | room identifier |
| `tunnel` | tunnel bootstrap details |
| `close()` | best-effort graceful shutdown |
| `waitUntilClosed()` | await final session close reason |

Close reasons:

- `"closed"` — shutdown initiated by `close()` or a received signal
- `"heartbeat_failed"` — the management heartbeat loop failed repeatedly
- `"tunnel_closed"` — the WebSocket tunnel was closed from either side

## Discovery helpers

Discovery remains optional. `createGambi()` and `createClient()` stay explicit — they never perform implicit discovery.

Available helpers:

- `discoverHubs(options?)`
- `discoverRooms(options?)`
- `resolveGambiTarget(options?)`

Common options (`DiscoveryOptions`):

| Option | Type | Description |
| --- | --- | --- |
| `hubUrl` | `string` | skip mDNS and query this hub directly |
| `timeoutMs` | `number` | how long to wait for mDNS responses |
| `fetchFn` | `typeof fetch` | custom fetch (tests, proxies) |
| `browseServices` | `BrowseServicesLike` | custom mDNS browser |

`resolveGambiTarget()` also accepts `roomCode` and `roomName` for picking a single room.

### Example

```ts
import { createGambi, resolveGambiTarget } from "gambi-sdk";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
  timeoutMs: 1500,
});

const gambi = createGambi({
  hubUrl: target.hubUrl,
  roomCode: target.roomCode,
});
```

### `DiscoveryError`

Thrown when discovery cannot produce a unique target.

Codes:

- `NO_HUBS_FOUND`
- `NO_ROOMS_FOUND`
- `ROOM_NOT_FOUND`
- `AMBIGUOUS_ROOM_MATCH` (inspect `error.matches`)

## Errors

Management operations throw `ClientError`.

Important fields:

- `status` — HTTP status
- `code` — Gambi error code (e.g. `ROOM_NOT_FOUND`, `PARTICIPANT_TUNNEL_NOT_CONNECTED`)
- `hint` — operator-readable next step
- `details` — optional structured payload from the hub
- `requestId` — correlates with hub logs and SSE events

```ts
import { ClientError } from "gambi-sdk";

try {
  await client.rooms.get("ZZZZZZ");
} catch (error) {
  if (error instanceof ClientError && error.code === "ROOM_NOT_FOUND") {
    console.warn(error.hint);
    return;
  }
  throw error;
}
```
