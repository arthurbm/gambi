# Gambiarra - Architecture

This document describes the current architecture of Gambiarra, a system for sharing local LLMs across a network.

## Overview

Gambiarra enables multiple users on a local network to share their LLM endpoints (Ollama, LM Studio, LocalAI, vLLM, or any OpenAI-compatible API) through a central hub. The system is designed to work seamlessly with the Vercel AI SDK.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GAMBIARRA HUB (HTTP)                              │
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
│  │ OpenAI-Compatible (Proxy):                                         │    │
│  │ POST   /rooms/:code/v1/chat/completions                           │    │
│  │ GET    /rooms/:code/v1/models                                     │    │
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

Gambiarra follows the principle of **feature parity across all endpoints**. Each entry point exposes the same core capabilities through an interface optimized for its target use case:

| Endpoint | Target Audience | Use Case |
|----------|-----------------|----------|
| **SDK** | Developers | Programmatic integration for JS/TS applications (Vercel AI SDK compatible) |
| **CLI** | DevOps / Power Users | Scripts, automation, and CI/CD pipelines |
| **TUI** | Human Operators | Interactive real-time monitoring and management |

### Invocation Pattern

| Command | Result |
|---------|--------|
| `gambiarra` | Opens **TUI** - Interactive interface with all features |
| `gambiarra serve` | CLI - Starts hub server (scripting) |
| `gambiarra create` | CLI - Creates room (scripting) |
| `gambiarra join` | CLI - Joins as participant (scripting) |
| `gambiarra list` | CLI - Lists rooms (scripting) |

**Important:** Running `gambiarra` without a subcommand opens the TUI. Subcommands are designed for scripting and automation.

### Feature Parity Matrix

| Feature | SDK | CLI | TUI |
|---------|-----|-----|-----|
| Create room | POST /rooms | `gambiarra create` | Create dialog |
| List rooms | GET /rooms | `gambiarra list` | Room selector |
| Join room | POST /rooms/:code/join | `gambiarra join` | Join dialog |
| Leave room | DELETE /rooms/:code/leave/:id | Auto on exit | Leave action |
| Health check | POST /rooms/:code/health | Auto (background) | Auto (background) |
| Chat completion | POST /rooms/:code/v1/chat/completions | Via SDK | N/A (monitoring only) |
| Real-time events | SSE subscription | - | Built-in |
| Serve hub | - | `gambiarra serve` | Embedded server |

## Packages

The project is a Bun + Turbo monorepo with the following packages:

### `@gambiarra/core`

Core library containing the hub server and shared utilities.

**Key files:**
- `hub.ts` - HTTP server with OpenAI-compatible proxy
- `room.ts` - Room and participant management
- `sse.ts` - Server-Sent Events for real-time updates
- `mdns.ts` - mDNS (Bonjour/Zeroconf) service discovery
- `types.ts` - Zod schemas and TypeScript types

### `@gambiarra/cli`

Command-line interface for managing hubs and participants.

**Commands:**
- `serve` - Start a hub server (with optional `--mdns` flag)
- `create` - Create a new room
- `list` - List available rooms
- `join` - Join a room with your LLM endpoint

### `gambiarra`

SDK for integrating with the Vercel AI SDK.

**Installation:**
```bash
npm install gambiarra
```

Available on npm: https://www.npmjs.com/package/gambiarra

```typescript
import { createGambiarra } from "gambiarra";
import { generateText } from "ai";

const gambiarra = createGambiarra({ roomCode: "ABC123" });

// Use any available participant
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Hello!",
});

// Use a specific participant by ID
const result2 = await generateText({
  model: gambiarra.participant("participant-id"),
  prompt: "Hello!",
});

// Use a specific model type (routes to first participant with that model)
const result3 = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "Hello!",
});
```

### `tui`

Terminal UI for monitoring rooms and participants in real-time (uses SSE).

## Communication Flow

### 1. Participant Registration

```
Participant                Hub
    │                       │
    │  POST /rooms/:code/join
    │  { id, nickname, model, endpoint, specs }
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
 │  POST /rooms/:code/v1/chat/completions              │
 │  { model: "participant-id", messages, stream }      │
 │ ────────────────────────►│                          │
 │                          │                          │
 │                          │  POST /v1/chat/completions
 │                          │  { model: "llama3", messages }
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
| Participant ID | `gambiarra.participant("abc123")` | Routes to specific participant |
| Model name | `gambiarra.model("llama3")` | Routes to first online participant with that model |
| Any | `gambiarra.any()` or `model: "*"` | Routes to random online participant |

## Health Checking

- Participants send health checks every **10 seconds** (`HEALTH_CHECK_INTERVAL`)
- Participants are marked offline after **30 seconds** of no health check (`PARTICIPANT_TIMEOUT = 3 × HEALTH_CHECK_INTERVAL`)
- The hub broadcasts `participant:offline` events via SSE when a participant times out

## mDNS Discovery

When started with `--mdns`, the hub publishes itself via Bonjour/Zeroconf:

```bash
gambiarra serve --mdns
```

This allows clients on the local network to discover the hub automatically without knowing its IP address.

Service format: `gambiarra-hub-{port}._gambiarra._tcp.local`

## Supported Providers

Any server with an OpenAI-compatible API:

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
  endpoint: string;  // OpenAI-compatible API URL
  config: GenerationConfig;
  specs: MachineSpecs;
  status: "online" | "offline" | "busy";
  joinedAt: number;
  lastSeen: number;  // Timestamp of last health check
}
```

### GenerationConfig

Standard OpenAI-compatible parameters:

```typescript
{
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

1. **Simpler SDK integration** - Uses `@ai-sdk/openai-compatible` instead of custom LanguageModelV3
2. **Standard API** - Hub exposes OpenAI-compatible endpoints that work with any client
3. **Better debugging** - HTTP requests are easier to inspect and test
4. **Reduced complexity** - No need to manage WebSocket connections in the SDK

The old WebSocket-based plan is preserved in `docs/architecture-v1-websocket.md` for reference.
