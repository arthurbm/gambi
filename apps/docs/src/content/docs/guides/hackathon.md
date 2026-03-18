---
title: Hackathon Setup
description: Get Gambiarra running in minutes for your hackathon team
---

# Hackathon Setup

Running an AI hackathon? Gambiarra lets your team share LLM resources without everyone needing beefy hardware. Here's how to get started in under 5 minutes.

## The Scenario

Your hackathon team has:
- **Alice**: Gaming laptop with RTX 4090, running Ollama with llama3
- **Bob**: MacBook Pro, no GPU
- **Carol**: Linux desktop with decent CPU, running Mistral via LM Studio

With Gambiarra, Bob can use Alice's llama3 or Carol's Mistral from his MacBook - no setup required on his end.

## Quick Setup (5 Minutes)

### Step 1: Pick a Hub Host

Choose one machine to run the hub. This can be any machine on the network - it doesn't need a GPU since it just routes traffic.

```bash
# On the hub machine (e.g., Bob's MacBook)
gambiarra serve --port 3000 --mdns
```

The `--mdns` flag enables auto-discovery, so teammates don't need to know the IP address.

### Step 2: Create a Room

```bash
gambiarra create --name "Hackathon"
# Output: Room created! Code: XK7P2M
```

Share this code with your team (Slack, Discord, sticky note - whatever works).

### Step 3: Join with Your LLMs

Each person with an LLM endpoint joins the room:

```bash
# Alice (Ollama)
gambiarra join --code XK7P2M \
  --endpoint http://localhost:11434 \
  --model llama3 \
  --nickname alice

# Carol (LM Studio)
gambiarra join --code XK7P2M \
  --endpoint http://localhost:1234 \
  --model mistral \
  --nickname carol
```

If the hub is running on a different machine, Gambiarra will automatically rewrite `localhost` endpoints to a LAN-reachable URL before publishing them to the hub. If your setup needs a custom published URL, pass `--network-endpoint`.

### Step 4: Use from Your App

Now everyone can use the shared LLMs:

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({
  roomCode: "XK7P2M",
  // Hub auto-discovered via mDNS, or specify:
  // hubUrl: "http://192.168.1.100:3000"
});

// Use any available model
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Generate a hackathon project idea",
});
```

To use Chat Completions instead of the default Responses API:

```typescript
const gambiarra = createGambiarra({
  roomCode: "XK7P2M",
  defaultProtocol: "chatCompletions",
});
```

Or skip the SDK entirely and use the API directly:

```bash
curl -X POST http://192.168.1.100:3000/rooms/XK7P2M/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "*", "messages": [{"role": "user", "content": "Hello!"}]}'
```

See the [API Reference](/reference/api/) for all endpoints.

## Tips for Hackathons

### Use Nicknames

Give meaningful nicknames so you know who's who:

```bash
gambiarra join --code XK7P2M --nickname "alice-4090" --model llama3
```

### Target Specific Models

If you need a specific model for a task:

```typescript
// For code generation, use the faster model
const code = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "Write a function to...",
});

// For creative tasks, use the other model
const story = await generateText({
  model: gambiarra.model("mistral"),
  prompt: "Write a story about...",
});
```

### Monitor with TUI

Keep a terminal open with the TUI to see who's online and request activity:

```bash
cd apps/tui
bun run dev XK7P2M
```

### Handle Disconnections

Laptops close, WiFi drops. Gambiarra handles this gracefully:
- Participants auto-reconnect when they come back
- Requests automatically route to available participants
- Use `gambiarra.any()` for resilience

### Share the Hub Load

The hub is lightweight, but if one machine is struggling:
- Anyone can run the hub (it doesn't need GPU)
- The person with the most stable connection/power is a good choice
- Avoid running hub on the same machine as a heavy LLM

## Troubleshooting

### "No participants online"

1. Check if participants joined: `gambiarra list`
2. Verify the room code is correct
3. Make sure LLM endpoints are running (`curl http://localhost:11434/v1/models`)

### mDNS Not Working

Some networks block mDNS. Fall back to explicit IP:

```typescript
const gambiarra = createGambiarra({
  roomCode: "XK7P2M",
  hubUrl: "http://192.168.1.100:3000", // Hub machine's IP
});
```

### Slow Responses

- LLMs are the bottleneck, not Gambiarra
- Consider which model to use for which task
- The person with the GPU should handle compute-heavy requests

## Example: Hackathon Starter

```typescript
// lib/ai.ts
import { createGambiarra } from "gambiarra-sdk";

export const gambiarra = createGambiarra({
  roomCode: process.env.GAMBIARRA_ROOM!,
  hubUrl: process.env.GAMBIARRA_HUB,
});
```

Use it anywhere in your app:

```typescript
import { gambiarra } from "./lib/ai";
import { generateText } from "ai";

const { text } = await generateText({
  model: gambiarra.any(),
  prompt: "Generate a hackathon project idea",
});
```

See the [SDK Reference](/reference/sdk/) for all routing methods and options.

## What's Next?

- Check the [SDK Reference](/reference/sdk/) for all available methods
- See [Architecture](/architecture/overview/) to understand how it works
- Read [Troubleshooting](/troubleshooting/common-issues/) if you hit issues

Good luck with your hackathon! 🚀
