# @gambi/core

Core do hub: servidor HTTP, estado de sala/participante, protocolo do túnel, SSE, mDNS e schemas Zod compartilhados. Este package é **consumido** pelo CLI, pela SDK e pela TUI; não importe nada de CLI/SDK/TUI de volta pra cá.

## Arquivos-chave

- `src/hub.ts` — `Bun.serve()` do hub. Roteamento HTTP, upgrade do WebSocket do túnel, forward de requests, observabilidade baseline.
- `src/room.ts` — estado de sala e participantes, routing (`<id>`, `model:<name>`, `*`/`any`), marcação de offline.
- `src/participant.ts` — ciclo de vida de participante (join, leave, heartbeat, connection).
- `src/types.ts` — schemas Zod **autoritativos** (`ParticipantInfo`, `ParticipantConnection`, `ParticipantCapabilities`, `RuntimeConfig`, etc.) e constantes `HEALTH_CHECK_INTERVAL` / `PARTICIPANT_TIMEOUT`.
- `src/tunnel-protocol.ts` — mensagens do túnel: `tunnel.request`, `tunnel.response.start/chunk/end/error`, `tunnel.ping/pong`. Validação Zod usada nos dois lados.
- `src/protocol.ts` / `src/protocol-adapters.ts` — adapter Responses ↔ Chat Completions.
- `src/sse.ts` — publicação de eventos SSE.
- `src/mdns.ts` / `src/discovery.ts` — anúncio mDNS do hub e helpers de descoberta usados pela SDK.
- `src/endpoint-capabilities.ts` — probe de endpoint de provider para detectar modelos e capacidades.

## Contratos que este package define

Qualquer mudança nesses contratos é breaking change pública e precisa atualizar `apps/docs/src/content/docs/reference/api.md`, `reference/sdk.md`, `reference/observability.md` e `docs/architecture.md`:

- Shape do envelope de management (`{ data, meta }`, `{ error, meta }`).
- Shape de `ParticipantInfo` público (inclui `connection`, `capabilities`, `status`, `config` já redigido).
- Códigos de erro: `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`, `INVALID_REQUEST`, `INVALID_PASSWORD`, `ENDPOINT_NOT_REACHABLE`, `PARTICIPANT_CONFLICT`, `PARTICIPANT_BUSY`, `PARTICIPANT_TUNNEL_NOT_CONNECTED`, `MODEL_NOT_FOUND`, `INTERNAL_ERROR`.
- Tipos de evento SSE e campos.
- Mensagens do túnel e seu discriminated union (`TunnelClientMessage`, `TunnelServerMessage`).

## Regras de design

- **Tunnel-first**: o hub nunca origina conexão ao participante. Toda transferência de request passa pelo WebSocket aberto pelo próprio participante. Não adicionar fallback de HTTP direto ao endpoint do provider.
- **Token de bootstrap single-use, TTL 60 s**: implementado em `hub.ts` via `tunnelBootstrapRegistry`. Não relaxar essas garantias sem pedido explícito.
- **Management plane é fonte canônica para automação**: rotas em `/v1` devem ser suficientes para SDK/CLI/TUI operarem o hub. Não inventar rotas alternativas.
- **Headers de auth do participante (`ParticipantAuthHeaders`) nunca chegam ao core**: o hub jamais os armazena. São aplicados só no lado do participante via `createParticipantSession()` na SDK.
- **Observabilidade baseline é parte do core**: eventos `llm.request`, `llm.complete`, `llm.error` e métricas `ttftMs`/`durationMs`/`*Tokens`/`tokensPerSecond` saem daqui.

## Constantes expostas

```ts
HEALTH_CHECK_INTERVAL = 10_000          // ms entre heartbeats do management e pings do túnel
PARTICIPANT_TIMEOUT   = 30_000          // ms sem heartbeat antes de marcar offline
TUNNEL_TOKEN_TTL_MS   = 60_000          // TTL do token de bootstrap do túnel
```

Se for alterar qualquer uma, atualizar:
- `apps/docs/src/content/docs/reference/api.md`
- `apps/docs/src/content/docs/reference/sdk.md`
- `apps/docs/src/content/docs/architecture/overview.md`
- `docs/architecture.md`

## Validação

```bash
bun test packages/core/src
bun run --cwd packages/core check-types
```

Observação: os testes sobem um hub real em portas fixas (ex.: 3998/3999). Se outra instância já estiver escutando, os testes falham — diagnosticar antes de acusar regressão.

## Regras do Bun

Este package roda em Bun; prefira as APIs nativas:
- `Bun.serve()` com `websocket: { ... }` para HTTP + WebSocket (não usar `express` nem `ws`).
- `WebSocket` nativo.
- `bun test` para testes (`import { test, expect } from "bun:test"`).
- `Bun.file` em vez de `node:fs/promises` quando possível.
- Bun carrega `.env` automaticamente — não usar `dotenv`.
