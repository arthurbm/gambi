---
title: Architecture Overview
description: How Gambi works under the hood — design decisions and trade-offs
---

# Architecture Overview

Gambi uses an **HTTP + SSE architecture** with a central hub that routes requests between participants. This page explains *why* the system is designed the way it is.

## System Diagram

```
┌──────────────────────────────────────────────┐
│              GAMBI HUB (HTTP)             │
│                                              │
│  Rooms ─── Participants ─── Health Checks    │
│    │             │                │           │
│    │        Routing Engine        │           │
│    │     (ID / model / random)    │           │
│    │             │                │           │
│  OpenAI-compatible API    SSE Event Stream   │
└──────────────────────────────────────────────┘
       ▲                    ▲              ▲
       │ HTTP               │ HTTP         │ SSE
       │                    │              │
  ┌────┴────┐    ┌─────────┴────────┐  ┌──┴───┐
  │   SDK   │    │  Participants    │  │ TUI  │
  │   API   │    │  (Ollama, LM     │  │      │
  │  clients│    │   Studio, etc.)  │  │      │
  └─────────┘    └──────────────────┘  └──────┘
```

## Key Components

### Hub

The central HTTP server. Manages rooms, tracks participants via health checks, routes LLM requests, and broadcasts events via SSE. See [API Reference](/reference/api/) for all endpoints.

### Room

A virtual space where participants register their LLM endpoints. Each room has a unique 6-character code and an optional password. Rooms are the unit of sharing — everyone in a room can use everyone else's LLMs.

### Participant

An LLM endpoint registered in a room. Can be local (Ollama, LM Studio, vLLM) or remote (via [auth proxy](/guides/remote-providers/)). Sends health checks every 10 seconds. Marked offline after 30 seconds without a heartbeat.

### SDK

A [Vercel AI SDK](https://sdk.vercel.ai/) provider that connects to the hub. See [SDK Reference](/reference/sdk/).

## Communication Flow

### Participant Registration

```
Participant                Hub
    │                       │
    │  POST /rooms/:code/join
    │  { id, nickname, model, endpoint }
    │ ──────────────────────►
    │                       │
    │  201 Created          │
    │ ◄──────────────────────
    │                       │
    │  (every 10 seconds)   │
    │  POST /rooms/:code/health
    │ ──────────────────────►
```

### Request Flow

```
Client                     Hub                     Participant
 │                          │                           │
 │  POST /rooms/:code/v1/chat/completions               │
 │ ────────────────────────►│                           │
 │                          │  (resolve model routing)  │
 │                          │  POST /v1/chat/completions│
 │                          │ ─────────────────────────►│
 │                          │                           │
 │                          │  Response / Stream        │
 │                          │ ◄─────────────────────────│
 │  Response / Stream       │                           │
 │ ◄────────────────────────│                           │
```

## Design Decisions

### Why HTTP + SSE (not WebSocket)?

Gambi originally used WebSocket but migrated to HTTP + SSE. The reasons:

1. **SDK simplicity** — the SDK uses standard `@ai-sdk/openai-compatible` and `@ai-sdk/open-responses` providers. These expect HTTP endpoints, not WebSocket. HTTP means the SDK is a thin wrapper, not a custom protocol implementation.
2. **Standard API** — the hub exposes an OpenAI-compatible API. Any tool that works with OpenAI works with Gambi by changing the base URL. This wouldn't be possible with WebSocket.
3. **Debugging** — HTTP requests are inspectable with curl, browser devtools, or any HTTP client. WebSocket traffic is opaque.
4. **SSE for events only** — real-time monitoring (participant joins, request activity) uses SSE. This is one-way (hub → client), which is all that's needed. The TUI consumes this stream.

### Why Rooms?

Rooms solve the multi-tenancy problem without authentication. A room code is a lightweight access token — if you know the code, you're in. This is appropriate for trusted local networks where the goal is easy sharing, not security isolation.

Password-protected rooms add a layer for cases where the code might leak (e.g., shared on a projector).

### Why In-Memory (not persistent)?

The hub stores everything in memory. Participants, rooms, and routing state are lost on restart. This is intentional:

- **Simplicity** — no database to set up or manage
- **Local-first** — the hub is designed to run on someone's laptop during an event or in a home lab. Persistence adds complexity with no benefit for ephemeral sessions.
- **Future** — the managed mode (gambi.app) will add Postgres persistence for long-lived rooms. The in-memory model stays as the default for self-hosted.

### Why No Authentication?

Gambi is designed for trusted local networks. Adding auth to every endpoint would slow down the getting-started experience for the primary use case (team in the same room/network). The trade-off:

- **Local network** — no auth needed. Room codes provide enough isolation.
- **Public deployment (Railway/tunnel)** — room passwords provide basic protection. Full auth (API keys, OAuth) is planned for the managed mode.

### Health Check Timings

- **10 second interval** — frequent enough to detect disconnects quickly, infrequent enough to not generate noticeable traffic with 30+ participants.
- **30 second timeout** — 3 missed health checks before marking offline. Tolerates brief network hiccups without false positives.

These values are defined in `packages/core/src/types.ts` and can be adjusted.

## Protocol Adapter Fallback

The hub uses a protocol adapter system to handle the gap between Responses API and Chat Completions:

```
Request arrives (POST /rooms/:code/v1/responses)
    │
    ├─ Try openResponsesAdapter
    │   └─ Forward to participant's /v1/responses
    │      ├─ Success → stream response back
    │      └─ 404/405/501 → SKIP, try next adapter
    │
    └─ Try chatCompletionsFallbackAdapter
        └─ Convert request to chat/completions format
           └─ Forward to participant's /v1/chat/completions
              └─ Convert response back to Responses format
```

This means a client can always use the Responses API endpoint, even if the participant only supports Chat Completions. The hub converts transparently. The reverse also works — Chat Completions requests are forwarded directly.

The conversion handles: message format mapping, tool calls, streaming events, and usage statistics. Some Responses API features (`previous_response_id`, `store`, `background`) are not available through the fallback — the hub returns a clear error listing unsupported fields.

## What the Hub Doesn't Do

- **No agent harness** — the hub doesn't know or care if the participant is an Ollama instance, a coding agent, or a custom pipeline. It routes OpenAI-compatible requests. That's it.
- **No secret exposure in public APIs** — participant auth headers can be registered privately for remote providers, but they stay in hub memory only and are never returned by participant listing endpoints.
- **No request transformation** — if a request comes in as Responses API and the participant only supports Chat Completions (or vice versa), the hub adapts the protocol automatically. But it doesn't modify the actual content.

## Model Routing

Three routing modes, controlled by the `model` field in requests:

| Pattern | Example | Behavior |
|---------|---------|----------|
| Any | `"*"` or `"any"` | Random online participant |
| Model name | `"model:llama3"` or `"llama3"` | First online participant with that model |
| Participant ID | `"abc123"` | Specific participant by ID |

See [API Reference](/reference/api/) for details on how routing works in HTTP requests.
