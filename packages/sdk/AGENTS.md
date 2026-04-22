# gambi-sdk

SDK pública do Gambi. Publicada como `gambi-sdk` no npm. Roda tanto em Node.js quanto em Bun.

## Quatro superfícies

A SDK expõe exatamente quatro superfícies públicas. Cada uma tem um papel distinto — não mesclar:

| Superfície | Finalidade | Transporte |
| --- | --- | --- |
| `createGambi()` | inferência via AI SDK | `/rooms/:code/v1/*` (OpenAI-compatible) |
| `createClient()` | operação do management plane | `/v1/*` |
| `createParticipantSession()` | runtime de participante com túnel | management API + WebSocket |
| discovery helpers | descoberta de hub/sala em rede local | mDNS + management API |

Arquivos correspondentes:

- `src/provider.ts` — `createGambi()` (AI SDK v5 provider), `gambi.any()/model()/participant()`, `gambi.openResponses.*`, `gambi.chatCompletions.*`, `gambi.listModels()`, `gambi.listParticipants()`, `gambi.baseURL`.
- `src/client.ts` — `createClient()`, namespaces (`rooms`, `participants`, `events`), `ClientError`.
- `src/rooms.ts`, `src/participants.ts`, `src/hub.ts` — implementações dos namespaces e chamadas ao management plane.
- `src/participant-session.ts` — `createParticipantSession()` e `ParticipantSession` (close reasons: `"closed"`, `"heartbeat_failed"`, `"tunnel_closed"`).
- `src/discovery.ts` — `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError`.
- `src/protocol.ts`, `src/protocol-adapters.ts` — seleção Responses vs Chat Completions.
- `src/types.ts` — tipos públicos reexportados (inclui `HEALTH_CHECK_INTERVAL` para runtimes custom).

## Contratos que a SDK mantém

Qualquer mudança aqui atualiza `apps/docs/src/content/docs/reference/sdk.md` no mesmo PR:

- Shape de `ClientError` (`status`, `code`, `hint`, `details`, `requestId`).
- `ParticipantSessionCloseEvent` (`reason`, `error?`).
- `DiscoveryError.code` (`NO_HUBS_FOUND`, `NO_ROOMS_FOUND`, `ROOM_NOT_FOUND`, `AMBIGUOUS_ROOM_MATCH`).
- Assinatura e return shape de `createParticipantSession()`.
- Helpers de routing do provider (`any`, `model`, `participant`) e namespaces por protocolo (`openResponses`, `chatCompletions`).

## Regras de design

- **Explicitness sobre mágica**: `createGambi()` e `createClient()` são factories **explícitas**. Não adicionar discovery implícito nelas — quem quiser descoberta usa `resolveGambiTarget()` primeiro e passa o resultado.
- **`createParticipantSession()` é o runtime canônico**: o CLI `gambi participant join` construiu em cima dela. Novos runtimes custom devem usar essa mesma função em vez de reimplementar tunelamento.
- **Auth headers só saem no leg participante→provider**: `ParticipantAuthHeaders` passados a `createParticipantSession()` são aplicados apenas ao chamar o endpoint local do provider. Não enviar em nenhum outro lugar; o hub jamais os recebe.
- **Heartbeat/ping em `HEALTH_CHECK_INTERVAL` (10 s)**: constante re-exportada de `types.ts`. Se construir um runtime custom sem `createParticipantSession()`, usar essa mesma cadência — a janela de offline do hub é `PARTICIPANT_TIMEOUT` (30 s).
- **Management plane do core é fonte única**: a SDK não inventa rotas. Se precisar de algo novo, adicionar no `@gambi/core` primeiro.
- **Envelopes `{ data, meta }` do management são expostos**: os namespaces do `createClient()` retornam o envelope completo; agentes podem ler `meta.requestId` para correlacionar com SSE/logs.

## Validação

```bash
bun test packages/sdk/src
bun run --cwd packages/sdk check-types
bun run --cwd packages/sdk build
```

Os testes da SDK sobem um hub real em porta fixa (ex.: 3999). Diagnosticar antes de acusar regressão se a porta estiver em uso.

Ao mudar superfícies públicas, rodar o build do docs site para garantir que links/anchors não quebraram:

```bash
bun run --cwd apps/docs build
```

## Regras do Bun

A SDK é publicada e também usada em projetos Node.js — preferir APIs portáveis (fetch, WebSocket, URL), mas dentro do monorepo seguimos Bun:

- `bun test` para testes.
- `WebSocket` nativo (Bun e Node 22+).
- Bun carrega `.env` automaticamente — não usar `dotenv`.
- Não introduzir dependências específicas de Bun em código publicado (o consumidor pode estar rodando em Node).
