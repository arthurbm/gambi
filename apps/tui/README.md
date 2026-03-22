# gambi-tui

Interactive terminal dashboard for [Gambi](https://github.com/arthurbm/gambi) — monitor and manage shared LLMs on your local network.

Built with [OpenTUI](https://github.com/anthropics/opentui) (React for terminal).

## Installation

Requires [Bun](https://bun.sh).

```bash
bun add -g gambi-tui
```

## Usage

```bash
gambi-tui                                    # Connect to localhost:3000
gambi-tui --hub http://192.168.1.100:3000    # Connect to remote hub
```

## Features

- **Serve Hub** — Start/stop a local Gambi hub
- **Create Room** — Create rooms on the hub
- **Join Room** — Join as a participant with your LLM endpoint
- **List Rooms** — Browse available rooms
- **Monitor** — Real-time dashboard with participants, activity logs, and metrics via SSE

## Programmatic Usage

```typescript
import { startTUI } from "gambi-tui";

await startTUI({ hubUrl: "http://localhost:3000" });
```
