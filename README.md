```
 ██████╗  █████╗ ███╗   ███╗██████╗ ██╗
██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║
██║  ███╗███████║██╔████╔██║██████╔╝██║
██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║
╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║
 ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝
```

<div align="center">

**Share model endpoints and local coding harnesses across your trusted network.**

[![npm version](https://img.shields.io/npm/v/gambi-sdk)](https://www.npmjs.com/package/gambi-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.5-black?logo=bun&logoColor=white)](https://bun.sh)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-ef4444?logo=turborepo&logoColor=white)](https://turbo.build/repo)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-Compatible-000000?logo=vercel&logoColor=white)](https://sdk.vercel.ai)

</div>

## What is Gambi?

Gambi is a local-first system for sharing OpenAI-compatible model endpoints and local coding harnesses across a trusted network. A central hub tracks rooms and participants, relays inference requests or ACP messages, and publishes real-time events over SSE.

Each participant opens a tunnel to the hub and the hub sends work back through it. The hub never needs direct network reachability to the participant's provider endpoint, so `localhost` and provider credentials can remain local to the participant machine. When the tunnel drops, the participant reconnects by itself with the same ID.

A harness participant contributes OpenCode, Claude Code, or Codex from the participant's own machine and login. It does not serve OpenAI-compatible inference. Apps control it through the harness attach of the SDK management client.

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
curl -fsSL https://gambi.sh/install | bash
```

Windows:

```powershell
irm https://gambi.sh/install.ps1 | iex
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

The hub and every participant must run the same minor version of Gambi (any `0.8.x` with any other `0.8.x`). A hub refuses a participant from another minor and names the version it expects.

### SDK

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

`gambi-sdk` has four entries: `gambi-sdk` (inference provider and management client) and `gambi-sdk/discovery` run in Node and Bun; `gambi-sdk/hub` and `gambi-sdk/participant` host a hub or a participant in your own process and run in Bun only.

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
gambi hub serve --dry-run --format json
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
  --model llama3:latest \
  --endpoint http://localhost:11434
```

`--model` must match a name the provider lists exactly; Ollama names include a tag (`ollama list`).

`gambi participant join` probes the local endpoint, registers the participant, opens a participant tunnel to the hub, and reconnects after a network drop. Press Ctrl+C to leave. This works the same way for local hubs and remote hubs on the same trusted network: the endpoint can stay loopback-only on the participant machine.

To join with the OpenCode agent already installed and authenticated on your
machine:

```bash
gambi participant join \
  --room ABC123 \
  --participant-id arthur-opencode \
  --nickname Arthur \
  --harness opencode
```

This creates an empty `~/.gambi/workspaces/ABC123/arthur-opencode/` (or uses
the folder passed to `--workspace`), starts `opencode acp` there, and publishes
workspace changes through the same outbound tunnel. OpenCode credentials stay on
the participant machine. Applications can also host harness participants
themselves with `createHarnessParticipantSession()` from `gambi-sdk/participant`.

Claude Code and Codex can join through their published ACP bridges as
`--harness claude-code` and `--harness codex`. Install the matching bridge
(`@agentclientprotocol/claude-agent-acp` or
`@agentclientprotocol/codex-acp`) globally first; the CLI checks the existing
local Claude/Codex login and never sends credentials to the hub. Claude Code
must be run by each end user with the unmodified Anthropic binary and their own
authentication. Gambi does not intermediate subscription login or host Claude
Code for third parties. See the
[Bring your harness guide](apps/docs/src/content/docs/guides/bring-your-harness.mdx)
for all three setup paths, or the
[CLI reference](apps/docs/src/content/docs/reference/cli.mdx) for every flag and
the terms warning.

Preview the registration flow:

```bash
gambi participant join \
  --room ABC123 \
  --participant-id worker-1 \
  --model llama3:latest \
  --dry-run \
  --format json
```

### 4. Watch room events

```bash
gambi events watch --room ABC123
```

As NDJSON for scripts:

```bash
gambi events watch --room ABC123 --format ndjson
```

The stream starts with a `room.snapshot`, then carries every change of a participant's status (`participant.online`, `participant.busy`, `participant.offline`, ...) and the inference events `llm.request`, `llm.complete`, and `llm.error`.

`llm.complete` includes baseline observability metrics (token counts only for answers that are not streamed):

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
import { createGambi } from "gambi-sdk";
import { resolveGambiTarget } from "gambi-sdk/discovery";
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
console.log(created.room.code);

const participants = await client.participants.list(created.room.code);
console.log(participants.length);
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
gambi events watch
gambi self update
```

`gambi participant leave` removes a connected participant and ends its `participant join` process. To join again, start a new runtime.

Agent-first behavior:

- `--format text|json|ndjson` on every command; `json` when stdout is not a terminal
- one JSON line per step on long-running commands (`hub serve`, `participant join`)
- errors on stderr as JSON, with a stable `name` and exit codes `2` (usage), `3` (connectivity), `4` (the hub refused)
- prompts for missing flags only on a terminal; `--no-interactive` or `GAMBI_NO_INTERACTIVE=1` turns them off
- `--hub` or `GAMBI_HUB` to point at a hub (named environments and `~/.config/gambi/config.json` are gone since 0.8)
- `--config -` for stdin-driven JSON on commands that accept runtime config
- `--completions <shell>` and `--help` on every command

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
import { createGambi } from "gambi-sdk";
import { resolveGambiTarget } from "gambi-sdk/discovery";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
});

const gambi = createGambi(target);
```

`gambi-sdk/discovery` also exposes `discoverHubs()` and `discoverRooms()` for lower-level discovery workflows.

Use `createClient()` when your application needs operational control:

```ts
const client = createClient({ hubUrl: "http://localhost:3000" });

await client.rooms.list();
await client.rooms.get("ABC123");
const participants = await client.participants.list("ABC123");
const worker = participants.find((participant) => participant.id === "worker-1");
if (worker) {
  await client.participants.remove("ABC123", worker.id, worker.runtimeId);
}
```

Methods return the value itself and reject with a `ClientError` whose `code` names the failure (`ROOM_NOT_FOUND`, `VERSION_MISMATCH`, `HUB_UNREACHABLE`, ...).

Room event watching:

```ts
for await (const event of client.events.watch("ABC123")) {
  console.log(event.type);
}
```

Harness clients can attach to a harness participant without exposing that harness to inference routing:

```ts
const sessionId = crypto.randomUUID(); // one session per client
await client.harness.openSession("ABC123", "harness-1", sessionId);

let sent = false;
for await (const event of client.harness.attach("ABC123", "harness-1")) {
  if (event.type === "harness.connected" && !sent) {
    // The stream replays nothing, so send once it is open.
    sent = true;
    await client.harness.send("ABC123", "harness-1", sessionId, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "Hi" }] },
    });
  }
  if (event.type === "harness.message" && event.sessionId === sessionId) {
    const { message } = event;
    if (message.id === 1 && ("result" in message || "error" in message)) {
      break; // the answer to the prompt
    }
  }
}

await client.harness.closeSession("ABC123", "harness-1", sessionId);
```

Host a hub or a participant inside your own program (Bun only):

```ts
import { createClient } from "gambi-sdk";
import { createHub } from "gambi-sdk/hub";
import { createParticipantSession } from "gambi-sdk/participant";

const hub = await createHub({ port: 3000 });
const { room } = await createClient({ hubUrl: hub.url }).rooms.create({ name: "Demo" });

const session = await createParticipantSession({
  hubUrl: hub.url,
  roomCode: room.code,
  participantId: "worker-1",
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
});
```

## HTTP API overview

Management API:

- `GET /v1/health`
- `GET /v1/rooms`
- `POST /v1/rooms`
- `GET /v1/rooms/:code`
- `GET /v1/rooms/:code/participants`
- `PUT /v1/rooms/:code/participants/:id` (send the runtime's public `runtimeId` on every registration)
- `DELETE /v1/rooms/:code/participants/:id?runtimeId=...` (use the owner's ID from the participant listing)
- `GET /v1/rooms/:code/events` (SSE)
- `GET /v1/rooms/:code/participants/:id/harness/events` (SSE)
- `POST /v1/rooms/:code/participants/:id/harness/messages`
- `PUT /v1/rooms/:code/participants/:id/harness/sessions/:sessionId`
- `DELETE /v1/rooms/:code/participants/:id/harness/sessions/:sessionId`
- `GET /v1/openapi.json` (the OpenAPI document of the management API)

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
    "message": "Room 'ABC123' was not found.",
    "hint": "List the rooms of this hub to see the codes that exist.",
    "details": { "roomCode": "ABC123" }
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

## Runtime defaults

Rooms and participants can both provide runtime defaults. For each field a request leaves out or sends as `null`, the hub uses the participant's default, then the room's. Fields the request sets to a value always win.

Sensitive config is redacted from public management responses. Public room and participant payloads expose safe summaries instead of raw secrets or instructions.

Each participant has one `status`, derived from its tunnel: `offline` (no open tunnel), `online` (ready), or `busy` (handling a request). Only `online` participants receive new inference requests, and a participant that stays `offline` for 60 seconds is removed from the room.

Rooms live in the hub's memory: a restarted hub has no rooms, and participants that try to come back to it stop with `RoomNotFound`.

## Development

```bash
bun install
bun run dev
bun run dev:hub
bun run dev:cli -- --help
bun run dev:cli -- room list --format json
bun run dev:cli -- hub serve --dry-run --format json
bun run build
bun run check-types
```

Root dev workflow:

- `bun run dev` and `bun run dev:hub` start the hub with `gambi hub serve`
- `bun run dev:cli -- <subcommand...>` forwards any CLI command from the repo root
- `bun run dev:monitor` is a TUI alias for human-first monitoring
- Prefer `bun run dev:cli -- room create --help` and `bun run dev:cli -- participant join --help` for CLI discovery during development

The event board and the orchestration experiments built on Gambi live in
[gambiarra-lab](https://github.com/arthurbm/gambiarra-lab).

Workspace-specific:

```bash
bun run --cwd packages/protocol check-types
bun run --cwd packages/core check-types
bun run --cwd packages/cli check-types
bun run --cwd packages/sdk check-types
bun run --cwd apps/tui test
```

## Security

Gambi is designed for trusted local networks. The hub does not provide built-in authentication. Do not expose it directly to the public internet without an external proxy and auth layer.

For longer-term product direction, see:

- `docs/reference/architecture.md` for the current transport and proxy model
- `docs/reference/observability.md` for baseline metrics and future observability work
- `docs/product/vision.md` for the future `gambi agents` direction above the current hub
