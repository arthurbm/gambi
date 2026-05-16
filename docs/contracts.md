# Gambi Contracts

Reference for the public contracts of the Gambi hub: HTTP endpoints, response envelopes, error codes, SSE events, tunnel protocol messages, runtime constants, and CLI surfaces. For the conceptual model behind these contracts, see [`docs/architecture.md`](./architecture.md).

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

A participant is "available" only when its tunnel is connected, its status is not offline, and it is not currently handling another request.

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

### `llm.request` payload

- `requestId`, `participantId`, `model`, `protocol`

### `llm.complete` payload

- `requestId`, `participantId`, `model`, `protocol`, `metrics`

`metrics` includes: `ttftMs`, `durationMs`, `inputTokens`, `outputTokens`, `totalTokens`, `tokensPerSecond`. Token counts may be missing when the upstream provider does not expose `usage` in streaming. See [`docs/observability.md`](./observability.md) for the full metrics model.

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

### Participant runtime close reasons

Surfaced by `createParticipantSession()` (canonical implementation in `packages/core/src/participant-session.ts`, re-exported from the SDK):

- `"closed"`
- `"heartbeat_failed"`
- `"tunnel_closed"`

## Runtime constants

Defined in `packages/core/src/types.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `HEALTH_CHECK_INTERVAL` | `10_000` ms | Cadence of management heartbeat and tunnel ping/pong. |
| `PARTICIPANT_TIMEOUT` | `30_000` ms (`HEALTH_CHECK_INTERVAL * 3`) | Window after which the hub marks a participant offline. |

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

`gambi participant join` requires `--participant-id` for retry-safe non-interactive flows and is implemented on top of `createParticipantSession()`.

`gambi self update` updates via `bun`, `npm`, or the standalone binary depending on installation mode.

## CLI environment variables

| Variable | Purpose |
|---|---|
| `GAMBI_FORMAT` | Fallback for `--format` |
| `GAMBI_ENV` | Fallback for `--env` |
| `GAMBI_NO_INTERACTIVE=1` | Disable prompts everywhere |
| `XDG_CONFIG_HOME` | Override base of `~/.config/gambi/config.json` |
