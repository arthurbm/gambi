# Gambi - Architecture

This document describes the current architecture of Gambi, a system for sharing local LLMs across a network.

`Gambi` is the official short form of **gambiarra**. The shorter name works better in English for CLI/package ergonomics, while preserving the PT-BR meaning of creative, resourceful improvisation under constraints.

## Overview

Gambi enables multiple users on a local network to share their LLM endpoints (Ollama, LM Studio, LocalAI, vLLM, or any endpoint that exposes OpenResponses or chat/completions) through a central hub. The system is designed to work seamlessly with the Vercel AI SDK.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GAMBI HUB (HTTP)                              │
│                                                                             │
│  HTTP Endpoints:                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ POST   /rooms                    ← Create a room                   │    │
│  │ GET    /rooms                    ← List all rooms                  │    │
│  │ POST   /rooms/:code/join         ← Participant registers endpoint  │    │
│  │ DELETE /rooms/:code/leave/:id    ← Participant leaves              │    │
│  │ POST   /rooms/:code/health       ← Health check (10s interval)     │    │
│  │ GET    /rooms/:code/participants ← List participants               │    │
│  │                                                                    │    │
│  │ LLM Proxy (Responses-first):                                      │    │
│  │ POST   /rooms/:code/v1/responses                                 │    │
│  │ GET    /rooms/:code/v1/responses/:id                             │    │
│  │ DELETE /rooms/:code/v1/responses/:id                             │    │
│  │ POST   /rooms/:code/v1/responses/:id/cancel                      │    │
│  │ GET    /rooms/:code/v1/responses/:id/input_items                 │    │
│  │ POST   /rooms/:code/v1/chat/completions                          │    │
│  │ GET    /rooms/:code/v1/models                                    │    │
│  │                                                                    │    │
│  │ SSE (for TUI):                                                    │    │
│  │ GET    /rooms/:code/events                                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Participant Registry (in-memory):                                          │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ joao  → { endpoint: "http://192.168.1.50:11434", model, lastSeen } │    │
│  │ maria → { endpoint: "http://192.168.1.51:1234", model, lastSeen }  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
           ▲                    ▲                         ▲
           │ HTTP               │ HTTP                    │ SSE
           │                    │                         │
      ┌────┴────┐    ┌─────────┴─────────┐         ┌─────┴─────┐
      │   SDK   │    │   Participants    │         │    TUI    │
      └─────────┘    └───────────────────┘         └───────────┘
```

## Design Philosophy

Gambi follows the principle of **feature parity across all endpoints**. Each entry point exposes the same core capabilities through an interface optimized for its target use case:

| Endpoint | Target Audience | Use Case |
|----------|-----------------|----------|
| **SDK** | Developers | Programmatic integration for JS/TS applications (Vercel AI SDK compatible) |
| **CLI** | DevOps / Power Users | Scripts, automation, and CI/CD pipelines |
| **TUI** | Human Operators | Interactive real-time monitoring and management |

### Architecture Pattern

Internally, Gambi follows a **Ports and Adapters** style. The public edge is `OpenResponses-first`, but the hub core does not hardcode that as its only internal shape.

- The hub defines protocol adapter ports for request creation and stored-response lifecycle operations.
- `openResponses` and `chatCompletions` are the first concrete adapters registered today.
- Adapter selection is ordered and explicit: the public `responses` edge tries the `openResponses` adapter first, then falls back to the `chatCompletions` adapter when required.
- The SDK follows the same pattern through a protocol namespace factory registry, with `openResponses` as the default public protocol.

This is intentionally close to the “generic interface + interpreter” style you see in systems like Effect: the core talks to capabilities, and concrete protocol behavior lives at the edge.

### Invocation Pattern

| Command | Result |
|---------|--------|
| `gambi` | Shows CLI help |
| `gambi-tui` | Opens **TUI** - Interactive monitoring and management interface |
| `gambi serve` | CLI - Starts hub server (scripting) |
| `gambi create` | CLI - Creates room (scripting) |
| `gambi join` | CLI - Joins as participant (scripting) |
| `gambi list` | CLI - Lists rooms (scripting) |
| `gambi update` | CLI - Updates the current install (bun, npm, or standalone) |

**Important:** The standalone CLI shows help when you run `gambi` with no subcommand. The TUI is a separate package: `bun add -g gambi-tui`.

### Feature Parity Matrix

| Feature | SDK | CLI | TUI |
|---------|-----|-----|-----|
| Create room | POST /rooms | `gambi create` | Create dialog |
| List rooms | GET /rooms | `gambi list` | Room selector |
| Join room | POST /rooms/:code/join | `gambi join` | Join dialog |
| Update installed CLI | - | `gambi update` | N/A |
| Leave room | DELETE /rooms/:code/leave/:id | Auto on exit | Leave action |
| Health check | POST /rooms/:code/health | Auto (background) | Auto (background) |
| Responses create | POST /rooms/:code/v1/responses | Via SDK | N/A (monitoring only) |
| Responses lifecycle | `/rooms/:code/v1/responses/:id*` | HTTP/API clients | N/A (monitoring only) |
| Chat completion (legacy) | POST /rooms/:code/v1/chat/completions | Via SDK or explicit legacy mode | N/A (monitoring only) |
| Real-time events | SSE subscription | - | Built-in |
| Serve hub | - | `gambi serve` | Embedded server |

### Runtime Defaults

- Rooms can define runtime defaults when created.
- Participants can register runtime defaults when they join.
- The hub merges defaults at proxy time with precedence `room defaults -> participant defaults -> runtime request`.
- Public room and participant endpoints expose only a redacted summary for sensitive fields such as instructions/system prompts.

Example:

- Room sets `instructions = "Answer in Portuguese"` and `temperature = 0.3`
- Participant joins with `temperature = 0.6`
- Client sends a request with `temperature = 0.9`
- Final proxied request uses:
  - `instructions = "Answer in Portuguese"`
  - `temperature = 0.9`

## Packages

The project is a Bun + Turbo monorepo with the following packages:

### `@gambi/core`

Core library containing the hub server and shared utilities.

**Key files:**
- `hub.ts` - HTTP server with protocol adapter registry, Responses-first proxy, and legacy chat/completions compatibility
- `protocol-adapters.ts` - Adapter contracts used by the hub core and SDK exports
- `room.ts` - Room and participant management
- `sse.ts` - Server-Sent Events for real-time updates
- `mdns.ts` - mDNS (Bonjour/Zeroconf) service discovery
- `types.ts` - Zod schemas and TypeScript types

### `gambi`

Command-line interface for managing hubs and participants.

**Commands:**
- `serve` - Start a hub server (with optional `--mdns` flag)
- `create` - Create a new room, optionally with runtime defaults from JSON
- `list` - List available rooms
- `join` - Join a room with your LLM endpoint and optional runtime defaults

### `gambi-sdk`

SDK for integrating with the Vercel AI SDK.

**Installation:**
```bash
npm install gambi-sdk
```

Available on npm: https://www.npmjs.com/package/gambi-sdk

```typescript
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({ roomCode: "ABC123" });

// Use any available participant
const result = await generateText({
  model: gambi.any(),
  prompt: "Hello!",
});

// Use a specific participant by ID
const result2 = await generateText({
  model: gambi.participant("participant-id"),
  prompt: "Hello!",
});

// Use a specific model type (routes to first participant with that model)
const result3 = await generateText({
  model: gambi.model("llama3"),
  prompt: "Hello!",
});

const legacy = createGambi({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});

const result4 = await generateText({
  model: legacy.any(),
  prompt: "Legacy chat/completions flow",
});
```

For local Node.js/Bun applications, the SDK also exposes optional discovery helpers:

- `discoverHubs()` - find reachable hubs from a configured seed plus mDNS
- `discoverRooms()` - aggregate rooms across reachable hubs
- `resolveGambiTarget()` - resolve one room to `{ hubUrl, roomCode }`

These helpers are available from the root export (`gambi-sdk`) or from the dedicated subpath `gambi-sdk/discovery` for a smaller import surface.

These helpers are additive. `createGambi()` and `createClient()` remain explicit and do not perform implicit async discovery.

### `gambi-tui`

Terminal UI for monitoring rooms and participants in real-time (uses SSE). Published as a separate npm package.

**Installation:** `bun add -g gambi-tui`
**Usage:** `gambi-tui --hub http://localhost:3000`

## Communication Flow

### 1. Participant Registration

```
Participant                Hub
    │                       │
    │  POST /rooms/:code/join
    │  { id, nickname, model, endpoint, specs, config? }
    │ ──────────────────────►
    │                       │
    │  201 Created          │
    │  { participant, roomId }
    │ ◄──────────────────────
    │                       │
    │  (every 10 seconds)   │
    │  POST /rooms/:code/health
    │  { id }               │
    │ ──────────────────────►
    │                       │
```

### 2. SDK Request Flow

```
SDK                        Hub                     Participant
 │                          │                           │
 │  POST /rooms/:code/v1/responses                     │
 │  { model: "participant-id", messages, stream }      │
 │ ────────────────────────►│                          │
 │                          │                          │
 │                          │  POST /v1/responses
 │                          │  { model: "llama3", input, stream }
 │                          │ ─────────────────────────►│
 │                          │                          │
 │                          │  SSE Stream / JSON       │
 │                          │ ◄─────────────────────────│
 │                          │                          │
 │  SSE Stream / JSON       │                          │
 │ ◄────────────────────────│                          │
```

## Model Routing

The SDK supports three ways to select a participant:

| Pattern | Example | Description |
|---------|---------|-------------|
| Participant ID | `gambi.participant("abc123")` | Routes to specific participant |
| Model name | `gambi.model("llama3")` | Routes to first online participant with that model |
| Any | `gambi.any()` or `model: "*"` | Routes to random online participant |

## Health Checking

- Participants send health checks every **10 seconds** (`HEALTH_CHECK_INTERVAL`)
- Participants are marked offline after **30 seconds** of no health check (`PARTICIPANT_TIMEOUT = 3 × HEALTH_CHECK_INTERVAL`)
- The hub broadcasts `participant:offline` events via SSE when a participant times out

## mDNS Discovery

When started with `--mdns`, the hub publishes itself via Bonjour/Zeroconf:

```bash
gambi serve --mdns
```

This allows clients on the local network to discover the hub automatically without knowing its IP address.

Service format: `gambi-hub-{port}._gambi._tcp.local`

The SDK builds on top of the same mechanism for local apps through `discoverHubs()`, `discoverRooms()`, and `resolveGambiTarget()`. This keeps the provider/client APIs explicit while still enabling zero-config room selection in TypeScript applications.

## Supported Providers

Any server with OpenResponses or OpenAI-compatible chat/completions:

| Provider | Default Endpoint |
|----------|-----------------|
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |
| LocalAI | `http://localhost:8080` |
| vLLM | `http://localhost:8000` |

## Data Types

### ParticipantInfo

```typescript
{
  id: string;
  nickname: string;
  model: string;
  endpoint: string;  // LLM API base URL
  config: RuntimeConfigPublic;
  specs: MachineSpecs;
  capabilities: {
    openResponses: "supported" | "unsupported" | "unknown";
    chatCompletions: "supported" | "unsupported" | "unknown";
  };
  status: "online" | "offline" | "busy";
  joinedAt: number;
  lastSeen: number;  // Timestamp of last health check
}
```

### RuntimeConfigPublic

Public room/participant defaults summary:

```typescript
{
  hasInstructions: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
}
```

## Previous Architecture

The original architecture used WebSocket for all communication. This was replaced with HTTP + SSE for:

1. **Simpler SDK integration** - Uses `@ai-sdk/open-responses` by default, with explicit legacy `@ai-sdk/openai-compatible` support
2. **Standard API** - Hub exposes OpenResponses as the primary public protocol and keeps chat/completions for compatibility
3. **Better debugging** - HTTP requests are easier to inspect and test
4. **Reduced complexity** - No need to manage WebSocket connections in the SDK

The old WebSocket-based plan is preserved in `docs/old/architecture-v1-websocket.md` for reference.
