---
title: SDK reference
description: Reference for the Gambi SDK provider, management client, participant session runtime, and discovery helpers.
---

The Gambi SDK has five entry points:

- `createGambi()` for inference through the room-scoped OpenAI-compatible routes
- `createClient()` for management operations against the native `/v1` API
- `createParticipantSession()` for running a model participant over a tunnel
- `createHarnessParticipantSession()` for running a harness participant over a tunnel
- discovery helpers for finding hubs and rooms on the local network

## Installation

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

## Entry points

| Entry point | Primary use | Transport |
| --- | --- | --- |
| `createGambi()` | application inference | `/rooms/:code/v1/*` |
| `createClient()` | operational control | `/v1/*` |
| `createParticipantSession()` | participant runtime | management API + participant tunnel |
| `createHarnessParticipantSession()` | harness participant runtime | management API + participant tunnel |
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
| `roomCode` | `string` | none (required) | room code to connect to |
| `hubUrl` | `string` | `http://localhost:3000` | hub URL |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | default protocol for top-level routing helpers |

### Model routing

The provider offers three routing helpers. Each returns a `LanguageModelV3`, the model interface of AI SDK 6, so pass it to `generateText()`, `streamText()`, and the other AI SDK 6 functions. The package declares `ai` as an optional peer dependency (`^4 || ^5 || ^6`) and is built and tested against AI SDK 6.

```ts
import { generateText } from "ai";

await generateText({ model: gambi.any(), prompt: "..." });
await generateText({ model: gambi.model("llama3"), prompt: "..." });
await generateText({ model: gambi.participant("worker-1"), prompt: "..." });
```

| Helper | Selects | Use when |
| --- | --- | --- |
| `gambi.any()` | a random available participant | any available participant is acceptable |
| `gambi.model(name)` | the first available participant exposing `name` | you need a specific model but not a specific machine |
| `gambi.participant(id)` | the participant with that id | you need exact targeting (affinity, debugging, benchmarking) |

A participant is available only when its tunnel is connected, it is not offline, and it is not already handling another request. Harness participants are never selected. When no participant is available, the request fails with HTTP `404`, so a burst of concurrent `any()` calls larger than the number of free participants gets some `404` responses. See [Model routing](/reference/api/#model-routing) and [Inference errors](/reference/api/#inference-errors).

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

Fetch `GET /rooms/:code/v1/models` and return a flat array, one entry per available model participant:

```ts
const models = await gambi.listModels();
// [{ id, nickname, model, endpoint, capabilities }, ...]

for (const m of models) {
  console.log(m.id, m.model);
}
```

| Field | Description |
| --- | --- |
| `id` | participant ID; pass it to `gambi.participant(id)` |
| `nickname` | participant display name |
| `model` | model name the participant serves |
| `endpoint` | participant-local provider endpoint (informational; the hub never calls it) |
| `capabilities` | `openResponses` and `chatCompletions` support |

The list leaves out harness participants and participants that are offline or have no connected tunnel. It does not exclude busy participants. On a non-2xx response it throws a plain `Error`. For tunnel state, use `gambi.listParticipants()`.

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
| `client.harness` | `attach` |

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
| `endpoint` | `string` | for model participants | participant-local endpoint URL |
| `harness` | `object` | for harness participants | harness `id` plus optional `model` and `hosted` metadata |
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
- `harness.session.opened`
- `harness.session.closed`
- `harness.artifact`

See [Observability](/reference/observability/) for the payload shapes of the `llm.*` events.

### `client.harness.attach({ roomCode, participantId, signal? })`

Attach to a harness participant over the management WebSocket and receive its validated relay frames.

```ts
const channel = await client.harness.attach({
  roomCode: "ABC123",
  participantId: "harness-1",
});

channel.send({
  type: "tunnel.harness.control",
  sessionId: "session-1",
  action: "open",
  cwd: "/workspace",
});

for await (const frame of channel.messages) {
  if (frame.type === "tunnel.harness.message") {
    console.log(frame.message);
  }
}

channel.close();
```

`send()` accepts `tunnel.harness.message` and `tunnel.harness.control`. `messages` yields message, artifact, and status frames. Aborting `signal` or calling `close()` ends the channel. The hub treats the ACP `message` object as opaque.

This channel is part of the management client. Harness participants do not appear in model routing and cannot receive `createGambi()` inference calls. See [Bring your harness](/guides/bring-your-harness/) for the participant setup.

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

| Field | Description |
| --- | --- |
| `participant` | registered participant summary |
| `roomId` | room identifier |
| `tunnel` | tunnel bootstrap details |
| `close()` | stop the session and remove the registration (best effort) |
| `waitUntilClosed()` | resolves with the close event |

Close reasons:

- `"closed"`: `close()` was called. The SDK installs no signal handlers; wire them yourself.
- `"heartbeat_failed"`: a management heartbeat request failed. One failure is enough to close the session.
- `"tunnel_closed"`: the WebSocket tunnel closed or errored, from either side. The session does not reconnect and does not remove the registration; the hub marks the participant offline as soon as the tunnel closes.

On `"closed"` and `"heartbeat_failed"`, the session tries to remove the participant from the room before it resolves.

## `createHarnessParticipantSession(options)`

Run a local harness as a room participant from your own application, for
example to host harnesses for people who did not bring one. It is the same
runtime `gambi participant join --harness` uses, and it runs under Node and Bun.

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type Workspace,
} from "gambi-sdk";

const local = createLocalDirectoryWorkspace();

// Optional: seed starter content before the harness starts.
const workspace: Workspace = {
  async prepare(context) {
    const prepared = await local.prepare(context);
    await writeFile(join(prepared.path, "README.md"), "# Brief\n");
    return prepared;
  },
};

const session = await createHarnessParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "hosted-opencode-1",
  nickname: "Hosted OpenCode",
  harnessId: "opencode",
  hosted: true,
  workspace,
});

console.log(session.workspacePath);
await session.waitUntilClosed();
```

Options beyond the shared `hubUrl`, `roomCode`, `participantId`, `nickname`,
`password`, `specs`, and `config`:

| Option | Description |
| --- | --- |
| `harnessId` | `opencode`, `claude-code`, `codex`, or `fake` |
| `model` | optional label shown with the participant |
| `hosted` | marks a harness the room host runs for others. Rejected for `claude-code`. |
| `workspace` | where the harness runs; defaults to `createLocalDirectoryWorkspace()` |
| `gambiHome` | base directory of the default workspace (`~/.gambi`) |
| `adapter` | replace the command and readiness check for `harnessId` |
| `onEvent` | lifecycle events: `harness_spawned`, `session_opened`, `artifact_sent`, `harness_exited` |
| `artifactDebounceMs` | wait after the last file change before sending an artifact (default `1000`) |

A missing binary or login throws `HarnessDependencyError` before anything is
registered. The session adds `processPid`, `sessionId`, `workspacePath`, and
`harnessExited` to the participant session shape, and the close reason
`"harness_exited"`.

### Workspace

A `Workspace` is the folder on the participant's machine where the harness
runs. `prepare(context)` returns a prepared workspace with `path`,
`watch(onChange, onError)`, and `collect()`; the runtime watches it and sends a
full snapshot as each new artifact version. `createLocalDirectoryWorkspace({ path? })`
uses `path`, or an empty folder under `~/.gambi/workspaces/<room>/<participant>/`.
It writes only `.gambi.json`, which never appears in an artifact.

### Testing without a model

`runFakeAcpAgent()` runs a deterministic harness process that calls no model. It answers each prompt with
`Fake ACP response: <prompt>` and writes `fake-output.txt` in the workspace.
Because a bundled SDK cannot locate its own script, wrap it in one of yours and
point the adapter at it:

```ts
// scripts/fake-acp-agent.ts
import { runFakeAcpAgent } from "gambi-sdk";
await runFakeAcpAgent();
```

```ts
import { createFakeHarnessAdapter } from "gambi-sdk";

await createHarnessParticipantSession({
  // ...
  harnessId: "fake",
  adapter: createFakeHarnessAdapter({
    command: process.execPath,
    args: ["scripts/fake-acp-agent.ts"],
  }),
});
```

## Discovery helpers

Discovery is optional. `createGambi()` and `createClient()` never discover anything on their own; pass them a hub URL.

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

## Lower-level exports

Most applications do not need these. They exist for tests, embedding, and custom runtimes.

| Export | Description |
| --- | --- |
| `hub.create(options)` | start a hub in the current process, the same hub `gambi hub serve` runs. Options: `port` (default `3000`), `hostname` (default `0.0.0.0`), `mdns`. Returns `{ server, url, mdnsName?, close() }`. Requires Bun. |
| `rooms` | direct access to the in-process room registry of a hub started with `hub.create()` in the same process. It does not talk to a remote hub; use `createClient()` for that. |
| `participants` | helpers that build participant records and merge runtime config, used by the hub. |
| `getHarnessAdapter(id)` | the built-in adapter for `opencode`, `claude-code`, `codex`, or `fake`: the command it runs and its readiness check. Use it as a base when you pass a custom `adapter`. |
| `defaultWorkspacePath({ roomCode, participantId }, gambiHome?)` | the default workspace folder, `~/.gambi/workspaces/<room>/<participant>`. |

## Errors

Management operations throw `ClientError`.

Fields:

- `status`: HTTP status
- `code`: Gambi error code, such as `ROOM_NOT_FOUND`
- `hint`: operator-readable next step
- `details`: optional structured payload from the hub
- `requestId`: correlates with hub logs and SSE events

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
