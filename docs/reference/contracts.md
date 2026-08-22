# Gambi Contracts

Reference for the public contracts of the Gambi hub: HTTP endpoints, response envelopes, error codes, SSE events, tunnel protocol messages, runtime constants, and CLI surfaces. For the conceptual model behind these contracts, see [`docs/reference/architecture.md`](./architecture.md).

## Response envelopes

### Success

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

### Error

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Participant identifier is required.",
    "hint": "Pass --participant-id or provide it in the request path."
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

`meta.requestId` is part of the public contract and must be preserved by CLI and SDK callers.

## Management error codes

Returned in the `error.code` field of error envelopes:

| Code | Meaning |
|---|---|
| `ROOM_NOT_FOUND` | The room code does not exist. |
| `PARTICIPANT_NOT_FOUND` | No participant with that ID exists in the room. |
| `INVALID_REQUEST` | Validation failed (missing or malformed input). |
| `INVALID_PASSWORD` | Room password did not match. |
| `ENDPOINT_NOT_REACHABLE` | The hub failed to reach the participant's provider endpoint during a probe. |
| `PARTICIPANT_CONFLICT` | A participant ID is already taken in a way the upsert cannot resolve. |
| `PARTICIPANT_BUSY` | The targeted participant is currently handling another request. |
| `PARTICIPANT_TUNNEL_NOT_CONNECTED` | The targeted participant has no live tunnel. |
| `MODEL_NOT_FOUND` | No participant exposes the requested model. |
| `INTERNAL_ERROR` | Unhandled hub-side failure. |

The SDK surfaces these as `ClientError` instances with `status`, `code`, `hint`, `details`, and `requestId`.

## Management plane endpoints

All under `/v1`:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/health` | |
| `GET` | `/v1/rooms` | |
| `POST` | `/v1/rooms` | Non-idempotent. |
| `GET` | `/v1/rooms/:code` | |
| `GET` | `/v1/rooms/:code/participants` | |
| `PUT` | `/v1/rooms/:code/participants/:id` | Idempotent upsert. Returns `{ participant, roomId, tunnel: { url, token } }`. |
| `DELETE` | `/v1/rooms/:code/participants/:id` | |
| `POST` | `/v1/rooms/:code/participants/:id/heartbeat` | |
| `GET` | `/v1/rooms/:code/participants/:id/tunnel?token=...` | WebSocket upgrade. Token is single-use, TTL 60 s. Internal bootstrap route — not the public inference surface. |
| `GET` | `/v1/rooms/:code/participants/:id/harness` | WebSocket attach for management clients controlling a harness participant. |
| `GET` | `/v1/rooms/:code/events` | SSE stream. |

### Public room summary fields

Returned by `GET /v1/rooms/:code` and `GET /v1/rooms`:

- `id`, `code`, `name`, `hostId`, `createdAt`
- `participantCount`
- `passwordProtected`
- `defaults`

### Public participant fields

Every public participant payload exposes:

```
connection: { kind: "tunnel", connected: boolean, lastTunnelSeenAt: number | null }
```

`status` and `connection.connected` are orthogonal — a participant can be registered but have no tunnel.

Harness participants also expose `harness: { id, model?, hosted? }` and may omit `endpoint`. Valid harness ids are `opencode`, `claude-code`, `codex`, `pi`, and `fake`. Their advertised inference capabilities are ignored because they do not participate in model routing.

## Inference plane endpoints

OpenAI-compatible, room-scoped. All under `/rooms/:code/v1`:

| Method | Path |
|---|---|
| `GET` | `/rooms/:code/v1/models` |
| `POST` | `/rooms/:code/v1/responses` |
| `GET` | `/rooms/:code/v1/responses/:id` |
| `DELETE` | `/rooms/:code/v1/responses/:id` |
| `POST` | `/rooms/:code/v1/responses/:id/cancel` |
| `GET` | `/rooms/:code/v1/responses/:id/input_items` |
| `POST` | `/rooms/:code/v1/chat/completions` |

The Responses API is preferred; Chat Completions remains for compatibility.

## Model routing

The `model` field selects the participant:

- `<participant-id>` — route to a specific participant.
- `model:<name>` — route to the first available participant exposing that model.
- `*` or `any` — route to any available participant.

A model participant is "available" only when its tunnel is connected, its status is not offline, and it is not currently handling another request. Harness participants are excluded from `<participant-id>`, `model:<name>`, and `*`/`any` inference routing; targeting one by id returns a clear client error and callers should use the harness attach route instead.

## SSE room events

Each event has `type`, `timestamp`, `roomCode`, and `data`.

Current types:

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

Harness session events contain `participantId` and `sessionId`. `harness.artifact` additionally contains `version`; artifact file contents are intentionally omitted from SSE.

### `llm.request` payload

- `requestId`, `participantId`, `model`, `protocol`

### `llm.complete` payload

- `requestId`, `participantId`, `model`, `protocol`, `metrics`

`metrics` includes: `ttftMs`, `durationMs`, `inputTokens`, `outputTokens`, `totalTokens`, `tokensPerSecond`. Token counts may be missing when the upstream provider does not expose `usage` in streaming. See [`docs/reference/observability.md`](./observability.md) for the full metrics model.

### `llm.error` payload

- `requestId`, `participantId`, `nickname`, `endpoint`, `model`, `protocol`, `stage`, `error`

## Tunnel protocol

WebSocket messages, validated with Zod on both ends. Defined in `packages/core/src/tunnel-protocol.ts`.

| Message | Direction | Purpose |
|---|---|---|
| `tunnel.request` | hub → participant | dispatch an inference request |
| `tunnel.response.start` | participant → hub | start of streaming response |
| `tunnel.response.chunk` | participant → hub | streaming chunk |
| `tunnel.response.end` | participant → hub | end of streaming response |
| `tunnel.response.error` | participant → hub | streaming error |
| `tunnel.ping` | both | keepalive |
| `tunnel.pong` | both | keepalive ack |
| `tunnel.harness.message` | both | opaque ACP v1 JSON-RPC object plus `sessionId` |
| `tunnel.harness.control` | hub → participant | `open` (optionally with `cwd`) or `close` for `sessionId` |
| `tunnel.harness.artifact` | participant → hub | versioned workspace files and `watch`/`final` reason |
| `tunnel.harness.status` | participant → hub | `opened`, `closed`, or `error` lifecycle status |

The hub validates only these harness envelopes. It does not interpret the `message` object. Attached management clients receive `message`, `artifact`, and `status` frames from the participant; their `message` and `control` frames are forwarded to the participant. Multiple attached clients fan out from one participant tunnel and remain attached when that tunnel reconnects.

### Participant runtime close reasons

Surfaced by `createParticipantSession()` (canonical implementation in `packages/core/src/participant-session.ts`, re-exported from the SDK):

- `"closed"`
- `"heartbeat_failed"`
- `"tunnel_closed"`

`createHarnessParticipantSession()` adds `"harness_exited"`. It also starts the
selected local ACP process, negotiates protocol version `1`, opens a session in
the participant workspace, and kills the child process during `close()`.

### Harness participant workspace and artifacts

`gambi participant join --harness <id>` uses this path:

```text
~/.gambi/workspaces/<room>/<participant-id>/
```

The runtime creates missing `index.html`, `README.md`, and `manifest.json`
starter files. It writes local runtime metadata to `.gambi.json`, which never
appears in an artifact. The watcher waits one second after the last change,
then sends a complete workspace snapshot with the next positive `version`.
Text files use `utf8`; other files use `base64`. `.git` and `node_modules`
directories are omitted.

### Event board boundary

The event board is an internal app contract, not a new hub endpoint. It serves
oRPC under `/rpc`, board updates under `/events`, and accepted tile documents at
`/tiles/:squadId/live/index.html` on port `3001`. Vite proxies those paths on
port `3002`. Board SSE has `board.snapshot`, `board.changed`,
`harness.presence`, and `harness.stream`; it is separate from the room SSE
contract above. SQLite stores board audit history. The hub room stream remains
in-memory and does not gain replay semantics.

The root process entrypoints are repository operations:

- `bun run event` starts the live stack with hosted OpenCode.
- `bun run board:e2e` uses fake ACP, fixture model participants, and an isolated
  SQLite file.
- `SIGUSR1` sent to the printed supervisor PID restarts only the board with the
  same room code and database.

These commands do not change the published CLI contract.

## Runtime constants

Defined in `packages/core/src/types.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `HEALTH_CHECK_INTERVAL` | `10_000` ms | Cadence of management heartbeat and tunnel ping/pong. |
| `PARTICIPANT_TIMEOUT` | `30_000` ms (`HEALTH_CHECK_INTERVAL * 3`) | Window after which the hub marks a participant offline. |

`TunnelHarnessTransport` keeps two application-side deadlines outside the hub
protocol: `operationTimeoutMs` defaults to 10 seconds for session open and close,
while `promptTimeoutMs` defaults to five minutes for a complete ACP
`session/prompt` turn. A prompt timeout is recoverable but delivery is uncertain:
the caller records `delivery_unknown`, discards the session, and retries only
after an explicit human or application decision.

## Runtime defaults merge order

At proxy time the hub merges defaults in this order:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is not exposed raw in public management responses. Provider auth headers (`ParticipantAuthHeaders`) are not uploaded to the hub during participant registration — they remain on the participant runtime and are applied locally when serving tunnel requests to the real provider endpoint.

## Discovery helpers

In `packages/sdk/src/discovery.ts`:

- `discoverHubs()`
- `discoverRooms()`
- `resolveGambiTarget()`

Use mDNS plus the management API. Always explicit — `createGambi()` and `createClient()` do not perform implicit discovery.

## CLI exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Internal unexpected failure |
| `2` | Invalid usage (missing flag, bad value, hub `400` / `422`) |
| `3` | Dependency / connectivity (hub `401` / `403` / `503`, hub unreachable) |
| `4` | Remote rejection (hub `404` / `409`) |

## CLI global flags

Inherited from the `AgentCommand` base by every subcommand:

- `--format text|json|ndjson` — piped stdout defaults to `json` or `ndjson`; streaming commands coerce `json` → `ndjson`
- `--env <name>` — reads from `~/.config/gambi/config.json`, respects `XDG_CONFIG_HOME`
- `--interactive` / `--no-interactive`
- `--verbose` / `--quiet`

`gambi participant join` requires `--participant-id` for retry-safe non-interactive flows. Model mode uses `createParticipantSession()`. Passing `--harness opencode|claude-code|codex|fake` selects `createHarnessParticipantSession()` and makes `--model` optional. `--name` aliases `--nickname`.

Harness mode rejects `--endpoint`, `--header`, and `--header-env` with exit code `2`. A missing binary, missing local authentication, failed ACP negotiation, or lost tunnel returns exit code `3`. Structured output adds `harness_spawned`, `session_opened`, `artifact_sent`, and `harness_exited` lifecycle events.

Adapter commands and readiness checks are local:

| Harness id | ACP command | Readiness check |
| --- | --- | --- |
| `opencode` | `opencode acp` | `opencode auth list --pure` |
| `claude-code` | `claude-agent-acp` from `@agentclientprotocol/claude-agent-acp` | `claude auth status --json` |
| `codex` | `codex-acp` from `@agentclientprotocol/codex-acp` | `codex login status` |
| `fake` | bundled deterministic agent | bundled script exists |

No readiness output or credential is registered or tunneled. The participant's board-facing `harness.id` is the selected id and `harness.model` is the optional `--model` label. Claude Code additionally prints Anthropic's terms warning on join and rejects `hosted: true`: every end user must run the unmodified binary with their own local authentication; Gambi never intermediates subscription login or hosts Claude Code for third parties.

`gambi self update` updates via `bun`, `npm`, or the standalone binary depending on installation mode.

## CLI environment variables

| Variable | Purpose |
|---|---|
| `GAMBI_FORMAT` | Fallback for `--format` |
| `GAMBI_ENV` | Fallback for `--env` |
| `GAMBI_NO_INTERACTIVE=1` | Disable prompts everywhere |
| `XDG_CONFIG_HOME` | Override base of `~/.config/gambi/config.json` |
