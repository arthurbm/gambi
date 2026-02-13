# gambiarra-sdk

[![npm version](https://img.shields.io/npm/v/gambiarra-sdk)](https://www.npmjs.com/package/gambiarra-sdk)
[![npm downloads](https://img.shields.io/npm/dm/gambiarra-sdk)](https://www.npmjs.com/package/gambiarra-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript SDK for Gambiarra - a distributed LLM coordination system.

## Installation

```bash
npm install gambiarra-sdk
```

or

```bash
bun add gambiarra-sdk
```

or

```bash
pnpm add gambiarra-sdk
```

## Overview

The SDK provides organized namespaces for interacting with Gambiarra hubs:

- **`rooms`** - Manage rooms and participants
- **`participants`** - Create and configure participants
- **`hub`** - Create and manage hubs
- **`createClient`** - HTTP client for remote hubs
- **Types** - Full TypeScript type definitions

## Quick Start

### Creating a Local Hub

```typescript
import { hub, rooms, participants } from "gambiarra-sdk";

// Create a hub
const myHub = hub.create({ port: 3000 });
console.log(`Hub running at ${myHub.url}`);

// Create a room
const room = rooms.create("My AI Room", "host-id-123");
console.log(`Room code: ${room.code}`);

// Create and add a participant
const participant = participants.create({
  nickname: "Local Ollama",
  model: "llama3",
  endpoint: "http://localhost:11434",
  specs: {
    gpu: "RTX 4090",
    vram: 24,
  },
});

rooms.addParticipant(room.id, participant);
```

### Using the HTTP Client

Connect to a remote Gambiarra hub:

```typescript
import { createClient } from "gambiarra-sdk";

const client = createClient({ hubUrl: "http://hub.example.com:3000" });

// Create a room
const { room, hostId } = await client.create("Remote Room");

// Join the room
await client.join(room.code, {
  id: "participant-1",
  nickname: "My Bot",
  model: "gpt-4",
  endpoint: "http://localhost:11434",
});

// Get participants
const participants = await client.getParticipants(room.code);

// Health check
await client.healthCheck(room.code, "participant-1");

// Leave the room
await client.leave(room.code, "participant-1");
```

### With Vercel AI SDK

Use Gambiarra as an AI provider:

```typescript
import { createGambiarra } from "gambiarra-sdk";
import { generateText } from "ai";

const gambiarra = createGambiarra({ roomCode: "ABC123" });

const result = await generateText({
  model: gambiarra.any(), // Random online participant
  prompt: "Hello, world!",
});
```

## API Reference

### `rooms`

Manage rooms and participants:

```typescript
// Create a room
const room = rooms.create(name, hostId);

// Get rooms
const room = rooms.get(id);
const room = rooms.getByCode(code);
const allRooms = rooms.list();
const roomsWithCount = rooms.listWithParticipantCount();

// Remove a room
rooms.remove(id);

// Participant management
rooms.addParticipant(roomId, participant);
rooms.removeParticipant(roomId, participantId);
rooms.getParticipants(roomId);
rooms.getParticipant(roomId, participantId);
rooms.updateParticipantStatus(roomId, participantId, status);
rooms.updateLastSeen(roomId, participantId);

// Find participants
rooms.findParticipantByModel(roomId, modelName);
rooms.getRandomOnlineParticipant(roomId);

// Maintenance
rooms.checkStaleParticipants();
rooms.clear(); // Testing only
```

### `participants`

Create and configure participants:

```typescript
// Create a participant
const participant = participants.create({
  nickname: "Bot Name",
  model: "llama3",
  endpoint: "http://localhost:11434",
  specs: {
    gpu: "RTX 4090",
    vram: 24,
    ram: 64,
    cpu: "AMD Ryzen 9",
  },
  config: {
    temperature: 0.7,
    max_tokens: 2048,
  },
});

// Merge configurations
const merged = participants.mergeConfig(baseConfig, overrides);
```

### `hub`

Create and manage hubs:

```typescript
const myHub = hub.create({
  port: 3000,
  hostname: "0.0.0.0",
  mdns: true,
  cors: ["*"],
});

// Hub provides: server, url, mdnsName, close()
console.log(myHub.url); // http://0.0.0.0:3000
myHub.close(); // Cleanup
```

### `createClient`

HTTP client for remote hubs:

```typescript
const client = createClient({ hubUrl: "http://hub:3000" });

// Create room
const { room, hostId } = await client.create("Room Name");

// List rooms
const rooms = await client.list();

// Join room
const { participant, roomId } = await client.join(code, {
  id: "participant-id",
  nickname: "Bot",
  model: "llama3",
  endpoint: "http://localhost:11434",
});

// Leave room
await client.leave(code, participantId);

// Get participants
const participants = await client.getParticipants(code);

// Health check
await client.healthCheck(code, participantId);
```

## Types

All core types are re-exported:

```typescript
import type {
  RoomInfo,
  ParticipantInfo,
  ParticipantStatus,
  GenerationConfig,
  MachineSpecs,
  HubConfig,
  NetworkConfig,
} from "gambiarra-sdk";
```

### Runtime Validation

Zod schemas are exported with `Schema` suffix:

```typescript
import {
  ParticipantInfoSchema,
  RoomInfoSchema,
  GenerationConfigSchema,
} from "gambiarra-sdk";

// Validate at runtime
const result = ParticipantInfoSchema.parse(data);
```

## Tree-shaking

Import only what you need for optimal bundle size:

```typescript
// Import specific namespaces
import { rooms, participants, hub } from "gambiarra-sdk";

// Or destructure what you need
import { createClient, createGambiarra } from "gambiarra-sdk";
```

Modern bundlers (webpack, esbuild, rollup) will tree-shake unused exports.

## Architecture

The SDK is a **zero-duplication wrapper** around `@gambiarra/core`:

- **`types.ts`** - Re-exports all core types
- **`protocol.ts`** - Re-exports protocol messages
- **`rooms.ts`** - Re-exports Room namespace
- **`participants.ts`** - Re-exports Participant namespace
- **`hub.ts`** - Re-exports Hub creation
- **`utils.ts`** - Re-exports utilities (logo, etc)
- **`client.ts`** - NEW: HTTP client implementation

**Philosophy:** Core contains implementation, SDK is the user-facing API.

## Examples

### Complete Workflow

```typescript
import { hub, rooms, participants } from "gambiarra-sdk";

// 1. Create hub
const myHub = hub.create({ port: 3000 });

// 2. Create room
const room = rooms.create("AI Collaboration", "host-123");

// 3. Add participants
const bot1 = participants.create({
  nickname: "Llama 3",
  model: "llama3",
  endpoint: "http://localhost:11434",
});

const bot2 = participants.create({
  nickname: "GPT-4",
  model: "gpt-4",
  endpoint: "http://localhost:11435",
});

rooms.addParticipant(room.id, bot1);
rooms.addParticipant(room.id, bot2);

// 4. List participants
const allParticipants = rooms.getParticipants(room.id);
console.log(`${allParticipants.length} participants in room`);

// 5. Cleanup
myHub.close();
```

### Health Checks

```typescript
// Send periodic health checks
setInterval(() => {
  rooms.updateLastSeen(roomId, participantId);
}, 10_000);

// Check for stale participants
const stale = rooms.checkStaleParticipants();
for (const { roomId, participantId } of stale) {
  console.log(`Participant ${participantId} is offline`);
}
```

### Error Handling

```typescript
import { ClientError } from "gambiarra-sdk";

try {
  await client.join("INVALID", participant);
} catch (error) {
  if (error instanceof ClientError) {
    console.error(`HTTP ${error.status}: ${error.message}`);
    console.error(error.response); // Original response data
  }
}
```

## Testing

```bash
bun test
```

## License

MIT
