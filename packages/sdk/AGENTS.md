# gambi-sdk

SDK pública do Gambi, publicada como `gambi-sdk` no npm. Por dentro é Effect v4 (ADR-0007); por fora é `Promise`, `AsyncIterable` e tipos escritos à mão. Leia a seção "The SDK" de [`docs/reference/effect-conventions.md`](../../docs/reference/effect-conventions.md) antes de mexer aqui.

## Entradas

A lista das entradas e o que cada uma pode importar do runtime fica em `entries.ts`.

| Entrada | O que tem | Roda em |
| --- | --- | --- |
| `gambi-sdk` | `createClient()` (management plane), `createGambi()` (inferência via AI SDK), `ClientError`, tipos | Node e Bun. Só usa `fetch` e não importa nenhum módulo embutido (browser não é testado) |
| `gambi-sdk/discovery` | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError` | Node e Bun (mDNS abre sockets UDP) |

A entrada padrão não exporta hub, estado de salas, sessão de participante nem valores de schema. As entradas para hospedar um hub e um participante no próprio processo (só Bun) entram no #125.

## Arquivos

- `src/client.ts` — `createClient()` e a interface `GambiClient`: `hub`, `rooms`, `participants`, `events`, `close`.
- `src/client-error.ts` — `ClientError` e `ClientErrorCode`.
- `src/types.ts` — tipos públicos de salas, participantes e eventos, escritos à mão, sem imports.
- `src/contract.ts` — interno. A ponte com o contrato do management plane (`@gambi/protocol`): o cliente derivado, a tradução de erros e `ContractProofs`, que falha o check de tipos quando um tipo público diverge do schema.
- `src/promise.ts` — interno. A fronteira em `Promise` sobre um `ManagedRuntime`.
- `src/provider.ts` — `createGambi()`: `gambi.any()/model()/participant()`, `gambi.openResponses.*`, `gambi.chatCompletions.*`, `gambi.listModels()`, `gambi.listParticipants()`, `gambi.baseURL`.
- `src/discovery.ts` — a entrada `gambi-sdk/discovery`.
- `entries.ts`, `build.ts` — o build: um arquivo por entrada, mais as declarações.
- `scripts/check-packed-types.ts` — checa o pacote como um consumidor o instala.

## Contratos que a SDK mantém

Mudança aqui é mudança pública. A documentação pública (`apps/docs/src/content/docs/reference/sdk.md`) acompanha.

- Os métodos de `GambiClient` devolvem o valor do contrato, sem o envelope `{ data, meta }`.
- Toda falha do cliente é um `ClientError` (`code`, `status`, `hint`, `details`, `requestId`). `code` é uma união fechada: os códigos do contrato mais `HUB_UNREACHABLE` e `NOT_A_HUB`.
- `events.watch()` devolve um `AsyncIterable<RoomEvent>` cujo primeiro evento é sempre `room.snapshot`. O laço termina sem erro quando o hub fecha, quando o `signal` aborta ou quando o cliente é fechado.
- `DiscoveryError.code` (`NO_HUBS_FOUND`, `NO_ROOMS_FOUND`, `ROOM_NOT_FOUND`, `AMBIGUOUS_ROOM_MATCH`).
- Helpers de routing do provider (`any`, `model`, `participant`) e namespaces por protocolo (`openResponses`, `chatCompletions`).

## Regras de design

- **Nenhum tipo do Effect em assinatura pública.** Nem `typeof Schema.Type`. O `check:packed-types` reprova.
- **A SDK exporta tipos, não valores de schema**, e não depende de zod.
- **O contrato é a fonte única.** A SDK não inventa rotas, e o cliente e o provider não escrevem chamada HTTP à mão para o management plane: passam pelo cliente derivado. Rota nova entra em `@gambi/protocol` primeiro. A exceção são os helpers de descoberta, que sondam `/v1/health` e `/v1/rooms` de vários hubs com `fetch` (aceitam `fetchFn`).
- **A entrada padrão só usa `fetch`.** Nada de `node:*`, `bun:*`, `Bun.*`, sockets ou servidor. O que precisar disso vai para outra entrada.
- **Explicitness sobre mágica.** `createGambi()` e `createClient()` não fazem descoberta implícita; quem quiser usa `resolveGambiTarget()` antes e passa o resultado.
- **`ParticipantAuthHeaders` nunca vão ao hub.** `participants.register` não os aceita.

## Validação

```bash
bun test packages/sdk/src
bun run --cwd packages/sdk check-types
bun run --cwd packages/sdk build && bun run --cwd packages/sdk check:packed-types
```

Os testes sobem um hub real em porta livre (`layerHub` de `@gambi/core/testing/hub`) e chamam a API em `Promise`. Não substituem `fetch`. `src/node.test.ts` roda a entrada padrão num processo Node e precisa de `node` no `PATH`.
