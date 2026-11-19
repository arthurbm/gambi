# Gambi Contracts

Reference for the public contracts of the Gambi hub: HTTP endpoints, response envelopes, error codes, SSE events, tunnel calls, runtime constants, and CLI surfaces. For the conceptual model behind these contracts, see [`docs/reference/architecture.md`](./architecture.md).

The management plane is defined once, as the `ManagementApi` contract in `packages/protocol/src/management/api.ts`. The hub handlers, the SDK client, the CLI, and the TUI derive from it, and a running hub serves the OpenAPI document generated from it at `GET /v1/openapi.json`. When this page and the contract disagree, the contract wins.

## Versions

A hub and its participants must run the same minor version of Gambi (ADR-0007). The tunnel speaks the wire format of `effect/rpc`, which has no version field, so registration carries the participant's version and the hub refuses a different major or minor with `VERSION_MISMATCH`. Patch versions mix freely. `GAMBI_VERSION` and `sameMinor` live in `packages/protocol/src/version.ts`.

## Response envelopes

Every management response is wrapped in an envelope. The envelope is a wire format only: hub handlers return plain values and fail with typed errors, and the derived client hands the same values back without the envelope.

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

`details` carries the fields of the typed error (`roomCode`, `hubVersion`, `issues`, ...). `meta.requestId` is the id of the request in the hub's log; the CLI prints it with an error, and the SDK sets it on `ClientError`.

## Management error codes

Each typed error class declares its `code` and its HTTP status (`packages/protocol/src/management/errors.ts` and `packages/protocol/src/tunnel/errors.ts`).

| Code | Status | Meaning | `details` |
|---|---|---|---|
| `ROOM_NOT_FOUND` | 404 | The room code does not exist. | `roomCode` |
| `PARTICIPANT_NOT_FOUND` | 404 | The room has no participant with that id. | `roomCode`, `participantId` |
| `PARTICIPANT_OF_ANOTHER_RUNTIME` | 409 | The removal names a different runtime from the one that owns the participant. The participant stays in the room. | `roomCode`, `participantId` |
| `INVALID_PASSWORD` | 401 | The room has a password and the request brought none, or the wrong one. | `roomCode` |
| `VERSION_MISMATCH` | 409 | The participant runtime is on another minor version than the hub. The message names the version the hub expects. | `hubVersion`, `participantVersion` |
| `TUNNEL_TOKEN_INVALID` | 401 | The tunnel upgrade came without a valid bootstrap token. | `roomCode`, `participantId` |
| `NOT_A_HARNESS_PARTICIPANT` | 409 | The participant shares a model endpoint; there is no harness to attach to. | `roomCode`, `participantId` |
| `PARTICIPANT_UNREACHABLE` | 409 | The participant's tunnel is not open now. | `roomCode`, `participantId` |
| `HARNESS_SESSION_NOT_OPEN` | 409 | A message was sent to a harness session that is not open. | `sessionId` |
| `HARNESS_SESSION_OUTSIDE_WORKSPACE` | 403 | A harness session was asked to run outside the participant's Workspace. | `sessionId` |
| `HARNESS_FAILED` | 502 | The harness failed an ACP call the runtime made, or its process is gone. | `reason` (`timedOut`, `rejected`, `invalidAnswer`, `versionNotNegotiated`, `exited`), `method?`, `detail?`, `exitCode?` |
| `INVALID_REQUEST` | 400 | The request does not match the contract (params, query, headers, or body). | `issues: [{ path, message }]` |
| `ROUTE_NOT_FOUND` | 404 | No management route for that method and path. | `method`, `path` |
| `INTERNAL_ERROR` | 500 | A bug in the hub. The cause stays in the hub's log. | none |

Every endpoint can answer `INVALID_REQUEST` and `INTERNAL_ERROR`. The SDK surfaces management errors returned by its typed routes as `ClientError` (see [SDK management client](#sdk-management-client)).

## Management plane endpoints

All under `/v1`:

| Method | Path | Success | Errors besides `INVALID_REQUEST` and `INTERNAL_ERROR` |
|---|---|---|---|
| `GET` | `/v1/health` | `{ status: "ok", timestamp }` | |
| `POST` | `/v1/rooms` | `201` `{ room, hostId }` | |
| `GET` | `/v1/rooms` | `RoomSummary[]` | |
| `GET` | `/v1/rooms/:code` | `RoomSummary` | `ROOM_NOT_FOUND` |
| `PUT` | `/v1/rooms/:code/participants/:id` | `200` `{ participant, tunnel: { token, expiresAt } }` | `ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `VERSION_MISMATCH` |
| `GET` | `/v1/rooms/:code/participants` | `ParticipantSummary[]` | `ROOM_NOT_FOUND` |
| `DELETE` | `/v1/rooms/:code/participants/:id?runtimeId=...` | `{ participantId }` | `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`, `PARTICIPANT_OF_ANOTHER_RUNTIME` |
| `GET` | `/v1/rooms/:code/events` | SSE stream of [room events](#sse-room-events) | `ROOM_NOT_FOUND` |
| `GET` | `/v1/rooms/:code/participants/:id/harness/events` | SSE stream of [attach events](#harness-attach) | `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`, `NOT_A_HARNESS_PARTICIPANT` |
| `POST` | `/v1/rooms/:code/participants/:id/harness/messages` | `202` `{ sessionId }` | the three above, `PARTICIPANT_UNREACHABLE`, `HARNESS_FAILED`, `HARNESS_SESSION_NOT_OPEN` |
| `PUT` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | `{ sessionId }` | the three above, `PARTICIPANT_UNREACHABLE`, `HARNESS_FAILED`, `HARNESS_SESSION_OUTSIDE_WORKSPACE` |
| `DELETE` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | `{ sessionId }` | the three above, `PARTICIPANT_UNREACHABLE`, `HARNESS_FAILED` |
| `GET` | `/v1/rooms/:code/participants/:id/tunnel?token=...` | WebSocket upgrade | `TUNNEL_TOKEN_INVALID` |
| `GET` | `/v1/openapi.json` | OpenAPI document of the contract | |

Notes:

- `POST /v1/rooms` is not idempotent. The body is `{ name, password?, defaults? }`.
- `PUT .../participants/:id` is an idempotent upsert and answers `200` on success. Registering an id that is already in the room updates its profile and keeps its `joinedAt` and its status. The hub checks the version first, then the room, then the password, so a participant on another minor hears "update" even with a wrong password. Another runtime takes ownership when it registers an offline participant. While the tunnel is open, registration only updates the profile. The new runtime takes ownership when it opens its tunnel.
- `DELETE .../participants/:id?runtimeId=...` removes the participant only if `runtimeId` matches the owner. The room hears one `participant.removed` with `reason: "left"`. The hub closes the owner's tunnel with code `4002`. A missing or empty `runtimeId` returns `400 INVALID_REQUEST`.
- The tunnel route is internal: only a participant runtime calls it, with the token its registration returned. A missing, unknown, expired, or spent token, a token of another participant, and a room that does not exist are all `401 TUNNEL_TOKEN_INVALID`. The token is spent before the upgrade, so a request with a valid token and no WebSocket upgrade burns it and gets `400 INVALID_REQUEST`.
- Any other path under `/v1` answers `404 ROUTE_NOT_FOUND` in the error envelope. The inference plane, outside `/v1`, answers in the OpenAI format.
- Both planes answer CORS openly: `Access-Control-Allow-Origin: *`, and `204` to `OPTIONS`.
- There is no heartbeat route and no WebSocket attach route.

### Room fields

`RoomSummary`, returned by `GET /v1/rooms`, `GET /v1/rooms/:code`, and room creation:

- `id`, `code` (six characters of `0-9A-Z`), `name`, `hostId`, `createdAt` (milliseconds since the epoch)
- `participantCount`
- `passwordProtected`
- `defaults?`: the room's runtime defaults without the instructions text, which management responses never show; `hasInstructions` says whether there is one. The hub sends the text to the provider when the default applies to a request.

Runtime defaults (`RuntimeConfig`) accept `temperature` (0 to 2), `top_p` (0 to 1), `max_tokens`, `stop`, `frequency_penalty` and `presence_penalty` (-2 to 2), `seed`, and `instructions`.

### Participant fields

`ParticipantSummary`:

- `id`, `nickname`, `model`
- `runtimeId`: the public ID of the runtime that currently owns the participant
- `endpoint?`: the provider endpoint on the participant's machine. Informational: the hub never calls it.
- `harness?`: `{ id, model?, hosted? }` on a harness participant. Valid ids are `opencode`, `claude-code`, `codex`, and `fake`.
- `config`: the participant's runtime config, redacted like the room defaults
- `specs`: `{ gpu?, vram?, ram?, cpu? }`
- `capabilities`: `{ openResponses, chatCompletions }`, each `supported`, `unsupported`, or `unknown`, as probed on the participant's machine
- `status`: `offline`, `online`, or `busy` (see [Participant status](#participant-status))
- `joinedAt`, `updatedAt`

There is no `connection` field: the status already derives from the tunnel.

### Registration body

`RegisterParticipant` requires `runtimeId`, `nickname`, `model`, and `version` (the runtime's Gambi version). Optional fields are `endpoint`, `harness`, `password`, `specs`, `config`, and `capabilities`. The runtime creates its `runtimeId` once and sends it on every registration, including reconnections. A missing or empty ID returns `400 INVALID_REQUEST`. The hub publishes the ID so clients can name the owner when removing a participant. It grants no authentication.

A body that carries `authHeaders` is refused with `400 INVALID_REQUEST` and the message does not repeat the value. `ParticipantAuthHeaders` stay in the participant runtime.

## Participant status

A participant has one status, derived from its tunnel alone. The table is `transitionStatus` in `packages/protocol/src/participant-status.ts`, and every change goes through it:

| From | Event | To |
|---|---|---|
| (not in the room) | registration | `offline` |
| `offline` | tunnel opens | `online` |
| `online` | the hub dispatches a request | `busy` |
| `busy` | the request ends, is cancelled, or times out | `online` |
| `online`, `busy` | tunnel drops | `offline` (a request in flight fails with a typed error) |
| `offline` | reconnection deadline passes (60 s) | removed |
| any | the participant leaves | removed |

Only `online` participants receive new inference requests (the routes about a stored Response reach their participant when it is `busy` too, but still need its tunnel open: an `offline` one answers `participant_offline`). The reconnection deadline restarts at every registration while the participant is `offline`, and also applies to a participant that registered and never opened its tunnel.

## Inference plane endpoints

OpenAI-compatible, room-scoped, plain routes outside the management contract. All under `/rooms/:code/v1`:

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

- **What the hub reads.** The body must be a JSON object with a non-empty `model` string; `stream` may be absent, a boolean, or `null` (`null` is not a stream). Every other field goes to the provider as it came.
- **Defaults.** Fields the app left out or sent as `null` are filled from the participant's config, then the room defaults (the participant wins). In the Responses API, `max_tokens` fills `max_output_tokens` and `stop` fills `stop_sequences`. The default instructions become a leading `system` message in Chat Completions, unless the app sent one, and fill `instructions` in the Responses API. `model` is replaced by the participant's model.
- **Responses through Chat Completions.** When the participant's provider has no Responses API, the hub creates the Response through Chat Completions and translates the answer. A request that Chat Completions cannot carry fails with `request_not_translatable`, and such a Response cannot be read back, deleted, or cancelled (`response_not_stored`).
- **Stored Responses.** The hub remembers the participant and runtime that created each Response (10 000 per hub by default). Its lifecycle routes reach that runtime even while it is busy. If the participant leaves or another runtime takes its place, the hub answers `response_not_found`. They change no status and emit no room event.
- **Model list.** `GET .../models` lists the participants that share a model endpoint and are not `offline`. Each `id` is the participant id, which is a model selector, and `gambi` says what stands behind it: `{ nickname, model, endpoint, capabilities, status }`.
- **Cancellation.** When the app closes the HTTP request, the hub interrupts the call in the tunnel, the participant runtime aborts the request to its provider, and the participant goes back to `online`.
- **Timeout.** A request that receives no piece of the provider's answer for 5 minutes, before the first piece or between any two, is cancelled the same way and fails with `inference_timeout`.
- **Streaming.** A streamed answer is pumped from the tunnel as soon as each piece arrives. When more than 8 MiB of it is waiting for the app to read, the hub cancels the request and the stream ends with `consumer_too_slow`. An answer that is not a stream is held whole on the hub, up to 32 MiB, so a failure still has a status and a name.

### Inference errors

Inference errors use the OpenAI error format, never the management envelope:

```json
{ "error": { "message": "...", "type": "invalid_request_error", "param": null, "code": "participant_busy" } }
```

`type` is `invalid_request_error` for a status below 500 and `api_error` otherwise. The table is `INFERENCE_FAILURES` in `packages/protocol/src/inference/errors.ts`.

| `code` | Status | Meaning |
|---|---|---|
| `invalid_request` | 400 | The body is not a JSON object, `model` is not a non-empty string, or `stream` is neither absent, a boolean, nor `null`. |
| `room_not_found` | 404 | The room does not exist. |
| `model_not_found` | 404 | No participant can take a request for that model selector. |
| `participant_busy` | 409 | The selector names a participant that is handling another request. |
| `participant_offline` | 503 | The selector names a participant whose tunnel is not open. |
| `participant_disconnected` | 502 | The tunnel dropped while the participant was answering. |
| `inference_timeout` | 504 | Nothing arrived from the participant for the idle timeout. |
| `provider_response_too_large` | 502 | An answer that is not a stream exceeded what the hub holds. |
| `consumer_too_slow` | 408 | The app read a stream too slowly. Only sent as the last event of a stream, whose HTTP status (the provider's) was already sent; the `408` is never the response status. |
| `request_not_translatable` | 400 | The provider is reached through Chat Completions, which cannot carry this request. |
| `response_not_found` | 404 | The hub knows no Response with that id in the room. |
| `response_not_stored` | 501 | The Response was answered through Chat Completions and is stored nowhere. |
| `responses_not_supported` | 501 | The provider speaks neither the Responses API nor Chat Completions. |
| `inference_not_supported` | 400 | The selector names a harness participant. |
| `provider_unreachable` | 502 | The participant's provider did not answer. |
| `provider_response_interrupted` | 502 | The provider's answer broke in the middle. |
| `internal_error` | 500 | A bug in the hub. |

An error that happens after a stream started arrives as its last event, and no `[DONE]` follows it:

```text
event: error
data: {"type":"error","code":"participant_disconnected","message":"...","param":null,"error":{"message":"...","type":"api_error","param":null,"code":"participant_disconnected"}}
```

The top-level fields are the `error` event of the Responses API, and `error` is the error object of Chat Completions, so a client of either API reads it.

## Model routing

The `model` field selects the participant. There are four forms:

- `*` or `any`: any `online` participant, at random.
- `model:<name>`: the first `online` participant that shares that model.
- `<participantId>` or `<name>`: the `online` participant with that id; otherwise the first `online` participant whose model is that name (this is what a plain OpenAI client sends); otherwise, when a participant with that id is `busy` or `offline`, `participant_busy` or `participant_offline`.

`*`, `any`, and values that start with `model:` are read as the selectors above before any participant id, so a participant registered with such an id cannot be named. A participant id is also not an exact target: when that participant cannot take the request, another one whose model has the same name can. Only `online` participants are picked, so a participant never takes two requests at once. A selector that names a participant that cannot take the request says why (`participant_busy`, `participant_offline`); every other miss is `model_not_found`. Harness participants are never picked by `*`, `any`, or a model name; naming one by id returns `400 inference_not_supported`. To talk to a harness, use the [harness attach](#harness-attach).

## SSE room events

`GET /v1/rooms/:code/events` streams Server-Sent Events. Each event repeats its `type` on the `event:` line and carries one JSON object in `data`:

```text
event: participant.online
data: {"type":"participant.online","roomCode":"ABC123","timestamp":1763460000000,"participant":{...},"previousStatus":"offline"}
```

Every event has `type`, `roomCode`, and `timestamp` (milliseconds since the epoch, on the hub's clock) at the top level, next to its own fields. The hub writes a `: keepalive` comment every 15 seconds on a quiet stream. Events have no `id:` and no sequence number.

| `type` | Own fields | When |
|---|---|---|
| `room.snapshot` | `room`, `participants` | First event of every stream: the room at the moment the stream started. |
| `participant.joined` | `participant` | A participant registered. It starts `offline`. |
| `participant.updated` | `participant` | A participant already in the room registered again. Its status did not change. |
| `participant.online` | `participant`, `previousStatus` | Its tunnel opened, or the request it was answering ended. |
| `participant.busy` | `participant`, `previousStatus` | The hub dispatched a request to it. |
| `participant.offline` | `participant`, `previousStatus` | Its tunnel dropped. |
| `participant.removed` | `participantId`, `reason` | It left (`left`) or stayed offline past the deadline (`reconnectDeadlinePassed`). |
| `llm.request` | `requestId`, `participantId`, `model`, `protocol`, `modelSelector` | The hub dispatched an inference request. |
| `llm.complete` | `requestId`, `participantId`, `model`, `protocol`, `status`, `metrics` | The provider's answer ended. `status` is the HTTP status the provider answered with. |
| `llm.error` | `requestId`, `participantId`, `model`, `protocol`, `stage`, `code`, `error` | The request ended without the provider's whole answer. |

- `requestId` in the `llm.*` events is the id of the HTTP request on the hub, the same in the three events and in the hub's log. `model` is the participant's model; `modelSelector` is what the app asked for. `protocol` is `chatCompletions` or `openResponses` (a Response translated through Chat Completions reports `openResponses`).
- `llm.error.stage` is `dispatch` when the app had received nothing yet and `stream` when a streamed answer was already on its way. `code` is the inference error `code` the app got, or `request_cancelled` when the app itself gave the request up.
- `metrics` has `ttftMs` and `durationMs`, plus `inputTokens`, `outputTokens`, `totalTokens`, and `tokensPerSecond` when the provider reported `usage` in an answer that is not a stream. See [`docs/reference/observability.md`](./observability.md).
- The hub holds up to 256 events for each subscriber. A subscriber further behind loses the oldest ones; the `room.snapshot` at the start of each connection is what realigns a client that reconnects.
- Harness sessions and artifacts are not room events. They travel on the [harness attach](#harness-attach) stream.

## Harness attach

A management client attaches to a harness participant with one SSE stream and three ordinary requests (see the endpoint table). Any number of clients attach to the same participant, and each stays attached while the participant's tunnel is down.

The stream (`GET .../harness/events`) carries `HarnessAttachEvent` (`packages/protocol/src/harness.ts`), in the same SSE shape as room events:

| `type` | Fields | When |
|---|---|---|
| `harness.connected` | | The hub is receiving the harness. First event when the tunnel is open, and again after each reconnection. |
| `harness.disconnected` | `reason`, `message?` | The hub is not receiving it. `reason` is `NoTunnel` for a first event without a tunnel, otherwise the error that ended the participant's stream (`SocketCloseError`, `SocketReadError`, `CallNotSupported`, ...). |
| `harness.message` | `sessionId`, `message` | An ACP v1 message the harness wrote for that session. |
| `harness.session` | `sessionId`, `status` (`opened`, `closed`, `error`), `message?` | A harness session changed. |
| `harness.artifact` | `sessionId`, `version`, `reason` (`watch`, `final`), `files` | A snapshot of the participant's Workspace. |
| `harness.dropped` | `count` | This client read too slowly and lost its `count` oldest events at this point. The hub holds 1024 events per client. |
| `harness.detached` | `reason` (`left`, `reconnectDeadlinePassed`) | The participant is out of the room. Last event of the stream. |

- Nothing is replayed for a client that attaches late: the first event is the state of the link.
- `POST .../harness/messages` takes `{ sessionId, message }`, where `message` is one ACP v1 JSON-RPC object. It answers `202` when the message is written to the harness, not when the harness answers; the answer arrives on the stream.
- `PUT .../harness/sessions/:sessionId` opens a session under the id the client picked, with an optional `{ cwd }` inside the Workspace. Opening a session that is already open leaves it as it is.
- `DELETE .../harness/sessions/:sessionId` closes it. A session that is not open is already closed.
- Every client attached to a participant reads every event of that participant, including the answers to the other clients' requests. Filter `harness.message` by `sessionId` and match answers to requests by their JSON-RPC `id`. The participant runtime rewrites the JSON-RPC `id` of each request on its way to the harness and restores it on the answer, and maps each `sessionId` to the id the harness gave the session, so requests of two clients with the same `id` in different sessions never get each other's answers. Within one shared session the restored ids can collide: give each client its own session id, or coordinate request ids among the clients of a session. It does not interpret the rest of the ACP content.

### Artifacts

A harness session runs in a **Workspace** on the participant's machine; the hub never sees it. Without a Workspace of its own, the runtime uses:

```text
~/.gambi/workspaces/<room>/<participant-id>/
```

The default Workspace is created empty, except for `.gambi.json` (local metadata that never appears in an artifact), when it does not exist yet; a later join with the same room and participant id reuses it with whatever it holds. An artifact is a whole snapshot of the Workspace, never a difference: each one replaces the one before. The runtime takes one when the Workspace has changed and stayed still for one second (`reason: "watch"`) and a last one when it closes (`reason: "final"`). The final one is best effort: it gets up to 2 seconds while the harness and the tunnel are still running, and then the tunnel closes and the harness stops. `version` counts the artifacts of one runtime from 1, and a client may see versions skip. Each file has its `path` inside the Workspace (with `/`), its `encoding` (`utf8` for valid UTF-8, otherwise `base64`), and its whole `content`. `.git`, `node_modules`, and symbolic links are left out.

Known limits:

- An artifact is sent only when its JSON is at most 8 MiB (`MAX_ARTIFACT_BYTES`). A Workspace that does not fit sends no artifact at all, and whoever hosts the runtime is told (`artifact_skipped` in the CLI, `onArtifact` in the SDK).
- Artifacts are delivered at most once. `artifact_sent` (CLI) and `artifactSent` (SDK) mean the artifact entered the queue to the hub, not that it arrived: an artifact queued when the tunnel drops is lost.
- One tunnel message above 16 MiB drops the tunnel. That covers a single batch of ACP messages from the harness above 16 MiB.

The tunnel has no call that writes files on the participant's machine.

## Tunnel calls

The tunnel is `effect/rpc` over a WebSocket, with the roles inverted: the participant runtime dials the WebSocket and serves the calls, and the hub accepts the socket and makes them. The hub never originates a connection. The calls are `TunnelRpcs` in `packages/protocol/src/tunnel/rpcs.ts`; every one goes from the hub to the participant.

| Call | Kind | Purpose |
|---|---|---|
| `Welcome` | unary | First call on a new tunnel: `{ roomCode, participantId, hubVersion, pingIntervalMillis }`. The participant is `online` from then on. |
| `Infer` | stream | One request for the participant's provider: `{ operation, body }` for `chatCompletions.create` and `responses.create`, or `{ operation, responseId, query? }` for the four operations on a stored Response. The answer streams back as one `Head { status, contentType? }` and then `Body { text }` chunks. Interrupting the call aborts the request to the provider. |
| `HarnessEvents` | long-lived stream | Opened by the hub right after `Welcome`. Everything born on a harness participant (`harness.message`, `harness.session`, `harness.artifact`) goes up as a chunk of it, for as long as the tunnel lives. |
| `HarnessSend` | unary | Hands one ACP message to the harness for one session. |
| `HarnessOpenSession` | unary | Opens a harness session under a given id, with an optional `cwd` inside the Workspace. |
| `HarnessCloseSession` | unary | Closes a harness session. |
| `Echo`, `Ticks` | unary, stream | Diagnostics: a round trip and a stream of integers through the tunnel. |

Tunnel errors: `CallNotSupported` (an inference call to a harness participant, or a harness call to an endpoint participant), `ProviderUnreachable`, `ProviderResponseInterrupted`, `HarnessSessionNotOpen`, `HarnessSessionOutsideWorkspace`, `HarnessFailed`. The hub turns them into the error of the plane the request came from. Provider failures keep their cause in the participant runtime's log; it never crosses the tunnel.

Opening and keeping the tunnel:

1. The runtime registers (`PUT .../participants/:id`) and gets a bootstrap token. The token is valid for 60 seconds and for one tunnel of that participant in that room.
2. The runtime builds the tunnel URL from the hub URL it registered with (`tunnelUrl` in `rpcs.ts`) and dials `GET .../participants/:id/tunnel?token=...`.
3. The hub marks the participant `online` and calls `Welcome`. The runtime counts the join as done when `Welcome` arrives.
4. The hub pings every tunnel every 5 seconds and drops one that stays silent for one more interval. The runtime watches the frames it receives and drops the tunnel itself after three ping intervals of silence (15 seconds by default), which catches a frozen hub.
5. When a runtime opens a second tunnel for the same participant, the hub keeps the new one and closes the old one with the WebSocket close code `4001` (`TUNNEL_REPLACED_CLOSE_CODE`). A runtime that sees that code was replaced by another runtime with its `participantId` and does not dial again.
6. On explicit removal, the hub sends `4002` (`TUNNEL_REMOVED_CLOSE_CODE`) on the removed runtime's open tunnel. If that runtime dials with a still-valid bootstrap token issued before removal, the hub accepts the upgrade and closes with `4002` before `Welcome`.

## Participant runtime

The participant runtime (`packages/core/src/participant/runtime.ts`) joins once: it registers and opens the tunnel, and fails at once if either fails. After the join it reconnects by itself when the tunnel drops: it waits 1 second, then doubles the wait up to 30 seconds (no jitter, not configurable), registers again for a new token, and dials again with the same `participantId`. Registration and the tunnel opening each have a 10-second limit.

| Failure on the way back | What the runtime does |
|---|---|
| Hub unreachable, transient failure opening the tunnel, `INTERNAL_ERROR` | tries again |
| Tunnel closed with `4001` or `4002`, even before `Welcome` | ends with `replaced` or `removed`, respectively |
| `VERSION_MISMATCH`, `ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `INVALID_REQUEST` | ends (`left` with `reason: "refused"`) |

Lifecycle events, reported in order from the join on (CLI events and the SDK's `onLifecycle` are built on them):

| `type` | Fields | When |
|---|---|---|
| `connected` | `attempt`, `hubVersion` | The tunnel opened and the participant is `online`. `attempt` is `0` for the join, then the number of the attempt that brought it back. |
| `reconnecting` | `attempt`, `delayMillis`, `reason` | Not connected; tries again in `delayMillis`. `reason`: `tunnelDropped`, `hubSilent`, `hubUnreachable`, `tunnelOpenFailed`, `hubError`. |
| `left` | `reason`, `error?` | The runtime ended. `reason` is `stopped`, `refused` (with the hub's error), `replaced`, `removed`, or `tunnelDropped` (only with reconnection turned off). |

After its first `Welcome`, a runtime that receives `4002` emits `left` with `reason: "removed"` and no `error`, even with `reconnect: false`. It never registers or dials again. Its `ParticipantRuntime.ended` fails with `ParticipantRemoved` (`roomCode`, `participantId`). Before the first `Welcome`, `4001` or `4002` fails the join with `TunnelOpenFailed` and no `left` event. Its `closed` field is `replaced` or `removed`, respectively.

Stopping the runtime locally closes the tunnel. Its host sends `DELETE .../participants/:id?runtimeId=...` to leave the room immediately. Otherwise the participant stays `offline` until the 60-second deadline.

Known limits:

- If someone removes a runtime between reconnection attempts, it has no open or pending tunnel to receive `4002`. Its next attempt registers it in the room again. A local leave stops the retry.
- A restarted hub loses its rooms. A runtime trying to come back hears `ROOM_NOT_FOUND` and ends with `refused`. Recreating a room under a chosen code is issue #132.

### Harness participant runtime

A harness participant runs its harness as a child process that speaks ACP v1 on stdio. The runtime makes three typed ACP calls (`initialize`, `session/new`, `session/close`) and passes every other message through without reading it. The child runs in a process group of its own; stopping the runtime asks it to stop and kills it after 2 seconds.

Known limits:

- If the runtime is killed with `kill -9`, nothing can stop the harness. A harness that does not watch its stdin for the end of input keeps running as an orphan.
- An answer to `session/new` that arrives after its 10-second timeout is dropped, and that session stays open in the harness with nobody to use it.

## Runtime constants

| Value | Default | Where |
|---|---|---|
| Hub port, interface | `3000`, `0.0.0.0` | `DEFAULT_HUB_PORT`, `DEFAULT_HUB_HOSTNAME` in `packages/core/src/hub/hub.ts` |
| Tunnel ping interval | 5 s | `HubOptions.tunnelPingInterval` |
| Hub drops a silent tunnel after | one more ping interval | `effect/rpc` ping |
| Runtime drops a silent hub after | 3 ping intervals | `HUB_SILENCE_PING_INTERVALS` in `packages/core/src/participant/runtime.ts` |
| Reconnection deadline (offline participant removed) | 60 s | `HubOptions.reconnectDeadline` |
| Reconnection wait | 1 s doubling to 30 s | `RECONNECT_FIRST_DELAY`, `RECONNECT_MAX_DELAY` |
| Registration and tunnel opening limits | 10 s each | `ParticipantRuntimeOptions` |
| Bootstrap token lifetime | 60 s, single use | `BOOTSTRAP_TOKEN_TTL` in `packages/core/src/hub/tunnels.ts` |
| Inference idle timeout | 5 min | `HubOptions.inferenceIdleTimeout` |
| Unread stream limit | 8 Mi characters | `MAX_PENDING_STREAM_CHARACTERS` in `packages/core/src/hub/inference.ts` |
| Held non-stream answer limit | 32 Mi characters | `MAX_HELD_RESPONSE_CHARACTERS` |
| Stored Responses per hub | 10 000 | `HubOptions.storedResponsesLimit` |
| Room events held per subscriber | 256 | `ROOM_EVENT_BUFFER` in `packages/core/src/hub/room-events.ts` |
| Attach events held per client | 1024 | `HubOptions.harnessClientBuffer` |
| SSE keepalive comment | every 15 s | `EVENT_STREAM_KEEP_ALIVE` in `packages/protocol/src/management/event-stream.ts` |
| Largest artifact | 8 MiB | `MAX_ARTIFACT_BYTES` in `packages/protocol/src/harness.ts` |
| Artifact settle time | 1 s | harness participant options |
| Harness stop before forced kill | 2 s | `DEFAULT_HARNESS_STOP_TIMEOUT` in `packages/core/src/harness/harness.ts` |
| ACP call timeout | 10 s | `DEFAULT_HARNESS_REQUEST_TIMEOUT` |
| Provider probe timeout | 5 s | `PROBE_TIMEOUT` in `packages/core/src/participant/endpoint-capabilities.ts` |

`gambi hub serve` exposes only the port, the interface, and mDNS. The SDK's `createHub` also takes the inference idle timeout and the reconnection deadline.

## Runtime defaults merge order

At request time the hub fills the fields the app left out, in this order:

1. participant config
2. room defaults

Sensitive config is not exposed raw in public management responses. Provider auth headers (`ParticipantAuthHeaders`) are never uploaded to the hub: registration refuses them, and they are applied only by the participant runtime when it calls its local provider.

## SDK management client

`createClient()` from `gambi-sdk` derives from the contract and returns plain values, without the envelope. Every failure of a call to the hub is a `ClientError` (after `client.close()`, a `Promise` method rejects with a plain `Error`, and `events.watch()` or `harness.attach()` throws one at once) with `code`, `status?`, `hint?`, `details`, `requestId?`, and `cause`. `code` is one of the management codes above except `TUNNEL_TOKEN_INVALID` and `ROUTE_NOT_FOUND`, plus two the client finds on its own:

- `HUB_UNREACHABLE`: nothing answered at the hub URL.
- `NOT_A_HUB`: something answered outside the contract: another server, a proxy, or a hub of another version. A `ROUTE_NOT_FOUND` arrives as `NOT_A_HUB` with `status: 404`.

## Discovery helpers

In the `gambi-sdk/discovery` entry (`packages/sdk/src/discovery.ts`):

- `discoverHubs()`
- `discoverRooms()`
- `resolveGambiTarget()`

They use mDNS plus the management API. Discovery is always explicit: `createGambi()` and `createClient()` never perform it.

## CLI exit codes

The table from typed error to exit code is `failureKinds` in `packages/cli/src/cli/exit-codes.ts`.

| Code | Meaning | Typed errors |
|---|---|---|
| `0` | Success. Also a group or `gambi` without a subcommand (help is shown). | |
| `1` | Internal failure: a bug here or in the hub. | `InternalError`, `HubListenFailed`, `PackageManagerFailed`, `PackageManagerUnavailable`, `BinaryReplaceFailed`, `UpdateNotScheduled`, `UnexpectedFailure` (a defect) |
| `2` | Invalid usage. Retrying will not help. | every parse error (`MissingOption`, `InvalidValue`, `UnrecognizedOption`, ...), a cancelled prompt for a missing flag, `PortInUse`, `InvalidRequest`, `FlagsDoNotCombine`, `WorkspaceFailed` |
| `3` | Something the command depends on is not there: the hub, the network, the provider, the harness. Retry later. | `HubUnreachable`, `NotAHub`, `MdnsAnnounceFailed`, `EndpointUnreachable`, `ModelNotOnEndpoint`, `TunnelOpenFailed`, `HarnessNotReady`, `HarnessStartFailed`, `HarnessFailed`, `UnknownInstallSource`, `UpdateDownloadFailed` |
| `4` | The hub refused the request, replaced the runtime, or removed it. | `RoomNotFound`, `ParticipantNotFound`, `InvalidPassword`, `VersionMismatch`, `ParticipantReplaced`, `ParticipantRemoved`, `ParticipantOfAnotherRuntime` |
| `130` | A signal stopped a command that was not waiting for one, or a second signal arrived while the command was stopping. | |

`hub serve`, `participant join`, and `events watch` wait for a signal: the first Ctrl+C or SIGTERM makes them clean up and exit `0`.

## CLI output

- `--format text|json|ndjson`. Without it, `GAMBI_FORMAT`; without that, `text` when stdout is a terminal and `json` otherwise.
- A one-shot command prints its result as `{ "data": ... }`, indented for `json` and on one line for `ndjson`.
- A long command (`hub serve`, `participant join`) prints one JSON line per step, `{ "type", "timestamp", "data" }`, in both `json` and `ndjson`.
- `events watch` prints each room event as it is, one JSON line per event, without a wrapper, in `json` and `ndjson`. In `text` it prints the time, the type, and a summary.
- Errors go to stderr. Outside text mode they are one JSON line: `{ "error": { "name", "message", "hint"?, "details"?, "exitCode" } }`, where `name` is the typed error. In text mode: `Error (Name): message`, then `Hint: ...` and `request_id: ...` when present.
- Log lines go to stderr too, as JSON outside text mode. `--log-level` sets the minimum level; `--log-level none` silences them.

## CLI global flags

Every command accepts:

- `--format text|json|ndjson`
- `--no-interactive`: never prompt for a missing flag, even on a terminal; fail instead. A prompt also needs stdin and stdout on a terminal.
- `--log-level all|trace|debug|info|warn|warning|error|fatal|none`
- `--help`, `-h`; `--version`, `-v`; `--completions bash|zsh|fish|powershell|sh|pwsh`; `--wizard`

Every command that talks to a hub accepts `--hub <url>` (`-H`). Its value comes from the flag, then `GAMBI_HUB`, then `http://localhost:3000`.

## CLI commands

| Command | Flags |
|---|---|
| `gambi hub serve` | `--host` (default `0.0.0.0`), `--port` (default `3000`; `0` takes any free port), `--mdns`, `--dry-run` |
| `gambi room create` | `--name`, `-n`; `--password`, `-p`; `--config <file\|->`; `--hub`; `--dry-run` |
| `gambi room list` | `--hub`; `--sort participant-count\|created-at\|name`; `--reverse` |
| `gambi room get` | `--code`, `-c`; `--hub` |
| `gambi participant join` | `--room`, `-r`; `--participant-id`; `--model`, `-m`; `--endpoint`, `-e` (default `http://localhost:11434`); `--header Name=Value` (repeatable); `--header-env Name=VARIABLE` (repeatable); `--harness opencode\|claude-code\|codex\|fake`; `--workspace <folder>`; `--nickname`, `-n`; `--password`, `-p`; `--config <file\|->`; `--no-specs`; `--hub`; `--dry-run` |
| `gambi participant leave` | `--room`, `-r`; `--participant-id`; `--hub` |
| `gambi events watch` | `--room`, `-r`; `--hub` |
| `gambi self update` | `--manager bun\|npm`; `--yes`; `--dry-run` |

- `--config` reads a JSON runtime config from a file, or from stdin with `-`.
- On a terminal, a missing required flag becomes a prompt: the room name in `room create`, the code in `room get`, the room, participant id and model in `participant join` (the model is picked from the ones the endpoint lists). Passwords and nicknames are never asked; pass `--password`.
- `hub serve` events: `started` (`host`, `port`, `mdns`, `hubUrl`; `port` is the real one when you asked for `0`), `mdns_registered` (`name`), `signal_received` (`signal`), `stopped` (`signal`). The hub runs with the CLI's version.

### `participant join`

Without `--harness` the participant shares a model endpoint; `--model` is required outside a terminal. `--header` and `--header-env` are the `ParticipantAuthHeaders`: they go to the endpoint probe and to the requests to the provider, and nowhere else. A blank header name or value in `--header`, and a variable named in `--header-env` that is missing, empty, or blank, are invalid usage (exit `2`).

With `--harness <id>` the participant shares a harness: `--model` is optional and becomes `harness.model`, `--workspace` picks the folder (default `~/.gambi/workspaces/<room>/<participant-id>/`), and `--endpoint`, `--header`, and `--header-env` are refused with exit code `2` (`FlagsDoNotCombine`). `--workspace` without `--harness` is invalid usage too.

The nickname defaults to `<model>@<the first six characters of the participant id>`. `--dry-run` runs every local check (probes the endpoint, or detects the harness), prints what would be registered with the password and headers redacted, and does not talk to the hub.

Events, each with `roomCode` in `data`, and `participantId` in all of them but `registered`:

| `type` | Own fields of `data` | When |
|---|---|---|
| `harness_started` | `harness`, `pid`, `sessionId`, `workspace` | Harness only: the harness is running and its first session is open. Comes before `registered`. |
| `registered` | `participant` (no top-level `participantId`: use `participant.id`) | The hub registered the participant. Its `status` there is `offline` for a new participant; re-registering an id already in the room keeps that participant's status. |
| `tunnel_connected` | `attempt`, `hubVersion` | The tunnel opened. `attempt` is `0` on the join. |
| `reconnecting` | `attempt`, `delayMillis`, `reason` | The tunnel dropped and the runtime tries again. |
| `artifact_sent` | `sessionId`, `version`, `reason`, `fileCount`, `bytes` | Harness only: an artifact entered the queue to the hub. |
| `artifact_skipped` | `sessionId`, `reason`, `cause` (`tooLarge`, `collectFailed`), `maxBytes?` | Harness only: the Workspace could not be sent. |
| `harness_exited` | `harness`, `message`, `exitCode?` | Harness only: the harness ended on its own. |
| `leaving` | `signal` | SIGINT or SIGTERM asked the command to leave. |
| `left` | `reason`, `removed` | The stay ended. Always the last event. |

`left.reason` is `stopped` (a signal, exit `0`), `refused` (exit code of the hub's error), `replaced` (another runtime took over, exit `4`), `removed` (the hub removed this runtime, exit `4`), or `harnessExited` (exit `3`). `left.removed` is true for `removed` and false for `refused` and `replaced`. On local leave it is true if the hub removed the participant or confirmed it was already absent. It is false if another runtime owns the participant or the CLI could not confirm removal within 3 seconds.

On a signal, an online endpoint participant leaves the room first and then stops. A runtime waiting to reconnect stops before sending the removal. If a signal interrupts the join and another runtime owns the ID, the CLI leaves that participant in the room, online or offline. On a terminal it prints `Stopped. Another participant runtime holds <id> in room <room>, and it stays there.` A harness participant first takes the final artifact while the harness and the tunnel are still running (best effort, up to 2 seconds), then closes the tunnel, stops the harness, and leaves the room. A harness that is not installed or not logged in fails the join with exit code `3` and a message that says what to do.

Harness adapters and readiness checks, all local:

| Harness id | ACP command | Readiness check |
| --- | --- | --- |
| `opencode` | `opencode acp` | `opencode auth list --pure` (OpenCode 1.x, `●` marks a credential), then `opencode auth list --format json` (OpenCode 2.x, any provider connection) |
| `claude-code` | `claude-agent-acp` from `@agentclientprotocol/claude-agent-acp` | `claude auth status --json` |
| `codex` | `codex-acp` from `@agentclientprotocol/codex-acp` | `codex login status` |
| `fake` | bundled deterministic agent (`gambi __fake-acp-agent` in the binary) | the bundled agent file exists (always true in the binary) |

If neither OpenCode check gives a recognized answer, the join continues with a warning on stderr instead of blocking a user who may be logged in. No readiness output or credential is registered or tunneled. Claude Code prints Anthropic's terms warning on join and refuses `hosted: true`: every end user runs the unmodified binary with their own local authentication; Gambi never intermediates subscription login or hosts Claude Code for third parties.

### Other commands

- `participant leave` reads the participant's `runtimeId` from the room listing and sends it with the removal. Success prints `{ "data": { "participantId" } }`. A connected `participant join` ends with `ParticipantRemoved`. If ownership changes between the list and the removal, `participant leave` exits with `ParticipantOfAnotherRuntime` (code `4`) and the new owner stays.
- `events watch` ends with `0` on Ctrl+C and also when the hub closes the stream. It does not reconnect.
- `self update` updates to the latest release (it cannot pick a version) with `bun`, with `npm`, or by replacing the standalone binary, depending on how gambi was installed. Outside a terminal it updates without asking. Answering no (or cancelling the question) exits `0`. A package manager failure exits `1` with its own exit code in `details.code`; a failed download exits `3`.

## CLI environment variables

| Variable | Purpose |
|---|---|
| `GAMBI_HUB` | Hub URL when `--hub` is not passed |
| `GAMBI_FORMAT` | Fallback for `--format` |
| `GAMBI_NO_INTERACTIVE=1` | Disable prompts everywhere |
| `GAMBI_UPDATE_BASE_URL` | Where `self update` downloads standalone binaries from |
| any variable named by `--header-env` | Value of that provider header |
| `PATH` | Where harness detection looks for `opencode`, `claude`, `claude-agent-acp`, `codex`, and `codex-acp` |

Named environments are gone in 0.8: `--env`, `GAMBI_ENV`, and `~/.config/gambi/config.json` no longer exist. Use `--hub` or `GAMBI_HUB`.
