---
title: Remote Providers
description: Use cloud LLM providers (OpenRouter, Together AI, Groq, etc.) as participants in a Gambiarra room.
---

You don't need a local GPU to participate. Any OpenAI-compatible cloud API can be used as your LLM endpoint — OpenRouter, Together AI, Groq, Fireworks, or even the OpenAI API itself.

## How It Works

When you join a room with a remote provider, the hub forwards requests from other participants through your cloud endpoint. Two protocols are supported:

| Protocol | Endpoint | Best For |
|----------|----------|----------|
| **Responses API** | `/v1/responses` | OpenAI, providers that support the Responses API |
| **Chat Completions** | `/v1/chat/completions` | Most providers (Ollama, LM Studio, OpenRouter, etc.) |

The hub auto-detects which protocol(s) your endpoint supports when you join.

## Join With CLI

For automation, prefer `--header-env` so secrets don't end up in shell history.

```bash
export OPENROUTER_AUTH="Bearer sk-or-..."

gambiarra join --code ABC123 \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH
```

You can also send extra provider-specific headers:

```bash
gambiarra join --code ABC123 \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH \
  --header "HTTP-Referer=https://my-app.example"
```

If you prefer interactive mode, `gambiarra join` now prompts for auth headers after you choose the endpoint. Header values are collected via hidden prompts.

## Join With TUI

The TUI keeps remote auth secure by referencing environment variables instead of storing raw secret values in the UI state.

1. Export the header value you want to use:

```bash
export OPENAI_AUTH="Bearer sk-..."
```

2. Open the TUI join flow.
3. Expand **Advanced options**.
4. Add an auth header entry such as:
   - Header name: `Authorization`
   - Env var: `OPENAI_AUTH`

The TUI resolves the environment variable locally before probing models and joining the room. The raw secret is never persisted to Gambiarra config files.

## Join Through The API Or SDK

`POST /rooms/:code/join` now accepts an optional `authHeaders` object. Those headers are stored only in hub memory and are used for:

- endpoint probing (`/v1/models`, `/v1/responses`, `/v1/chat/completions`)
- proxied inference requests
- Responses lifecycle routes

They are **not** returned by `GET /rooms/:code/participants`, `GET /rooms/:code/v1/models`, or join responses.

## Popular Providers

| Provider | Base URL | Free Models? |
|----------|----------|-------------|
| OpenRouter | `https://openrouter.ai/api` | Yes (`:free` suffix) |
| Together AI | `https://api.together.xyz` | Free tier |
| Groq | `https://api.groq.com/openai` | Free tier |
| Fireworks | `https://api.fireworks.ai/inference` | Free tier |
| OpenAI | `https://api.openai.com` | No |

## Cost Considerations

When you join with a cloud provider:
- **Your API key** is used for every request routed to you
- **You pay** for the tokens consumed
- Other participants don't see your API key — the hub keeps headers only in memory and does not expose them in participant listings

Choose a model you're comfortable paying for, or use free-tier models for experimentation.

## Security Notes

- Gambiarra sends `authHeaders` from the joining client to the hub, then stores them in memory for as long as that participant is registered.
- In trusted local networks, that's usually enough.
- If your hub is reachable outside your LAN, put it behind HTTPS or a reverse proxy before sending provider credentials through it.

## When to Use Which Protocol

- **Responses API** — newer, simpler input format (`"input": "text"`), supports multi-turn via `previous_response_id`. Use if your provider supports it.
- **Chat Completions** — widely supported, familiar `messages` array format. Works with virtually every provider.

The hub handles both transparently. When a request comes in via one protocol and the participant only supports the other, the hub adapts automatically.
