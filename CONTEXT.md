# Gambi

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted local network. This file is the glossary for the project's domain language. Use these terms exactly when writing issues, plans, ADRs, tests, or code identifiers.

## Language

### Core domain

**Hub**:
The central process (`gambi hub serve`) that holds the registry of rooms and participants and dispatches inference traffic.
_Avoid_: Server, gateway, broker.

**Room**:
A named scope (identified by a short `code`) that groups participants under shared defaults; every inference request targets a room.
_Avoid_: Channel, session, group.

**Participant**:
A registered entry inside a room representing one model endpoint contributed by one machine. Identified by a stable `participantId`.
_Avoid_: Node, peer, agent, worker.

**Provider**:
The actual LLM backend (Ollama, vLLM, OpenRouter, OpenAI, etc.) sitting behind a participant on its own machine. The hub never talks to the provider directly — only through the participant's tunnel.
_Avoid_: Backend, upstream, model server (when referring to the runtime; use **Model** for the named model itself).

**Model**:
A named model exposed by a provider (e.g. `llama3.1:8b`, `gpt-4.1`). A participant exposes one or more models; routing selects participants by participant ID, model name, or wildcard.
_Avoid_: Engine.

### Transport

**Tunnel**:
The WebSocket connection opened by a participant to the hub, over which the hub dispatches every inference request. Always participant-initiated — the hub never originates connections back. (See ADR-0003.)
_Avoid_: Socket (too generic), channel, bridge.

**Bootstrap token**:
A single-use, 60-second token returned by participant registration that authenticates the WebSocket upgrade. Distinct from any future hub-level auth.
_Avoid_: Session token, API key.

**Heartbeat**:
The management-plane liveness signal: a periodic `POST .../heartbeat` from participant to hub. Distinct from the **tunnel ping/pong** — the two run in parallel and answer different questions (heartbeat drives `status`; ping/pong drives `connection.connected`).
_Avoid_: Ping (when referring to management heartbeat — reserve "ping/pong" for tunnel).

### API surfaces

**Management plane**:
The Gambi-native HTTP surface under `/v1/*` — rooms, participants, heartbeats, room events. Used by the CLI, SDK management client, and TUI.
_Avoid_: Control plane (acceptable synonym but inconsistent with codebase).

**Inference plane**:
The OpenAI-compatible HTTP surface under `/rooms/:code/v1/*` — responses, chat completions, models. Consumed by apps via AI SDK, OpenAI SDK, or curl.
_Avoid_: Data plane.

**SDK management client**:
The object returned by `createClient()`; namespaced as `client.rooms.*`, `client.participants.*`, `client.events.*`. Distinct from the inference provider returned by `createGambi()`.
_Avoid_: SDK client (ambiguous — `createGambi()` also returns "a client").

### State

**Status**:
The participant's lifecycle phase: `online`, `busy`, or `offline`. Derived from the management heartbeat. Orthogonal to **connection**.

**Connection** (participant connection):
The participant's tunnel state: `{ kind: "tunnel", connected: boolean, lastTunnelSeenAt }`. Derived from tunnel ping/pong. Orthogonal to **status**. A participant can be `online` but `connection.connected: false`, or vice versa — routing requires both to be healthy.

**Endpoint** (provider endpoint):
The URL where a participant's provider listens (e.g. `http://127.0.0.1:11434`). Informational only on the hub side — the hub never connects to it. The participant runtime is the only thing that actually calls this URL.
_Avoid_: When you mean an HTTP path on the hub, say **route** or **HTTP endpoint** explicitly.

### Routing

**Model selector**:
The value of the `model` field in an inference request, which selects a participant:
- `<participantId>` — route to one specific participant
- `model:<name>` — route to any available participant exposing that model
- `*` or `any` — route to any available participant

A participant is "available" only when its tunnel is connected, its status is not offline, and it is not currently handling another request.

## Relationships

- A **Hub** holds many **Rooms**.
- A **Room** contains zero-to-many **Participants**.
- A **Participant** wraps exactly one **Provider** and exposes one or more **Models**, via its **Tunnel**.
- Every inference request enters through the **Inference plane**, is routed by **Model selector** to one **Participant**, and is dispatched into that participant's **Tunnel**.
- Every operational call (create room, register participant, send heartbeat, watch events) goes through the **Management plane**.
- A **Participant** has a **Status** and a **Connection**; both must be healthy for it to receive routes.

## Example dialogue

> **Dev:** "When a **Participant** joins a **Room**, does the **Hub** call the **Provider** to check what models are available?"
> **Maintainer:** "No — the **Hub** never talks to the **Provider** directly. The **Participant** opens the **Tunnel**, and any capability detection runs on the participant side and is sent up as part of registration."

> **Dev:** "Why does the management response distinguish **Status** from **Connection**? Aren't they the same thing?"
> **Maintainer:** "They answer different questions. **Status** is 'has the participant been sending heartbeats lately?'. **Connection** is 'is the tunnel WebSocket currently open?'. A participant whose heartbeat lapsed but whose tunnel is still alive is in an inconsistent state — and routing rejects it because it requires both."

> **Dev:** "If I want to send a request to a specific machine, do I use the participant ID or the model name?"
> **Maintainer:** "Use the **Participant ID** as the **Model selector**. `model:<name>` picks any participant exposing that model — explicitly non-deterministic. `*` is for 'I really don't care.'"

## Flagged ambiguities

- **"Agent"** is heavily overloaded in this repo:
  - **`docs/agents/`** — files that configure engineering skills (issue tracker, triage labels, domain doc layout). Not for AI agents specifically; the folder name comes from the `setup-matt-pocock-skills` convention.
  - **"Agent-first"** — the design adjective applied to the CLI, HTTP, and SDK surfaces (ADR-0002). Means "structured for non-interactive automation," not "for AI agents specifically."
  - **"`gambi agents`"** — the future product layer described in `docs/product/vision.md`, currently out of scope.
  - _Rule_: never say just "agent" without a qualifier. Say "an automation client," "the agent-first redesign," or "Gambi Agents (the future product)."

- **"Endpoint"** is overloaded between *provider endpoint* (the participant's local URL the hub never reaches) and *HTTP endpoint / route* (a path on the hub). The codebase uses bare `endpoint` to mean **provider endpoint**. When you mean a hub route, say **route** or **HTTP endpoint** explicitly.

- **"Connection"** in this domain means **participant tunnel state**, not TCP/HTTP connections in general. A participant being "connected" specifically means its tunnel is open.

- **"Gambi"** refers to today's product (transport + room hub). The future umbrella brand also called "Gambi" (per ADR-0001) is *brand framing*, not a renamed product. When ambiguity matters, say **Gambi (the hub)** vs **Gambi (the brand)**.

- **"Heartbeat"** is reserved for the management-plane HTTP heartbeat. The tunnel's keepalive is **ping/pong** (`tunnel.ping` / `tunnel.pong`). Saying "the heartbeat failed" implicitly means management; tunnel failures are "ping/pong stopped" or "tunnel closed."
