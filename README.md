```
 ██████╗  █████╗ ███╗   ███╗██████╗ ██╗ █████╗ ██████╗ ██████╗  █████╗
██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║██╔══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗███████║██╔████╔██║██████╔╝██║███████║██████╔╝██████╔╝███████║
██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║██╔══██║██╔══██╗██╔══██╗██╔══██║
╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║██║  ██║██║  ██║██║  ██║██║  ██║
 ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
                          LLM CLUB
```

<div align="center">

**Share local LLMs across your network, effortlessly.**

[![npm version](https://img.shields.io/npm/v/gambiarra-sdk)](https://www.npmjs.com/package/gambiarra-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.5-black?logo=bun&logoColor=white)](https://bun.sh)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-ef4444?logo=turborepo&logoColor=white)](https://turbo.build/repo)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-Compatible-000000?logo=vercel&logoColor=white)](https://sdk.vercel.ai)

</div>

---

## Table of Contents

- [What is Gambiarra?](#-what-is-gambiarra)
- [Installation](#-installation)
  - [CLI](#cli)
  - [SDK](#sdk)
- [Quick Start](#-quick-start)
- [Features](#-features)
- [Usage Examples](#-usage-examples)
- [Architecture](#-architecture)
- [Development](#-development)
- [Supported Providers](#-supported-providers)
- [Security](#-security-considerations)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## What is Gambiarra?

**Gambiarra** is a local-first LLM sharing system that allows multiple users on a network to pool their LLM resources together. Think of it as a "LLM Club" where everyone shares their Ollama, LM Studio, LocalAI, or any endpoint that speaks OpenResponses or OpenAI-compatible chat/completions.

### Why Gambiarra?

- **Local-First**: Your data stays on your network
- **Resource Sharing**: Pool LLM endpoints across your team
- **OpenResponses First**: Prefers `v1/responses` by default and falls back to `chat/completions` when needed
- **Universal Compatibility**: Works with OpenResponses and OpenAI-compatible chat/completions APIs
- **Vercel AI SDK Integration**: Drop-in replacement for your AI SDK workflows
- **Auto-Discovery**: mDNS/Bonjour support for zero-config networking
- **Real-time Monitoring**: Beautiful TUI for tracking room activity
- **Production Ready**: Built with TypeScript, Bun, and modern tooling

### Use Cases

- **Development Teams**: Share expensive LLM endpoints across your team
- **Hackathons**: Pool resources for AI projects
- **Research Labs**: Coordinate LLM access across multiple workstations
- **Home Labs**: Share your gaming PC's LLM with your laptop
- **Education**: Classroom environments where students share compute

---

## Installation

### CLI

The CLI allows you to start hubs, create rooms, and join as a participant.

**Linux / macOS (recommended - standalone binary):**

```bash
curl -fsSL https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/install.ps1 | iex
```

**Via npm (any platform):**

```bash
npm install -g gambiarra
```

**Via bun (any platform):**

```bash
bun add -g gambiarra
```

**Verify installation:**

```bash
gambiarra --version
```

**Uninstall:**

```bash
# Linux / macOS (standalone binary)
curl -fsSL https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/uninstall.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/uninstall.ps1 | iex
```

```bash
# If installed via npm
npm uninstall -g gambiarra

# If installed via bun
bun remove -g gambiarra
```

### SDK

The SDK provides Vercel AI SDK integration for using shared LLMs in your applications.

**Via npm:**

```bash
npm install gambiarra-sdk
```

**Via bun:**

```bash
bun add gambiarra-sdk
```

**Uninstall:**

```bash
# If installed via npm
npm uninstall gambiarra-sdk

# If installed via bun
bun remove gambiarra-sdk
```

---

## Quick Start

### 1. Start the Hub Server

```bash
gambiarra serve
# Or with flags: gambiarra serve --port 3000 --mdns
```

### 2. Create a Room

```bash
gambiarra create
# Or with flags: gambiarra create --name "My Room" --config ./room-defaults.json
```

### 3. Join with Your LLM

```bash
gambiarra join
# Or with flags: gambiarra join --code ABC123 --model llama3 --config ./participant-config.json
```

All commands support **interactive mode** — run without flags and you'll be guided through each option step by step. Flags still work for scripting and automation.

Example config JSON:

```json
{
  "instructions": "Always answer in Brazilian Portuguese.",
  "temperature": 0.4,
  "max_tokens": 512
}
```

### 4. Use the SDK

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});

const result = await generateText({
  model: gambiarra.any(),
  prompt: "Hello, Gambiarra!",
});

console.log(result.text);
```

---

## Features

### CLI Interface

```bash
# All commands support interactive mode — just run the command:
gambiarra serve
gambiarra create
gambiarra join
gambiarra list

# Or use flags for scripting:
gambiarra serve --mdns
gambiarra create --name "My Room" --config ./room-defaults.json
gambiarra join --code ABC123 --model llama3 --config ./participant-config.json
gambiarra list --json
```

Room defaults are merged at request time with precedence `room defaults -> participant defaults -> runtime request`. Public room/participant listings expose only a safe summary such as `hasInstructions`, not the raw instructions text.

### Runtime Defaults

Use runtime defaults when you want a room or participant to contribute reusable behavior without forcing every client request to repeat the same settings.

Example room defaults:

```json
{
  "instructions": "Answer in Brazilian Portuguese.",
  "temperature": 0.3,
  "max_tokens": 512
}
```

Create a room with defaults:

```bash
gambiarra create --name "Portuguese Room" --config ./room-defaults.json
```

Example participant defaults:

```json
{
  "instructions": "Prefer concise technical answers.",
  "temperature": 0.6
}
```

Join with participant defaults:

```bash
gambiarra join --code ABC123 --model llama3 --config ./participant-config.json
```

Merge behavior:

- Room defaults apply first.
- Participant defaults override room defaults.
- The request sent by the client overrides both.

Public API behavior:

- Sensitive instruction text is stored by the hub but not exposed in public room or participant listings.
- Public responses expose summary fields such as `hasInstructions` instead.

### SDK Integration

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({ roomCode: "ABC123" });

// Use any available participant
const result = await generateText({
  model: gambiarra.any(),
  prompt: "Explain quantum computing",
});

// Target specific participant
const result2 = await generateText({
  model: gambiarra.participant("joao"),
  prompt: "Write a haiku about TypeScript",
});

// Route by model type
const result3 = await generateText({
  model: gambiarra.model("llama3"),
  prompt: "What is the meaning of life?",
});

// Use Chat Completions instead of the default Responses API
const legacy = createGambiarra({
  roomCode: "ABC123",
  defaultProtocol: "chatCompletions",
});

const result4 = await generateText({
  model: legacy.any(),
  prompt: "Hello from chat/completions",
});
```

### Terminal UI

Monitor rooms in real-time with a beautiful TUI:

```bash
cd apps/tui
bun run dev ABC123
```

---

## Usage Examples

### CLI Commands

#### Start a Hub

```bash
# Interactive — prompts for port, host, mDNS:
gambiarra serve

# Or with flags:
gambiarra serve --port 3000 --mdns
```

#### Create a Room

```bash
# Interactive — prompts for name and password:
gambiarra create

# Or with flags:
gambiarra create --name "My Room"
gambiarra create --name "My Room" --config ./room-defaults.json
```

#### List Rooms

```bash
# Interactive — prompts for hub URL and output format:
gambiarra list

# Or with flags:
gambiarra list --json
```

#### Join a Room

```bash
# Interactive — select provider, model, set nickname:
gambiarra join

# Or with flags:
gambiarra join --code ABC123 --model llama3
gambiarra join --code ABC123 --model mistral --endpoint http://localhost:1234
gambiarra join --code ABC123 --model llama3 --config ./participant-config.json
```

### SDK Examples

#### Basic Chat

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({ roomCode: "ABC123" });

const result = await generateText({
  model: gambiarra.any(),
  prompt: "What is TypeScript?",
});

console.log(result.text);
```

#### Streaming

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { streamText } from "ai";

const gambiarra = createGambiarra({ roomCode: "ABC123" });

const stream = await streamText({
  model: gambiarra.model("llama3"),
  prompt: "Write a story about a robot",
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

#### With Custom Config

```typescript
const gambiarra = createGambiarra({
  roomCode: "ABC123",
  hubUrl: "http://192.168.1.100:3000",
});

const result = await generateText({
  model: gambiarra.any(),
  prompt: "Explain recursion",
  temperature: 0.7,
  maxTokens: 500,
});
```

### Terminal UI

```bash
cd apps/tui
bun install
bun run dev ABC123
```

The TUI provides real-time monitoring of:
- Active participants
- Current model loads
- Request history
- Participant health status

---

## Architecture

Gambiarra uses a **HTTP + SSE architecture** for simplicity and compatibility:

```
┌─────────────────────────────────────────────────────────────┐
│                    GAMBIARRA HUB (HTTP)                     │
│                                                             │
│  Endpoints:                                                 │
│  • POST   /rooms                    (Create room)          │
│  • GET    /rooms                    (List rooms)           │
│  • POST   /rooms/:code/join         (Join room)            │
│  • POST   /rooms/:code/v1/responses (Proxy)               │
│  • GET    /rooms/:code/v1/responses/:id                   │
│  • DELETE /rooms/:code/v1/responses/:id                   │
│  • POST   /rooms/:code/v1/responses/:id/cancel            │
│  • GET    /rooms/:code/v1/responses/:id/input_items       │
│  • POST   /rooms/:code/v1/chat/completions (Proxy)        │
│  • GET    /rooms/:code/events       (SSE updates)          │
└─────────────────────────────────────────────────────────────┘
       ▲                    ▲                      ▲
       │ HTTP               │ HTTP                 │ SSE
       │                    │                      │
  ┌────┴────┐    ┌─────────┴────────┐      ┌──────┴─────┐
  │   SDK   │    │  Participants    │      │    TUI     │
  └─────────┘    └──────────────────┘      └────────────┘
```

### Key Components

- **Hub**: Central HTTP server that routes requests and manages rooms
- **Participants**: LLM endpoints registered in a room (Ollama, LM Studio, etc.)
- **SDK**: Vercel AI SDK provider that proxies to the hub
- **TUI**: Real-time monitoring interface using Server-Sent Events

Internally, the hub uses a protocol adapter registry. `OpenResponses` is the default public path, but the core stays open to additional protocol adapters instead of baking protocol-specific branching into every call site.

### Model Routing

| Pattern | Example | Description |
|---------|---------|-------------|
| **Participant ID** | `gambiarra.participant("joao")` | Route to specific participant |
| **Model Name** | `gambiarra.model("llama3")` | Route to first participant with model |
| **Any** | `gambiarra.any()` | Route to random online participant |

### Project Structure

```
gambiarra/
├── packages/
│   ├── core/              # Core library (Hub, Room, Protocol)
│   ├── cli/               # Command-line interface
│   └── sdk/               # Vercel AI SDK integration
├── apps/
│   ├── docs/              # Documentation site (Astro Starlight)
│   └── tui/               # Terminal UI for monitoring
└── docs/                  # Architecture documentation
```

### Packages

| Package | Description | Version |
|---------|-------------|---------|
| `gambiarra` | CLI for managing hubs and participants | 0.1.0 |
| `gambiarra-sdk` | Vercel AI SDK provider | 0.1.0 |
| `@gambiarra/core` | Hub server, room management, SSE, mDNS (internal) | 0.0.1 |

For detailed architecture, see [docs/architecture.md](./docs/architecture.md).

---

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/arthurbm/gambiarra.git
cd gambiarra

# Install dependencies
bun install

# Build all packages
bun run build
```

### Commands

```bash
# Run hub server in development mode
bun run dev

# Run docs app
bun run dev:docs

# Type checking
bun run check-types

# Linting and formatting (Ultracite/Biome)
bun x ultracite check
bun x ultracite fix
```

### Working with Packages

```bash
# Work on CLI
cd packages/cli
bun run dev serve --port 3000

# Work on Core
cd packages/core
bun run check-types

# Work on SDK
cd packages/sdk
bun run check-types
```

### Code Standards

This project uses [Ultracite](https://github.com/Kikobeats/ultracite), a zero-config preset for Biome. See [CLAUDE.md](./CLAUDE.md) for detailed code standards.

### Releasing

Releases are automated via GitHub Actions. The workflow updates all package versions, publishes to npm, and creates GitHub releases with binaries.

**Via GitHub UI:**

1. Go to **Actions** > **Release** > **Run workflow**
2. Select bump type: `patch`, `minor`, or `major`
3. Select package: `all`, `sdk`, or `cli`
4. Click **Run workflow**

**Via GitHub CLI:**

```bash
# Release all packages with patch bump
gh workflow run release.yml -f bump=patch -f package=all

# Release only SDK with minor bump
gh workflow run release.yml -f bump=minor -f package=sdk

# Release only CLI with major bump
gh workflow run release.yml -f bump=major -f package=cli

# Watch the workflow progress
gh run watch
```

The workflow will:
- Calculate the new version (e.g., 0.1.1 → 0.1.2 for patch)
- Update all `package.json` files
- Build and publish to npm
- Commit and tag the release
- Build binaries for all platforms (if releasing CLI)
- Create a GitHub Release with binaries

---

## Supported Providers

Gambiarra works with endpoints that expose **OpenResponses** or **OpenAI-compatible chat/completions**:

| Provider | Default Endpoint | Notes |
|----------|------------------|-------|
| **Ollama** | `http://localhost:11434` | Most popular local LLM server |
| **LM Studio** | `http://localhost:1234` | GUI-based LLM management |
| **LocalAI** | `http://localhost:8080` | Self-hosted OpenAI alternative |
| **vLLM** | `http://localhost:8000` | High-performance inference |
| **text-generation-webui** | `http://localhost:5000` | Gradio-based interface |
| **Custom** | Any URL | Any OpenAI-compatible endpoint |

---

## Security Considerations

- **Local Network Only**: Gambiarra is designed for trusted local networks
- **No Authentication**: Currently no built-in auth (use network isolation)
- **HTTP Only**: Uses plain HTTP (consider reverse proxy for HTTPS)
- **Participant Trust**: All participants can access shared models

For production use, consider:
- Running behind a reverse proxy (Caddy, Nginx)
- Using VPN or WireGuard for remote access
- Implementing authentication at the proxy level

---

## Roadmap

- [ ] Authentication & authorization
- [ ] Participant quotas and rate limiting
- [ ] Persistent room storage (SQLite/PostgreSQL)
- [ ] Load balancing across multiple participants
- [ ] Model capability negotiation
- [ ] Web UI for room management
- [ ] Docker/container support
- [ ] Metrics and observability
- [ ] Request queueing for busy participants

---

## Contributing

Contributions are welcome! This is an early-stage project and we'd love your help.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `bun x ultracite fix` to format code
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Guidelines

- Follow the code standards in [CLAUDE.md](./CLAUDE.md)
- Write type-safe TypeScript
- Add tests for new features
- Update documentation as needed

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Acknowledgments

Built with:
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [Turbo](https://turbo.build) - High-performance build system
- [Vercel AI SDK](https://sdk.vercel.ai) - AI integration framework
- [Biome](https://biomejs.dev) - Fast formatter and linter
- [Clipanion](https://github.com/arcanis/clipanion) - Type-safe CLI framework
- [Bonjour](https://github.com/onlxltd/bonjour-service) - mDNS service discovery

---

<div align="center">

**Made with love for the local LLM community**

[Report Bug](https://github.com/arthurbm/gambiarra/issues) | [Request Feature](https://github.com/arthurbm/gambiarra/issues)

</div>
