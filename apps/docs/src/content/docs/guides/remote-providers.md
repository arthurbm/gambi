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

## The Auth Header Limitation

The hub currently does **not** forward `Authorization` headers when proxying requests to participants. This means cloud APIs that require a Bearer token won't work as a direct endpoint.

**Workaround:** run a tiny local proxy that adds your API key.

### Local Auth Proxy

Create a file `proxy.ts`:

```typescript
const TARGET = "https://openrouter.ai/api"; // or any provider
const API_KEY = process.env.API_KEY!;

Bun.serve({
  port: 8787,
  fetch(req) {
    const url = new URL(req.url);
    return fetch(`${TARGET}${url.pathname}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: req.body,
    });
  },
});

console.log("Auth proxy running on http://localhost:8787");
```

Run it:

```bash
API_KEY="sk-..." bun proxy.ts
```

Then join using your local proxy as the endpoint:

```bash
gambiarra join --code ABC123 \
  --endpoint http://localhost:8787 \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter
```

The proxy runs on your machine, adds the auth header, and forwards to the cloud API. The hub sees it as a regular local endpoint.

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
- Other participants don't see your API key — it stays on your machine (in the proxy)

Choose a model you're comfortable paying for, or use free-tier models for experimentation.

## When to Use Which Protocol

- **Responses API** — newer, simpler input format (`"input": "text"`), supports multi-turn via `previous_response_id`. Use if your provider supports it.
- **Chat Completions** — widely supported, familiar `messages` array format. Works with virtually every provider.

The hub handles both transparently. When a request comes in via one protocol and the participant only supports the other, the hub adapts automatically.
