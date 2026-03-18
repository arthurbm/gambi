# Gambi - Notas de Arquitetura

Documento complementar ao plano principal com detalhes técnicos adicionais.

## Referências Importantes

### OpenCode (Inspiração Principal)
- Repositório: `/home/arthur/Documents/PESSOAL/GAMBI-CLUB/opencode`
- TUI: `packages/opencode/src/cli/cmd/tui/app.tsx`
- SDK: `packages/sdk/js/`
- OpenAPI: `packages/sdk/openapi.json`
- Server: `packages/opencode/src/server/server.ts`

### Projeto Atual
- Repositório: `/home/arthur/Documents/PESSOAL/GAMBI-CLUB/gambi`
- TUI já configurada: `apps/tui/` (usa @opentui/react)
- Docs já configuradas: `apps/docs/` (Starlight)
- Linting: `biome.json` + Ultracite

## Padrões do Bun a Usar

### WebSocket Pub/Sub Nativo

```typescript
const server = Bun.serve({
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const roomCode = url.searchParams.get("room");
      server.upgrade(req, { data: { roomCode } });
      return;
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    data: {} as { roomCode: string },
    open(ws) {
      ws.subscribe(`room:${ws.data.roomCode}`);
    },
    message(ws, message) {
      server.publish(`room:${ws.data.roomCode}`, message);
    },
    close(ws) {
      ws.unsubscribe(`room:${ws.data.roomCode}`);
    },
  },
});
```

### Executável Standalone

```typescript
// Detectar se está rodando como binário compilado
const isCompiled = Bun.embeddedFiles.length > 0;

// Embed de arquivos
import logo from "./logo.txt" with { type: "file" };
const logoText = await Bun.file(logo).text();

// Cross-compilation
await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: {
    target: "bun-linux-x64",
    outfile: "./dist/gambi-linux",
  },
  minify: true,
  bytecode: true, // Startup mais rápido
});
```

## Parâmetros Completos do Ollama

```typescript
interface OllamaConfig {
  // Sampling
  temperature?: number;      // 0.0-2.0, default 0.8
  top_k?: number;            // 1-100, default 40
  top_p?: number;            // 0.0-1.0, default 0.9
  min_p?: number;            // 0.0-1.0, default 0.0

  // Repetition
  repeat_penalty?: number;   // 0.0-2.0, default 1.1
  repeat_last_n?: number;    // -1 to num_ctx, default 64

  // Context
  num_ctx?: number;          // Context window, default 2048
  num_predict?: number;      // Max tokens, -1 = infinite

  // Reproducibility
  seed?: number;

  // Stop sequences
  stop?: string[];

  // Mirostat (advanced)
  mirostat?: 0 | 1 | 2;      // 0=disabled, 1=Mirostat, 2=Mirostat 2.0
  mirostat_tau?: number;     // Target entropy, default 5.0
  mirostat_eta?: number;     // Learning rate, default 0.1
}
```

## AI SDK - Custom Provider Pattern

```typescript
import { createOllama } from "@ai-sdk/ollama";
import { customProvider } from "ai";

// Wrapper que roteia para participantes
export function createGambiProvider(client: GambiClient) {
  return customProvider({
    languageModels: {
      // Mapeia IDs de modelo para participantes
      [participantId]: createOllamaModelForParticipant(client, participantId),
    },
    fallbackProvider: createOllama(), // Fallback para Ollama local
  });
}
```

## Detecção de Specs da Máquina

```typescript
import { $ } from "bun";

async function detectMachineSpecs(): Promise<MachineSpecs> {
  const specs: MachineSpecs = {};

  // Linux/macOS
  if (process.platform !== "win32") {
    // GPU (NVIDIA)
    try {
      const nvidia = await $`nvidia-smi --query-gpu=name,memory.total --format=csv,noheader`.text();
      const [name, vram] = nvidia.split(",").map(s => s.trim());
      specs.gpu = name;
      specs.vram = parseInt(vram) / 1024; // MB to GB
    } catch {}

    // RAM
    try {
      const mem = await $`free -g | grep Mem | awk '{print $2}'`.text();
      specs.ram = parseInt(mem);
    } catch {}

    // CPU
    try {
      specs.cpu = await $`cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2`.text();
    } catch {}
  }

  return specs;
}
```

## Estrutura Starlight i18n

```javascript
// apps/docs/astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Gambi',
      defaultLocale: 'pt-br',
      locales: {
        'pt-br': { label: 'Português', lang: 'pt-BR' },
        'en': { label: 'English', lang: 'en' },
      },
      sidebar: [
        { label: 'Início', slug: 'index' },
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'CLI',
          items: [
            { label: 'serve', slug: 'cli/serve' },
            { label: 'create', slug: 'cli/create' },
            { label: 'join', slug: 'cli/join' },
            { label: 'list', slug: 'cli/list' },
          ],
        },
        {
          label: 'SDK',
          items: [
            { label: 'Installation', slug: 'sdk/installation' },
            { label: 'Usage', slug: 'sdk/usage' },
            { label: 'API Reference', slug: 'sdk/api-reference' },
          ],
        },
      ],
    }),
  ],
});
```

## Namespace Pattern (OpenCode Style)

```typescript
// packages/core/src/room.ts
import { z } from "zod";
import { nanoid } from "nanoid";

export namespace Room {
  export const Info = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    hostId: z.string(),
    createdAt: z.number(),
  }).meta({ ref: "Room" });

  export type Info = z.infer<typeof Info>;

  export const Event = {
    Created: BusEvent.define("room.created", Info),
    Deleted: BusEvent.define("room.deleted", z.object({ id: z.string() })),
  };

  export function create(name: string, hostId: string): Info {
    return {
      id: nanoid(),
      code: nanoid(6).toUpperCase(),
      name,
      hostId,
      createdAt: Date.now(),
    };
  }

  export function get(id: string): Info | undefined {
    return rooms.get(id);
  }
}
```

## URLs de Documentação

- Bun WebSocket: https://bun.sh/docs/runtime/http/websockets.md
- Bun Compile: https://bun.sh/docs/bundler/executables.md
- Bun Publish: https://bun.sh/docs/pm/cli/publish.md
- AI SDK: https://ai-sdk.dev/docs
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- Starlight i18n: https://starlight.astro.build/guides/i18n/
- OpenTUI: https://github.com/anthropics/opentui
