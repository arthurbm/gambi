# gambi-sdk

[![npm version](https://img.shields.io/npm/v/gambi-sdk)](https://www.npmjs.com/package/gambi-sdk)
[![npm downloads](https://img.shields.io/npm/dm/gambi-sdk)](https://www.npmjs.com/package/gambi-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript SDK for [Gambi](https://gambi.sh), a hub for sharing OpenAI-compatible LLM endpoints and coding harnesses across a trusted local network.

## Installation

```bash
npm install gambi-sdk
# or
bun add gambi-sdk
```

## Entries

| Entry | Exports | Runs on |
| --- | --- | --- |
| `gambi-sdk` | `createGambi()`, `createClient()`, `ClientError` | Node and Bun |
| `gambi-sdk/discovery` | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError` | Node and Bun |
| `gambi-sdk/hub` | `createHub()`, `HubError` | Bun only |
| `gambi-sdk/participant` | `createParticipantSession()`, `createHarnessParticipantSession()`, `createLocalDirectoryWorkspace()`, `probeProvider()`, `runFakeAcpAgent()`, `ParticipantError` | Bun only |

Each entry is a separate file: importing one never loads another. Every function returns a `Promise` (or an async iterable), and every entry exports the TypeScript types of what it returns.

A participant hosted with `gambi-sdk/participant` must run the same minor version of Gambi as the hub it joins. Upgrade the SDK and the hub together.

## Inference with the AI SDK

```ts
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://192.168.1.10:3000",
});

const { text } = await generateText({
  model: gambi.any(), // or gambi.model("llama3"), gambi.participant("worker-1")
  prompt: "Explain how SSE works.",
});
```

The helpers return AI SDK 6 models (`LanguageModelV3`) and default to the OpenAI Responses API; `gambi.chatCompletions.*` uses Chat Completions. Aborting a request cancels the generation on the participant's machine.

## Managing a hub

```ts
import { ClientError, createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://192.168.1.10:3000" });

const { room } = await client.rooms.create({ name: "Demo" });
const participants = await client.participants.list(room.code);

for await (const event of client.events.watch(room.code)) {
  console.log(event.type); // "room.snapshot", "participant.online", "llm.complete", ...
}
```

Methods return the value itself and reject with a `ClientError` whose `code` names the failure (`ROOM_NOT_FOUND`, `VERSION_MISMATCH`, `HUB_UNREACHABLE`, `NOT_A_HUB`, ...).

`client.harness` attaches to a harness participant (OpenCode, Claude Code, Codex): `openSession`, `send` (one ACP v1 message), `attach` (an async iterable of the harness's messages, session status, and workspace artifacts), and `closeSession`.

## Hosting a hub or a participant (Bun only)

```ts
import { createHub } from "gambi-sdk/hub";
import { createParticipantSession } from "gambi-sdk/participant";

const hub = await createHub({ port: 3000 });

const session = await createParticipantSession({
  hubUrl: hub.url,
  roomCode: "ABC123",
  participantId: "worker-1",
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
  authHeaders: { Authorization: `Bearer ${process.env.PROVIDER_TOKEN}` }, // never leave this machine
  onLifecycle: (event) => console.log(event.type), // connected, reconnecting, left
});

await session.leave();
await hub.close();
```

The participant opens a tunnel to the hub and reconnects by itself when it drops. `createHarnessParticipantSession()` does the same for a local harness, running it in a workspace folder and sending snapshots of that folder to attached clients.

## Discovery

```ts
import { createGambi } from "gambi-sdk";
import { resolveGambiTarget } from "gambi-sdk/discovery";

const target = await resolveGambiTarget({ roomCode: "ABC123", timeoutMs: 1500 });
const gambi = createGambi({ hubUrl: target.hubUrl, roomCode: target.roomCode });
```

Discovery is always explicit: `createGambi()` and `createClient()` never discover anything on their own.

## Documentation

- [SDK reference](https://gambi.sh/reference/sdk/): every option, method, event, and error code
- [API reference](https://gambi.sh/reference/api/): the HTTP contracts behind the SDK
- [Build a custom participant runtime](https://gambi.sh/guides/custom-participant/)
- [Bring your harness](https://gambi.sh/guides/bring-your-harness/)

## Security

The hub has no built-in authentication. Run it only on a trusted network, or behind your own proxy and authentication layer.

## License

MIT
