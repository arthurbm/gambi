---
title: Challenges & Dynamics
description: Ideas for group activities using Gambiarra — build projects, compete, and experiment with shared LLMs.
---

# Challenges & Dynamics

Gambiarra shines when multiple people connect their LLMs to the same room. This page collects ideas for group dynamics — whether you're running a meetup, a classroom activity, or just experimenting with friends.

## Getting Started

Every dynamic starts the same way: one person hosts the hub, everyone else joins with whatever LLM they have.

```bash
# Host
gambiarra serve --port 3000
gambiarra create --name "My Room"
# → Room code: ABC123

# Participants
gambiarra join --code ABC123 --model llama3
```

Once everyone is in, the room exposes a single API that routes to all connected LLMs. See the [API Reference](/reference/api/) for details, or grab the `llms.txt` and paste it into an AI coding tool to start building.

## Challenge Ideas

### The Chaos Test

Send `model: "*"` requests — the hub picks a random participant each time. Same prompt, different models, different answers. Compare quality, speed, and personality across the room.

```bash
curl -s http://<hub>/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"*","messages":[{"role":"user","content":"Explain gravity in one sentence"}]}'
```

Run it 10 times and see what comes back. Good way to feel the diversity of models in the room.

### Build Something with AI Tools

Grab the `llms.txt`, paste it into Lovable / Claude Code / Cursor, and ask it to build an app that uses the Gambiarra API as its LLM backend. Some ideas:

- **Chat interface** that lets you pick which model to talk to
- **Model arena** — same prompt to two models side by side, vote on the best
- **Real-time dashboard** using the SSE events stream to visualize traffic
- **Translation relay** — chain models: English → French → Japanese → back to English
- **Trivia bot** powered by the room's collective models

The point: you're not building an LLM — you're building an app that uses a room full of them.

### Guess the Model

One person sends a prompt to a random participant (`model: "*"`). Everyone sees the response. Guess which model generated it. Fun way to learn the personality differences between models.

### Benchmark Race

Everyone contributes a model. Run the same set of prompts through each one (using `model: "<participant-id>"`) and compare latency, output quality, and token throughput. Build a leaderboard.

### Collaborative Agent

More advanced: have multiple participants expose different capabilities (one is good at code, another at creative writing, another at translation). Build an app that routes different subtasks to different models based on what they're best at.

## Tips for Organizers

- **Show the TUI on a projector** — visualizes participants and events in real-time
- **Share the room code visibly** — projector, whiteboard, group chat
- **Mix local and remote providers** — diversity of models makes it more interesting
- **Point people to the `llms.txt`** — it's the fastest way for someone to start building with AI tools
- **Keep it scrappy** — the fun is in building something quick, not something perfect

## For Non-Technical Participants

No terminal needed. Any OpenAI-compatible chat UI works:

1. Open [Open WebUI](https://github.com/open-webui/open-webui), ChatBox, or any similar tool
2. Set the base URL to `http://<hub>/rooms/ABC123/v1`
3. Set API key to anything (not validated)
4. Start chatting — you're talking to the room's shared LLMs

Or just use curl:

```bash
curl http://<hub>/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"*","messages":[{"role":"user","content":"Tell me a joke"}]}'
```
