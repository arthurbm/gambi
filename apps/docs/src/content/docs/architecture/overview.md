---
title: Architecture Overview
description: How Gambiarra works under the hood — design decisions and trade-offs
---

# Architecture Overview

Gambiarra uses an **HTTP + SSE architecture** with a central hub that routes requests between participants. This page explains *why* the system is designed the way it is.

## System Diagram

```
┌──────────────────────────────────────────────┐
│              GAMBIARRA HUB (HTTP)             │
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

Gambiarra originally used WebSocket but migrated to HTTP + SSE. The reasons:

1. **SDK simplicity** — the SDK uses standard `@ai-sdk/openai-compatible` and `@ai-sdk/open-responses` providers. These expect HTTP endpoints, not WebSocket. HTTP means the SDK is a thin wrapper, not a custom protocol implementation.
2. **Standard API** — the hub exposes an OpenAI-compatible API. Any tool that works with OpenAI works with Gambiarra by changing the base URL. This wouldn't be possible with WebSocket.
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

Gambiarra is designed for trusted local networks. Adding auth to every endpoint would slow down the getting-started experience for the primary use case (team in the same room/network). The trade-off:

- **Local network** — no auth needed. Room codes provide enough isolation.
- **Public deployment (Railway/tunnel)** — room passwords provide basic protection. Full auth (API keys, OAuth) is planned for the managed mode.

### Health Check Timings

- **10 second interval** — frequent enough to detect disconnects quickly, infrequent enough to not generate noticeable traffic with 30+ participants.
- **30 second timeout** — 3 missed health checks before marking offline. Tolerates brief network hiccups without false positives.

These values are defined in `packages/core/src/types.ts` and can be adjusted.

## What the Hub Doesn't Do

- **No agent harness** — the hub doesn't know or care if the participant is an Ollama instance, a coding agent, or a custom pipeline. It routes OpenAI-compatible requests. That's it.
- **No auth header forwarding** — the hub doesn't forward `Authorization` headers to participants. Cloud APIs that require auth need a [local proxy](/guides/remote-providers/).
- **No request transformation** — if a request comes in as Responses API and the participant only supports Chat Completions (or vice versa), the hub adapts the protocol automatically. But it doesn't modify the actual content.

## Model Routing

Three routing modes, controlled by the `model` field in requests:

| Pattern | Example | Behavior |
|---------|---------|----------|
| Any | `"*"` or `"any"` | Random online participant |
| Model name | `"model:llama3"` or `"llama3"` | First online participant with that model |
| Participant ID | `"abc123"` | Specific participant by ID |

See [API Reference](/reference/api/) for details on how routing works in HTTP requests.
