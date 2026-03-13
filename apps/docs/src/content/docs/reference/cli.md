---
title: CLI Reference
description: Complete reference for Gambiarra CLI commands.
---

The Gambiarra CLI provides commands for managing hubs, rooms, and participants.

## Installation

```bash
npm install -g gambiarra
# or
bun add -g gambiarra
```

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
| `--host`, `-h` | Host to bind to | `0.0.0.0` |
| `--mdns`, `-m` | Enable mDNS auto-discovery | `false` |
| `--quiet`, `-q` | Suppress logo output | `false` |

**Example:**

```bash
gambiarra serve --port 3000 --mdns
```

### `create`

Create a new room on a hub.

```bash
gambiarra create --name "Room Name" [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name`, `-n` | Room name | Required |
| `--password`, `-p` | Password to protect the room | None |
| `--hub`, `-H` | Hub URL | `http://localhost:3000` |

**Examples:**

```bash
# Create a room
gambiarra create --name "My Room"

# Create on a custom hub
gambiarra create --name "My Room" --hub http://192.168.1.10:3000

# Create a password-protected room
gambiarra create --name "My Room" --password secret123
```

### `join`

Join a room and expose your LLM endpoint.

```bash
gambiarra join --code <room-code> --model <model> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--code`, `-c` | Room code to join | Required |
| `--model`, `-m` | Model to expose | Required |
| `--endpoint`, `-e` | LLM endpoint URL | `http://localhost:11434` |
| `--nickname`, `-n` | Display name | Auto-generated |
| `--password`, `-p` | Room password (if protected) | None |
| `--hub`, `-H` | Hub URL | `http://localhost:3000` |
| `--no-specs` | Don't share machine specs | `false` |

The CLI automatically probes your endpoint to detect available models and protocol capabilities (Responses API vs Chat Completions).

**Examples:**

```bash
# Join with Ollama
gambiarra join --code ABC123 --model llama3

# Join with LM Studio
gambiarra join --code ABC123 \
  --model mistral \
  --endpoint http://localhost:1234

# Join with custom nickname
gambiarra join --code ABC123 \
  --model llama3 \
  --nickname "alice-4090"

# Join a password-protected room
gambiarra join --code ABC123 \
  --model llama3 \
  --password secret123
```

### `list`

List available rooms on a hub.

```bash
gambiarra list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--hub`, `-H` | Hub URL | `http://localhost:3000` |
| `--json`, `-j` | Output as JSON | `false` |

**Example:**

```bash
gambiarra list
# Output:
# Available rooms:
#   ABC123  My Room
#     Participants: 3
#   XYZ789  Test Room
#     Participants: 1

gambiarra list --json
```

## Supported Providers

Gambiarra works with any endpoint that exposes OpenResponses or OpenAI-compatible `chat/completions`:

| Provider | Default Endpoint | Protocols |
|----------|------------------|-----------|
| Ollama | `http://localhost:11434` | Responses API, Chat Completions |
| LM Studio | `http://localhost:1234` | Responses API, Chat Completions |
| LocalAI | `http://localhost:8080` | Responses API, Chat Completions |
| vLLM | `http://localhost:8000` | Responses API, Chat Completions |

For cloud providers (OpenRouter, Together AI, Groq, etc.), see the [Remote Providers](/guides/remote-providers/) guide.
