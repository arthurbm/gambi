---
title: SDK reference
description: Reference for the Gambi SDK provider, management client, hosting entries, and discovery helpers.
---

The Gambi SDK (`gambi-sdk`) has four entries. Each one is a separate file, so importing one never loads another:

| Entry | Exports | Runs on |
| --- | --- | --- |
| `gambi-sdk` | `createGambi()`, `createClient()`, `ClientError` | Node and Bun |
| `gambi-sdk/discovery` | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError` | Node and Bun |
| `gambi-sdk/hub` | `createHub()`, `HubError` | Bun only |
| `gambi-sdk/participant` | `createParticipantSession()`, `createHarnessParticipantSession()`, `createLocalDirectoryWorkspace()`, `probeProvider()`, `runFakeAcpAgent()`, `MAX_ARTIFACT_BYTES`, `ParticipantError` | Bun only |

Every function returns a `Promise` (or an async iterable) and every entry exports TypeScript types for what it returns. The two hosting entries run a hub or a participant inside your own process. They need Bun, and throw an error that says so when loaded in Node.

## Installation

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

A participant hosted with `gambi-sdk/participant` and the hub it joins must run the same minor version of Gambi. A hub refuses a participant from another minor with `VERSION_MISMATCH`. Upgrade `gambi-sdk` and the hub together.

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
| `gambi.participant(id)` | the participant with that id, when it is available | you want a specific machine (affinity, debugging, benchmarking) |

A participant is available only when it is `online`: its tunnel is open and it is not already handling another request. Harness participants are never selected by `any()` or `model()`. `gambi.participant(id)` sends the ID as the model selector, so it is not an exact target: when that participant is busy or offline and another available participant serves a model with the same name, that one takes the request. When no participant is available, the request fails with HTTP `404` and the code `model_not_found`, so a burst of concurrent `any()` calls larger than the number of free participants gets some `404` responses. See [Model routing](/reference/api/#model-routing) and [Inference errors](/reference/api/#inference-errors).

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

### Streaming and cancellation

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

Aborting the request (the AI SDK's `abortSignal`, or leaving the stream) cancels the generation on the participant's machine, and the participant is free for the next request. A request that receives nothing from the participant for 5 minutes fails with `inference_timeout`.

You can also call the inference API directly with `fetch` and `stream: true` against `${gambi.baseURL}/responses` or `${gambi.baseURL}/chat/completions`.

### `gambi.listModels()`

Fetch `GET /rooms/:code/v1/models` and return a flat array, one entry per available model participant:

```ts
const models = await gambi.listModels();
// [{ id, nickname, model, endpoint, capabilities, status }, ...]

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
| `status` | `online` or `busy` |

The list leaves out harness participants and offline participants. It includes busy ones. On a non-2xx response it throws a plain `Error`.

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

`hubUrl` defaults to `http://localhost:3000`. Methods return the value itself, without the `{ data, meta }` envelope of the HTTP API, and reject with a [`ClientError`](#errors) when the call to the hub fails.

### Namespaces

| Namespace | Methods |
| --- | --- |
| `client.hub` | `health` |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `register`, `list`, `remove` |
| `client.events` | `watch` |
| `client.harness` | `attach`, `openSession`, `send`, `closeSession` |

`client.close()` ends the watches that are open, cancels the calls in flight, and refuses new ones; those calls reject with a plain `Error` (`The client is closed.`), not a `ClientError`. It is optional: a client that is never closed holds nothing once its watches end. The client also works with `await using`.

### `client.hub.health()`

```ts
const health = await client.hub.health();
// { status: "ok", timestamp }
```

### `client.rooms.create(input)`

```ts
const created = await client.rooms.create({
  name: "Demo",
  password: "secret",
  defaults: { temperature: 0.4 },
});

console.log(created.room.code);
console.log(created.hostId);
```

### `client.rooms.get(roomCode)`

```ts
const room = await client.rooms.get("ABC123");
console.log(room.participantCount, room.passwordProtected);
```

### `client.rooms.list()`

```ts
const rooms = await client.rooms.list();
for (const room of rooms) {
  console.log(room.code, room.name, room.participantCount);
}
```

### `client.participants.list(roomCode)`

```ts
const participants = await client.participants.list("ABC123");
for (const participant of participants) {
  console.log(participant.id, participant.status);
}
```

`status` is `offline`, `online`, or `busy`, derived from the participant's tunnel.

### `client.participants.register(roomCode, participantId, input)`

Create or update a participant registration. It takes the same fields as the [registration route](/reference/api/#put-v1roomscodeparticipantsid) and fills `version` with the SDK's own version when you leave it out. It resolves with `{ participant, tunnel: { token, expiresAt } }`.

Registration alone does not bring a participant online: that takes a tunnel, and a participant that never opens one is removed after 60 seconds. To run a participant, use [`createParticipantSession()`](#createparticipantsessionoptions-gambi-sdkparticipant-bun-only); `register` is for tests and automation.

### `client.participants.remove(roomCode, participantId)`

Take a participant out of the room. Resolves with `{ participantId }`.

```ts
await client.participants.remove("ABC123", "worker-1");
```

### `client.events.watch(roomCode, { signal? })`

Watch room events as an async iterable.

```ts
const controller = new AbortController();

for await (const event of client.events.watch("ABC123", {
  signal: controller.signal,
})) {
  console.log(event.type);
}
```

- Nothing is requested until the loop asks for the first event, which is always `room.snapshot`.
- Events are pulled one at a time; a slow loop does not pile them up in your process.
- The loop ends without an error when the hub closes the stream, when `signal` aborts, or when the client is closed. Leaving the loop with `break` cancels the request. To keep watching after a hub restart, call `watch` again.
- The loop throws `ROOM_NOT_FOUND` on the first event for a room that does not exist, and `HUB_UNREACHABLE` or `NOT_A_HUB` when the connection breaks or the hub sends something that is not an event.

Event types: `room.snapshot`, `participant.joined`, `participant.updated`, `participant.online`, `participant.busy`, `participant.offline`, `participant.removed`, `llm.request`, `llm.complete`, `llm.error`. The `RoomEvent` type is a union on `type`. See [Observability](/reference/observability/) for the fields of each one.

### `client.harness`

Attach to a harness participant: read what its harness says, open and close harness sessions, and send ACP messages. These calls go to the hub, which relays them through the participant's tunnel; your program never connects to the participant.

```ts
const room = "ABC123";
const participant = "arthur-opencode";
const sessionId = "session-1"; // you pick it

await client.harness.openSession(room, participant, sessionId);

for await (const event of client.harness.attach(room, participant)) {
  // The stream replays nothing: send once it is open.
  if (event.type === "harness.connected") {
    await client.harness.send(room, participant, sessionId, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/prompt",
      params: {
        sessionId,
        prompt: [{ type: "text", text: "Write a README for this project." }],
      },
    });
  }
  if (event.type === "harness.message" && event.sessionId === sessionId) {
    if (event.message.id === 1) {
      break; // the answer to the prompt: the turn is over
    }
    console.log(event.message); // updates while the harness works
  }
  if (event.type === "harness.artifact") {
    console.log(event.version, event.files.length);
  }
}

await client.harness.closeSession(room, participant, sessionId);
```

Every client attached to a participant reads every event of that participant, including the answers to other clients. Filter `harness.message` by `sessionId`, and match answers to your requests by their JSON-RPC `id`. Leaving the loop with `break` closes the stream.

| Method | Resolves with | Description |
| --- | --- | --- |
| `attach(roomCode, participantId, { signal? })` | `AsyncIterable<HarnessAttachEvent>` | the harness participant's events, with the same rules as `events.watch` |
| `openSession(roomCode, participantId, sessionId, { cwd? }?)` | `{ sessionId }` | open a harness session under an ID you pick; `cwd` must be inside the participant's workspace |
| `send(roomCode, participantId, sessionId, message)` | `{ sessionId }` | hand one ACP v1 JSON-RPC message to the harness; its answer arrives on `attach` |
| `closeSession(roomCode, participantId, sessionId)` | `{ sessionId }` | close a harness session |

Attach events: `harness.connected`, `harness.disconnected`, `harness.message`, `harness.session`, `harness.artifact`, `harness.dropped`, `harness.detached`. See [Harness attach](/reference/api/#harness-attach) for their fields. Nothing is replayed for a client that attaches late, and a client that reads too slowly gets `harness.dropped` with the number of events it lost. The hub treats the ACP `message` object as opaque.

Harness participants do not appear in model routing and cannot receive `createGambi()` inference calls. See [Bring your harness](/guides/bring-your-harness/) for the participant setup.

## `createHub(options)` (`gambi-sdk/hub`, Bun only)

Start a hub in the current process: the same hub `gambi hub serve` runs.

```ts
import { createHub, HubError } from "gambi-sdk/hub";

const hub = await createHub({ port: 0, hostname: "127.0.0.1" });
console.log(hub.url); // "http://127.0.0.1:41233"

await hub.close();
```

| Option | Default | Description |
| --- | --- | --- |
| `hostname` | `0.0.0.0` | interface to listen on |
| `port` | `3000` | port to listen on; `0` takes any free port |
| `mdns` | `false` | announce the hub over mDNS |
| `inferenceIdleTimeoutMs` | 5 minutes | how long a request may wait for the next piece of an answer |
| `reconnectDeadlineMs` | 60 seconds | how long a participant may stay offline before it is removed |
| `onLog` | none | receives each log line of the hub; without it, the hub logs nowhere |

The hub has `url`, `port` (the real one), `mdnsName` (when `mdns` is on), and `close()`, which closes the tunnels and event streams, withdraws the mDNS announcement, and releases the port. The rooms end with it. It also works with `await using`.

`createHub` rejects only with `HubError`, whose `code` is `PORT_IN_USE` (`details.port` and `details.hostname`), `LISTEN_FAILED`, or `MDNS_ANNOUNCE_FAILED`. When it rejects, nothing is left running.

## `createParticipantSession(options)` (`gambi-sdk/participant`, Bun only)

Join a room with a model endpoint of this machine and stay in it.

```ts
import { createParticipantSession } from "gambi-sdk/participant";

const session = await createParticipantSession({
  hubUrl: "http://192.168.1.10:3000",
  roomCode: "ABC123",
  participantId: "worker-1",
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
  authHeaders: {
    Authorization: `Bearer ${process.env.PROVIDER_TOKEN}`,
  },
  onLifecycle: (event) => console.log(event.type),
});

const { reason } = await session.ended;
```

The promise resolves once the participant is `online`, and rejects with a [`ParticipantError`](#errors) when the join fails; then nothing is left running.

What it does:

1. Probe the endpoint for the APIs it speaks, unless you pass `capabilities`.
2. Register the participant through the management API.
3. Open the tunnel to the hub and wait for the hub to accept it.
4. Answer each request the hub sends through the tunnel by calling the local provider with `authHeaders`.
5. When the tunnel drops, come back by itself with the same `participantId`.

`authHeaders` stay in this process. They are applied only when the runtime calls the provider endpoint, and the hub never sees them.

The session does not check that the provider serves `model`. Use `probeProvider(endpoint, authHeaders?)` first if you want to: it resolves with `{ reachable, models, capabilities }`.

Options shared by both participant sessions:

| Option | Default | Description |
| --- | --- | --- |
| `hubUrl` | `http://localhost:3000` | hub URL |
| `roomCode` | required | room code |
| `participantId` | required | stable ID; reuse it to come back as the same participant |
| `password` | none | room password |
| `reconnect` | `true` | come back when the tunnel drops; with `false` the session ends on the first drop |
| `leaveTimeoutMs` | `3000` | how long `leave()` waits for the hub |
| `onLifecycle` | none | receives each lifecycle event, in order |
| `onLog` | none | receives each log line; without it, the runtime logs nowhere |

Options of the endpoint session: `nickname`, `model`, and `endpoint` (required), `authHeaders`, `capabilities`, `specs`, `config`.

### Lifecycle events

| `type` | Fields | When |
| --- | --- | --- |
| `connected` | `attempt`, `hubVersion` | the tunnel is open; `attempt` is `0` for the join |
| `reconnecting` | `attempt`, `delayMillis`, `reason` | the tunnel dropped and the runtime tries again in `delayMillis` (1 second, doubling up to 30) |
| `left` | `reason`, `error` | the runtime ended; always the last event |

`reconnecting.reason` is `tunnelDropped`, `hubSilent` (the hub stopped answering pings), `hubUnreachable`, `tunnelOpenFailed`, or `hubError`. `left.reason` is:

- `stopped`: your program called `leave()` or `stop()`
- `refused`: the hub refused the way back, and `error` has its `name` and `message`. A hub that restarted has no rooms, so a session that tries to come back to it ends here with `RoomNotFound`.
- `replaced`: another runtime joined the room with the same `participantId`, and the hub kept that one
- `tunnelDropped`: the tunnel dropped and the session runs with `reconnect: false`

Callbacks are never awaited, and an error thrown or rejected by one never stops the session.

### Session shape

| Field | Description |
| --- | --- |
| `participant` | the participant as the hub registered it |
| `ended` | resolves with `{ reason, error? }` when the runtime ended and will not try again. It never rejects |
| `leave()` | take the participant out of the room and stop. Never rejects, and gives up on the hub after `leaveTimeoutMs` |
| `stop()` | stop without telling the hub; the room shows the participant `offline` and removes it after 60 seconds |
| `[Symbol.asyncDispose]` | the same as `leave()`, for `await using` |

The SDK installs no signal handlers. To leave on Ctrl+C, call `leave()` from your own handler.

For a walkthrough, see [Custom participant runtime](/guides/custom-participant/).

## `createHarnessParticipantSession(options)` (`gambi-sdk/participant`, Bun only)

Run a local harness as a room participant from your own application, for
example to host harnesses for people who did not bring one. It is the same
runtime `gambi participant join --harness` uses.

```ts
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type Workspace,
} from "gambi-sdk/participant";

const local = createLocalDirectoryWorkspace();

// Optional: seed starter content before the harness starts.
const workspace: Workspace = {
  async prepare(context) {
    const prepared = await local.prepare(context);
    await Bun.write(`${prepared.path}/README.md`, "# Brief\n");
    return prepared;
  },
};

const session = await createHarnessParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "hosted-opencode-1",
  nickname: "Hosted OpenCode",
  harness: "opencode",
  hosted: true,
  workspace,
  onArtifact: (event) => console.log(event.type, event.sessionId),
});

console.log(session.harness.workspacePath);
await session.ended;
```

Options beyond the shared ones:

| Option | Default | Description |
| --- | --- | --- |
| `nickname` | required | display name |
| `harness` | required | `opencode`, `claude-code`, `codex`, or `fake` |
| `model` | the harness ID | optional label for the model the harness runs on |
| `hosted` | `false` | marks a harness the room host runs for others. Rejected for `claude-code` |
| `workspace` | `createLocalDirectoryWorkspace()` | where the harness runs |
| `onArtifact` | none | receives `artifactSent` and `artifactSkipped` events |
| `artifacts` | | `{ settleTimeMs, finalTimeoutMs, maxBytes }`: how long the workspace must stay unchanged before a snapshot (1 second), how long the final snapshot may take on close, and the largest snapshot (8 MiB) |
| `harnessStopTimeoutMs` | `2000` | how long the harness has to exit before it is killed |
| `fakeAgentCommand` | | the command that runs the fake harness; see below |
| `specs`, `config` | | as in the endpoint session |

A harness that is not installed or not logged in rejects with `HARNESS_NOT_READY`, whose message says how to fix it, before anything is registered.

The session adds `harness` to the session shape:

| Field | Description |
| --- | --- |
| `harness.pid` | process ID of the harness |
| `harness.sessionId` | the harness session the runtime opened at start; artifacts carry it |
| `harness.workspacePath` | the folder the harness runs in |
| `harness.notes` | messages for the person, such as the Claude Code terms warning |
| `harness.warning` | set when a readiness check could not confirm something |
| `harness.exited` | resolves with `{ message, exitCode?, detail? }` if the harness exits on its own. That does not end the session: deciding what to do is up to you |

`leave()` first takes a final snapshot while the harness and the tunnel are still running (best effort, up to `artifacts.finalTimeoutMs`, 2 seconds by default), then closes the tunnel, stops the harness, and takes the participant out of the room.

Known limits:

- `artifactSent` means the snapshot entered the queue to the hub, not that it arrived. A snapshot queued when the tunnel drops is lost.
- A snapshot larger than 8 MiB is not sent at all: `onArtifact` receives `artifactSkipped` with `cause: "tooLarge"`.
- If your process is killed with `kill -9`, a harness that does not watch its standard input can keep running.

### Workspace

A `Workspace` is the folder on the participant's machine where the harness
runs. `prepare(context)` receives `{ roomCode, participantId, harness, model }`
and returns a prepared workspace:

| Field | Description |
| --- | --- |
| `path` | absolute path of a folder that exists |
| `collect()` | resolves with the files of a snapshot: `{ path, encoding, content }` |
| `watch(onChange, onError)` | calls `onChange` when something changed; returns the function that stops watching. Called once, before the harness starts |
| `dispose()` | optional; called once when the session ends |

The runtime sends a full snapshot as each new artifact version.
`createLocalDirectoryWorkspace({ path? })` uses `path`, or a folder under
`~/.gambi/workspaces/<room>/<participant>/`, created empty when it does not exist yet and
reused as it is otherwise. It writes only `.gambi.json`, which never appears in an artifact, and leaves out `.git`, `node_modules`, and symbolic links.
A custom `collect()` for a workspace that is too large should reject with
`new ParticipantError({ code: "WORKSPACE_TOO_LARGE", message })`.

### Testing without a model

The `fake` harness is a deterministic process that calls no model. It answers each prompt with
`Fake ACP response: <prompt>` and writes `fake-output.txt` in the workspace.
With `gambi-sdk` installed, `harness: "fake"` works as it is.

A program that bundles the SDK into its own file cannot run the fake harness from
the package. Wrap `runFakeAcpAgent()` in a script of yours and pass its command:

```ts
// scripts/fake-acp-agent.ts
import { runFakeAcpAgent } from "gambi-sdk/participant";
await runFakeAcpAgent();
```

```ts
await createHarnessParticipantSession({
  // ...
  harness: "fake",
  fakeAgentCommand: { command: "bun", args: ["scripts/fake-acp-agent.ts"] },
});
```

## Discovery helpers (`gambi-sdk/discovery`)

Discovery is optional. `createGambi()` and `createClient()` never discover anything on their own; pass them a hub URL.

Available helpers:

- `discoverHubs(options?)`
- `discoverRooms(options?)`
- `resolveGambiTarget(options?)`

Common options (`DiscoveryOptions`):

| Option | Type | Description |
| --- | --- | --- |
| `hubUrl` | `string` | a hub to query in addition to the ones mDNS finds (default `http://localhost:3000`) |
| `timeoutMs` | `number` | how long to wait for mDNS responses |
| `fetchFn` | `typeof fetch` | custom fetch (tests, proxies) |
| `browseServices` | `BrowseServicesLike` | custom mDNS browser |

`resolveGambiTarget()` also accepts `roomCode` and `roomName` for picking a single room.

### Example

```ts
import { createGambi } from "gambi-sdk";
import { resolveGambiTarget } from "gambi-sdk/discovery";

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

Each entry rejects with its own error class, and `code` tells the cases apart.

`ClientError` (from `gambi-sdk`) has:

- `code`: a hub error code, such as `ROOM_NOT_FOUND`, or one the client finds on its own
- `status`: HTTP status, absent when nothing answered
- `hint`: operator-readable next step
- `details`: the structured fields of the error, such as `roomCode` or `hubVersion`
- `requestId`: correlates with the hub's log, set when the hub answered

| `code` | Meaning |
| --- | --- |
| `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` | what the call named is not there |
| `INVALID_PASSWORD` | the room has a password and the call brought none, or the wrong one |
| `VERSION_MISMATCH` | the participant and the hub are on different minor versions |
| `INVALID_REQUEST` | the call does not match the management API; checked before anything is sent when possible |
| `INTERNAL_ERROR` | a bug in the hub |
| `NOT_A_HARNESS_PARTICIPANT` | the participant shares a model endpoint, so there is no harness to attach to |
| `PARTICIPANT_UNREACHABLE` | the participant's tunnel is not open now |
| `HARNESS_FAILED` | the harness did not answer, refused, or exited; `details.reason` says which |
| `HARNESS_SESSION_NOT_OPEN` | the message was sent to a harness session that is not open |
| `HARNESS_SESSION_OUTSIDE_WORKSPACE` | the session was asked to run outside the participant's workspace |
| `HUB_UNREACHABLE` | nothing answered at the hub URL |
| `NOT_A_HUB` | something answered, but not like a Gambi hub of this version: another server, a proxy, or a hub of another version |

```ts
import { ClientError } from "gambi-sdk";

try {
  await client.rooms.get("ZZZZZZ");
} catch (error) {
  if (error instanceof ClientError && error.code === "ROOM_NOT_FOUND") {
    console.warn(error.hint);
  } else {
    throw error;
  }
}
```

`HubError` (from `gambi-sdk/hub`) has `code` (`PORT_IN_USE`, `LISTEN_FAILED`, `MDNS_ANNOUNCE_FAILED`) and `details`.

`ParticipantError` (from `gambi-sdk/participant`) has `code` and `details`. Its codes are `ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `VERSION_MISMATCH`, `INVALID_REQUEST`, `INTERNAL_ERROR`, `HUB_UNREACHABLE`, and `TUNNEL_OPEN_FAILED` for any session, plus `HARNESS_NOT_READY`, `HARNESS_START_FAILED`, `HARNESS_FAILED`, `WORKSPACE_FAILED`, and `WORKSPACE_TOO_LARGE` for a harness session.
