---
title: CLI Reference
description: Complete reference for Gambiarra CLI commands.
---

The Gambiarra CLI provides commands for managing hubs, rooms, and participants.

## Commands

### `serve`

Start a hub server.

```bash
gambiarra serve [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port`, `-p` | Port to listen on | `3000` |
| `--mdns` | Enable mDNS auto-discovery | `false` |

**Example:**

```bash
gambiarra serve --port 3000 --mdns
```

### `create`

Create a new room.

```bash
gambiarra create [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--hub` | Hub URL | Auto-discover or `http://localhost:3000` |

**Example:**

```bash
gambiarra create
# Output: Room created! Code: ABC123
```

### `join`

Join a room with your LLM endpoint.

```bash
gambiarra join <room-code> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--endpoint`, `-e` | LLM endpoint URL | Required |
| `--model`, `-m` | Model name | Required |
| `--nickname`, `-n` | Your nickname | Random |
| `--hub` | Hub URL | Auto-discover |

**Example:**

```bash
gambiarra join ABC123 \
  --endpoint http://localhost:11434 \
  --model llama3 \
  --nickname alice
```

### `list`

List available rooms.

```bash
gambiarra list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--hub` | Hub URL | Auto-discover |

**Example:**

```bash
gambiarra list
# Output:
# Available rooms:
#   - ABC123 (3 participants)
#   - XYZ789 (1 participant)
```

## Supported Providers

Gambiarra works with endpoints that expose OpenResponses or OpenAI-compatible `chat/completions`:

| Provider | Default Endpoint |
|----------|------------------|
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |
| LocalAI | `http://localhost:8080` |
| vLLM | `http://localhost:8000` |
