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

Management methods return `{ data, meta }` envelopes.

### Namespaces

| Namespace | Methods |
| --- | --- |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `upsert`, `list`, `remove`, `heartbeat` |
| `client.events` | `watchRoom` |

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

This method is retry-safe because the underlying management route is idempotent.

### `client.events.watchRoom({ roomCode, signal? })`

Watch room events as an async iterable.

```ts
for await (const event of client.events.watchRoom({ roomCode: "ABC123" })) {
  console.log(event.type, event.data);
}
```

Important observability events:

- `llm.request`
- `llm.complete`
- `llm.error`

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
5. Keep sending management heartbeats and tunnel pings.

`authHeaders` stay local to the participant runtime. They are applied only when the runtime talks to the provider endpoint.

### Session return shape

| Field | Type | Description |
| --- | --- | --- |
| `participant` | registered participant summary |
| `roomId` | room identifier |
| `tunnel` | tunnel bootstrap details |
| `close()` | best-effort graceful shutdown |
| `waitUntilClosed()` | await final session close reason |

Close reasons:

- `"closed"`
- `"heartbeat_failed"`
- `"tunnel_closed"`

## Discovery helpers

Discovery remains optional. `createGambi()` and `createClient()` stay explicit.

Available helpers:

- `discoverHubs()`
- `discoverRooms()`
- `resolveGambiTarget()`

Use them for local-network Node.js or Bun apps that should find a hub or room dynamically before creating the provider.

## Errors

Management operations throw `ClientError`.

Important fields:

- `status`
- `code`
- `hint`
- `details`
- `requestId`
