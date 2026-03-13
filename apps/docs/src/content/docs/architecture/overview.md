---
title: Architecture Overview
description: How Gambiarra works under the hood
---

# Architecture Overview

Gambiarra uses a **HTTP + SSE architecture** for simplicity and compatibility with any client.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    GAMBIARRA HUB (HTTP)                     │
│                                                             │
│  Endpoints:                                                 │
│  • POST   /rooms                    (Create room)          │
│  • GET    /rooms                    (List rooms)           │
│  • POST   /rooms/:code/join         (Join room)            │
│  • POST   /rooms/:code/v1/responses (Primary Proxy)       │
│  • GET    /rooms/:code/v1/responses/:id                   │
│  • DELETE /rooms/:code/v1/responses/:id                   │
│  • POST   /rooms/:code/v1/responses/:id/cancel            │
│  • GET    /rooms/:code/v1/responses/:id/input_items       │
│  • POST   /rooms/:code/v1/chat/completions (Legacy Proxy) │
│  • GET    /rooms/:code/events       (SSE updates)          │
└─────────────────────────────────────────────────────────────┘
       ▲                    ▲                      ▲
       │ HTTP               │ HTTP                 │ SSE
       │                    │                      │
  ┌────┴────┐    ┌─────────┴────────┐      ┌──────┴─────┐
  │   SDK   │    │  Participants    │      │    TUI     │
  └─────────┘    └──────────────────┘      └────────────┘
```

## Key Components

### Hub

The central HTTP server that:
- Manages rooms and participants
- Routes requests to the appropriate participant
- Broadcasts events via SSE

### Room

A virtual space where participants register their LLM endpoints. Each room has:
- A unique 6-character code
- A list of registered participants
- Optional password protection

### Participant

An LLM endpoint registered in a room:
- Ollama, LM Studio, LocalAI, vLLM, or any endpoint exposing OpenResponses or chat/completions
- Sends health checks every 10 seconds
- Marked offline after 30 seconds of no response

### SDK

A Vercel AI SDK provider that:
- Connects to the hub
- Routes requests based on participant ID, model name, or random selection
- Uses `OpenResponses` by default, with explicit legacy `chat/completions` mode
- Supports streaming and non-streaming responses

## Communication Flow

### 1. Participant Registration

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

### 2. SDK Request Flow

```
SDK                        Hub                     Participant
 │                          │                           │
 │  POST /rooms/:code/v1/responses                     │
 │ ────────────────────────►│                          │
 │                          │                          │
 │                          │  POST /v1/responses
 │                          │ ─────────────────────────►│
 │                          │                          │
 │                          │  Response / Stream       │
 │                          │ ◄─────────────────────────│
 │                          │                          │
 │  Response / Stream       │                          │
 │ ◄────────────────────────│                          │
```

## Why HTTP + SSE?

We chose HTTP + SSE over WebSocket for:

1. **Simpler SDK integration** - Uses standard `@ai-sdk/open-responses` by default, with explicit legacy `@ai-sdk/openai-compatible` support
2. **Standard API** - Hub exposes `Responses API` as the primary public edge and keeps `chat/completions` for compatibility
3. **Better debugging** - HTTP requests are easier to inspect and test
4. **Reduced complexity** - No need to manage WebSocket connections in the SDK

## Model Routing

The SDK supports three ways to select a participant:

| Pattern | Example | Description |
|---------|---------|-------------|
| **Participant ID** | `gambiarra.participant("joao")` | Routes to specific participant |
| **Model name** | `gambiarra.model("llama3")` | Routes to first online participant with that model |
| **Any** | `gambiarra.any()` | Routes to random online participant |
