```
 ██████╗  █████╗ ███╗   ███╗██████╗ ██╗
██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║
██║  ███╗███████║██╔████╔██║██████╔╝██║
██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║
╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║
 ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝
```

<div align="center">

**Share local LLMs across your network, with an agent-friendly control plane.**

[![npm version](https://img.shields.io/npm/v/gambi-sdk)](https://www.npmjs.com/package/gambi-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.5-black?logo=bun&logoColor=white)](https://bun.sh)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-ef4444?logo=turborepo&logoColor=white)](https://turbo.build/repo)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-Compatible-000000?logo=vercel&logoColor=white)](https://sdk.vercel.ai)

</div>

## What is Gambi?

Gambi is a local-first system for sharing OpenAI-compatible LLM endpoints across a trusted network. A central hub tracks rooms and participants, proxies inference requests, and publishes real-time events over SSE.

Participants now connect through a hub-managed tunnel. The hub never needs direct network reachability to the participant's provider endpoint, so `localhost` and provider credentials can remain local to the participant machine.

The public name **Gambi** is the short form of **gambiarra**. Here it means the good kind: creative improvisation under constraints, turned into a practical tool.

## Two planes

Gambi exposes two distinct surfaces:

- Management plane: native Gambi HTTP endpoints under `/v1`, plus the operational CLI and SDK management client.
- Inference plane: OpenAI-compatible room-scoped endpoints under `/rooms/:code/v1/*`, consumed by `createGambi()` and other OpenAI-compatible clients.

That split is deliberate. The management plane is optimized for agents and automation. The inference plane is optimized for application compatibility.

The default inference protocol is the OpenAI Responses API. Chat Completions remains available as a compatibility surface.

## Installation

### CLI

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.sh | bash
```

Windows:

```powershell
irm https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.ps1 | iex
```

npm / bun:

```bash
npm install -g gambi
# or
bun add -g gambi
```

Verify:

```bash
gambi --version
```

### SDK

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

### TUI

`gambi-tui` is the human-first monitoring interface. It is separate from the CLI.

```bash
bun add -g gambi-tui
```

## Quick start

### 1. Start the hub

```bash
gambi hub serve
```

Machine-readable dry run:

```bash
gambi hub serve --dry-run --format ndjson
```

### 2. Create a room

```bash
gambi room create --name "Demo"
```

With room defaults from JSON:

```bash
gambi room create --name "Demo" --config ./room-defaults.json
```

### 3. Register a participant

```bash
gambi participant join \
  --room ABC123 \
  --participant-id worker-1 \
  --model llama3 \
  --endpoint http://localhost:11434
```

`gambi participant join` probes the local endpoint, registers the participant, opens a participant tunnel back to the hub, and keeps the session alive until interrupted. This works the same way for local hubs and remote hubs on the same trusted network: the endpoint can stay loopback-only on the participant machine.

Preview the registration flow:

```bash
gambi participant join \
  --room ABC123 \
  --participant-id worker-1 \
  --model llama3 \
  --dry-run \
  --format ndjson
```

### 4. Watch room events

```bash
gambi events watch --room ABC123
```

As NDJSON for scripts:

```bash
gambi events watch --room ABC123 --format ndjson
```

Room event streams include lifecycle signals such as `llm.request`, `llm.complete`, and `llm.error`.

`llm.complete` includes baseline observability metrics when available:

- `ttftMs`
- `durationMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `tokensPerSecond`

### 5. Use the SDK for inference

```ts
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});

const result = await generateText({
  model: gambi.any(),
  prompt: "Explain how SSE works.",
});

console.log(result.text);
```

### 6. Resolve a room dynamically with `resolveGambiTarget()`

```ts
import { createGambi, resolveGambiTarget } from "gambi-sdk";
import { generateText } from "ai";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
  timeoutMs: 1500,
});

const gambi = createGambi({
  hubUrl: target.hubUrl,
  roomCode: target.roomCode,
});

const result = await generateText({
  model: gambi.any(),
  prompt: "Hello from a discovered room.",
});
```

Use this when your app is running on a local network and you want to resolve the hub and room before creating the provider. For fixed deployments, you can keep passing `hubUrl` and `roomCode` directly.

### 7. Use the SDK for management

```ts
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });

const created = await client.rooms.create({ name: "Ops" });
console.log(created.data.room.code);

const participants = await client.participants.list(created.data.room.code);
console.log(participants.data.length);
```

## CLI overview

The CLI is resource-oriented:

```bash
gambi hub serve
gambi room create
gambi room list
gambi room get
gambi participant join
gambi participant leave
gambi participant heartbeat
gambi events watch
gambi self update
```

Agent-first behavior:

- `--format text|json|ndjson` on the operational commands
- `--interactive` and `--no-interactive`
- default `json` or `ndjson` when stdout is piped
- XDG config at `~/.config/gambi/config.json`
- `--config -` for stdin-driven JSON on commands that accept runtime config

Example config:

```json
{
  "defaultEnv": "local",
  "envs": {
    "local": {
      "hubUrl": "http://localhost:3000",
      "endpoint": "http://localhost:11434"
    },
    "staging": {
      "hubUrl": "http://192.168.1.10:3000",
      "endpoint": "http://localhost:11434"
    }
  }
}
```

## SDK overview

Use `createGambi()` when your application wants inference through the OpenAI-compatible room endpoints:

```ts
const gambi = createGambi({ roomCode: "ABC123" });

gambi.any();
gambi.participant("worker-1");
gambi.model("llama3");
gambi.openResponses.any();
gambi.chatCompletions.any();
```

The top-level helpers default to `openResponses`. Use the `chatCompletions` namespace only when you need explicit compatibility with legacy clients or providers.

Use `resolveGambiTarget()` when the room or hub should be discovered from the local network first:

```ts
import { createGambi, resolveGambiTarget } from "gambi-sdk";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
});

const gambi = createGambi(target);
```

The SDK also exposes `discoverHubs()` and `discoverRooms()` for lower-level discovery workflows.

Use `createClient()` when your application needs operational control:

```ts
const client = createClient({ hubUrl: "http://localhost:3000" });

await client.rooms.list();
await client.rooms.get("ABC123");
await client.participants.upsert("ABC123", "worker-1", {
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://192.168.1.25:11434",
});
await client.participants.heartbeat("ABC123", "worker-1");
await client.participants.remove("ABC123", "worker-1");
```

Room event watching:

```ts
for await (const event of client.events.watchRoom({ roomCode: "ABC123" })) {
  console.log(event.type, event.data);
}
```

## HTTP API overview

Management API:

- `GET /v1/health`
- `GET /v1/rooms`
- `POST /v1/rooms`
- `GET /v1/rooms/:code`
- `GET /v1/rooms/:code/participants`
- `PUT /v1/rooms/:code/participants/:id`
- `DELETE /v1/rooms/:code/participants/:id`
- `POST /v1/rooms/:code/participants/:id/heartbeat`
- `GET /v1/rooms/:code/events`

Inference API:

- `GET /rooms/:code/v1/models`
- `POST /rooms/:code/v1/responses`
- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`
- `POST /rooms/:code/v1/chat/completions`

Management responses use envelopes:

```json
{
  "data": {
    "status": "ok",
    "timestamp": 1743884000000
  },
  "meta": {
    "requestId": "req_123"
  }
}
```

Management errors are structured:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Room 'ABC123' not found.",
    "hint": "Create the room first or verify the code."
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

## Runtime defaults

Rooms and participants can both provide runtime defaults. The hub merges them at proxy time with this precedence:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is redacted from public management responses. Public room and participant payloads expose safe summaries instead of raw secrets or instructions.

Participant registrations also expose tunnel connection state through `connection`, including whether the tunnel is currently connected and the timestamp of the last tunnel heartbeat seen by the hub.

Streaming commands always emit NDJSON for machine-readable output. If you pass `--format json` to a streaming command, the CLI coerces it to `ndjson`.

## Development

```bash
bun install
bun run dev
bun run dev:hub
bun run dev:cli -- --help
bun run dev:cli -- room list --format json
bun run dev:cli -- hub serve --dry-run --format ndjson
bun run build
bun run check-types
```

Root dev workflow:

- `bun run dev` and `bun run dev:hub` start the hub with `gambi hub serve`
- `bun run dev:cli -- <subcommand...>` forwards any CLI command from the repo root
- `bun run dev:monitor` is a TUI alias for human-first monitoring
- Prefer `bun run dev:cli -- room create --help` and `bun run dev:cli -- participant join --help` for CLI discovery during development

Workspace-specific:

```bash
bun run --cwd packages/core check-types
bun run --cwd packages/cli check-types
bun run --cwd packages/sdk check-types
bun run --cwd apps/tui test
```

## Security

Gambi is designed for trusted local networks. The hub does not provide built-in authentication. Do not expose it directly to the public internet without an external proxy and auth layer.

For longer-term product direction, see:

- `docs/architecture.md` for the current transport and proxy model
- `docs/observability.md` for baseline metrics and future observability work
- `docs/gambi-agents.md` for the future `gambi agents` direction above the current hub
