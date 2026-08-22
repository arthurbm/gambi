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

### Harness layer

**Harness**:
A runtime that turns a model into an agent: it supplies a system prompt, tools, an agentic loop, and a translation layer across models (OpenCode, Claude Code, Codex, Pi). A harness runs on a person's machine, in that person's own context and authentication.
_Avoid_: Agent runtime, coding agent (too narrow), "agent" alone.

**Harness participant**:
A participant that contributes a harness to a room instead of a bare model endpoint. Usually one per person (their own OpenCode, Claude Code, Codex or Pi, under their own login); the room host may also contribute **hosted** harness participants for people who bring none. Like every participant it speaks to the hub only through its tunnel; the hub never reaches the harness directly.
_Avoid_: Agent participant, worker.

**Harness session**:
One conversation inside a harness, with its own working directory and native history. A harness participant may hold several. Distinct from a **Room** (which `CONTEXT.md` already forbids calling "session").
_Avoid_: Session (bare), thread, chat.

**Orchestrator**:
A harness whose tools are other harness participants: it decomposes an objective, dispatches work to squads, and integrates what comes back. It always has one human steering it. Orchestration lives above the hub, never inside it.
_Avoid_: Coordinator, manager, supervisor, mayor.

**Steerer**:
The one human currently responsible for a harness: the only person who writes to it, and the one who accepts or returns its output with a reason. The role rotates; it is not tied to a machine.
_Avoid_: Operator, supervisor, owner, driver.

**Squad**:
A group of people, each possibly with their own harness participant, with one steerer at a time. Per round the squad designates which harness participant receives dispatches (normally the steerer's). The unit of social participation in a shared experience.
_Avoid_: Team, group, crew.

**Dispatch** (harness dispatch):
The orchestrator handing a typed task (objective, input, expected output, constraints) to one harness participant's session. Distinct from inference-plane **routing** of a single model request.
_Avoid_: Assign, delegate (fine in prose, not as the term).

**Draft**:
A proposal a squad member offers to the current steerer, written by hand or produced by the member's own harness; the orchestrator also seeds two or three per challenge. Only the steerer can turn a draft into input for the dispatched harness.
_Avoid_: Suggestion, comment, vote.

**Decision**:
The squad's recorded answer to a challenge before any dispatch: what it builds, what it cuts, why, which drafts it considered, and who steered. Decisions are first-class and visible; they are the evidence that humans deliberated.
_Avoid_: Plan, choice, vote.

**Challenge**:
What the orchestrator hands a squad per round, together with seeded drafts. A squad answers a challenge with a decision, then dispatches.
_Avoid_: Task (reserve for the typed dispatch payload), mission.

**Return** (returned output):
The steerer sending a harness's output back with a reason instead of accepting it. Returns are logged; their count per squad is the first divergence signal.
_Avoid_: Reject, veto, fail.

## Relationships

- A **Hub** holds many **Rooms**.
- A **Room** contains zero-to-many **Participants**.
- A **Participant** wraps exactly one **Provider** and exposes one or more **Models**, via its **Tunnel**.
- Every inference request enters through the **Inference plane**, is routed by **Model selector** to one **Participant**, and is dispatched into that participant's **Tunnel**.
- Every operational call (create room, register participant, send heartbeat, watch events) goes through the **Management plane**.
- A **Participant** has a **Status** and a **Connection**; both must be healthy for it to receive routes.
- A **Harness participant** is a **Participant**; it holds one-to-many **Harness sessions**.
- A **Squad** is people, zero-to-many **Harness participants** (one designated per round for dispatch), exactly one **Steerer** at a time, and any number of **Drafts**.
- Per round: a **Challenge** gathers **Drafts**, the steerer records a **Decision**, then the orchestrator **dispatches**; output is accepted or **returned**.
- An **Orchestrator** is a harness; it **dispatches** to harness participants and receives accepted or **returned** output.

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

- **"Substrate" / "social primitives"** are **internal vocabulary** — they name the two layers of the product/research model in `docs/product/research-direction.md`: the *substrate* is what Gambi ships today (hub, tunnel, routing, observability); *social primitives* is the layer above it (turn-taking, shared context, agent-to-agent interaction), still research. Use them freely in `docs/` and in design conversation. _Rule_: never in public copy (landing, docs pages, README). A reader who has not read the research doc gets nothing from either term — say the concrete thing instead ("turn-taking, shared context, models talking to models"). Ruled in ADR-0001 § 7 (E6).

- **"Heartbeat"** is reserved for the management-plane HTTP heartbeat. The tunnel's keepalive is **ping/pong** (`tunnel.ping` / `tunnel.pong`). Saying "the heartbeat failed" implicitly means management; tunnel failures are "ping/pong stopped" or "tunnel closed."

- **"Steerer"** is a role, not a person or a machine. "The steerer of squad B" changes every round. Never say "the steerer's laptop"; say "the squad's harness participant".

- **"Orchestrator"** names the harness, not the human steering it. Say "the orchestrator's steerer" for the person.
