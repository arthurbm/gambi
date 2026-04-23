---
title: Remote Providers
description: Use cloud LLM providers such as OpenRouter, Together AI, Groq, Fireworks, or OpenAI as participants in a Gambi room.
---

You do not need a local GPU to participate. Any OpenAI-compatible cloud API can be used as your LLM endpoint.

## How It Works

When you join a room with a remote provider, the participant runtime:

1. probes the provider endpoint locally
2. registers itself with the hub
3. opens a tunnel back to the hub
4. forwards tunnel requests to the provider endpoint using local auth headers

This means the hub does not need your provider credentials as part of public participant state, and your provider endpoint does not need to be exposed to the rest of the network.

Supported protocols:

| Protocol | Endpoint | Best For |
| --- | --- | --- |
| Responses API | `/v1/responses` | preferred default when the provider supports it |
| Chat Completions | `/v1/chat/completions` | compatibility for providers and tools that still require it |

## Join With CLI

For automation, prefer `--header-env` so secrets do not end up in shell history.

```bash
export OPENROUTER_AUTH="Bearer sk-or-..."

gambi participant join --room ABC123 \
  --participant-id my-openrouter \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH
```

You can also send extra provider-specific headers:

```bash
gambi participant join --room ABC123 \
  --participant-id my-openrouter \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH \
  --header "HTTP-Referer=https://my-app.example"
```

## Join Through The SDK

If you are building your own participant runtime, use `createParticipantSession()`:

```ts
import { createParticipantSession } from "gambi-sdk";

await createParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "my-openrouter",
  nickname: "my-openrouter",
  endpoint: "https://openrouter.ai/api",
  model: "meta-llama/llama-3.1-8b-instruct:free",
  authHeaders: {
    Authorization: `Bearer ${process.env.OPENROUTER_TOKEN}`,
  },
});
```

`authHeaders` stay local to the participant runtime. They are applied only when that runtime talks to the provider endpoint.

## Popular Providers

| Provider | Base URL | Free Models? |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api` | yes |
| Together AI | `https://api.together.xyz` | free tier |
| Groq | `https://api.groq.com/openai` | free tier |
| Fireworks | `https://api.fireworks.ai/inference` | free tier |
| OpenAI | `https://api.openai.com` | no |

## Cost Considerations

When you join with a cloud provider:

- your API key is used for every request routed to you
- you pay for the tokens consumed
- other participants do not see your provider credentials

Choose a model you are comfortable paying for, or use free-tier models for experimentation.

## Security Notes

- Provider auth headers should remain on the participant runtime.
- The tunnel-first model avoids publishing the provider endpoint or its credentials to the rest of the network just to participate.
- If your hub is reachable outside your LAN, put it behind HTTPS or a reverse proxy and apply proper access control before using cloud provider credentials with it.

## When To Use Which Protocol

- Responses API: preferred default
- Chat Completions: compatibility path

The hub can adapt between the two protocols when needed, but new integrations should prefer Responses.
