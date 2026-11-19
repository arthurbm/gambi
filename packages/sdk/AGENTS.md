# gambi-sdk

SDK pública do Gambi, publicada como `gambi-sdk` no npm. Por dentro é Effect v4 (ADR-0007); por fora é `Promise`, `AsyncIterable` e tipos escritos à mão. Leia a seção "The SDK" de [`docs/reference/effect-conventions.md`](../../docs/reference/effect-conventions.md) antes de mexer aqui.

## Entradas

A lista das entradas e o que cada uma pode importar do runtime fica em `entries.ts`.

| Entrada | O que tem | Roda em |
| --- | --- | --- |
| `gambi-sdk` | `createClient()` (management plane, inclusive o attach a um harness participant em `client.harness`), `createGambi()` (inferência via AI SDK), `ClientError`, tipos | Node e Bun. Só usa `fetch` e não importa nenhum módulo embutido (browser não é testado) |
| `gambi-sdk/discovery` | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError` | Node e Bun (mDNS abre sockets UDP) |
| `gambi-sdk/hub` | `createHub()`, `HubError`, tipos | **Só Bun.** Hospeda um hub no processo de quem importa |
| `gambi-sdk/participant` | `createParticipantSession()`, `createHarnessParticipantSession()`, `createLocalDirectoryWorkspace()`, `probeProvider()`, `runFakeAcpAgent()`, `MAX_ARTIFACT_BYTES`, `ParticipantError`, tipos | **Só Bun.** Hospeda um participante (de endpoint ou harness participant) no processo de quem importa |

A entrada padrão não exporta hub, estado de salas, sessão de participante nem valores de schema, e importá-la não carrega nenhuma das outras: cada entrada é um arquivo só. Uma entrada de hospedagem carregada em Node falha na hora com uma mensagem que diz que ela só roda em Bun (`src/bun-only.ts`).

## Arquivos

- `src/client.ts` — `createClient()` e a interface `GambiClient`: `hub`, `rooms`, `participants`, `events`, `harness`, `close`.
- `src/client-error.ts` — `ClientError` e `ClientErrorCode`.
- `src/types.ts` — tipos públicos de salas, participantes, eventos de sala e eventos do attach de harness, escritos à mão, sem imports.
- `src/contract.ts` — interno. A ponte com o contrato do management plane (`@gambi/protocol`): o cliente derivado, a tradução de erros e `ContractProofs`, que falha o check de tipos quando um tipo público diverge do schema.
- `src/promise.ts` — interno. A fronteira em `Promise` sobre um `ManagedRuntime`.
- `src/provider.ts` — `createGambi()`: `gambi.any()/model()/participant()`, `gambi.openResponses.*`, `gambi.chatCompletions.*`, `gambi.listModels()`, `gambi.listParticipants()`, `gambi.baseURL`.
- `src/discovery.ts` — a entrada `gambi-sdk/discovery`.
- `src/input.ts` — interno. `withoutUndefined`: o que toda fronteira em `Promise` tira da entrada.
- `src/hub.ts` — a entrada `gambi-sdk/hub`: `createHub()` e `HubError`.
- `src/participant.ts` — a entrada `gambi-sdk/participant`. Só reexporta:
  - `src/participant-session.ts` — `createParticipantSession()` e `probeProvider()`.
  - `src/harness-participant-session.ts` — `createHarnessParticipantSession()`.
  - `src/workspace.ts` — a costura Workspace em `Promise` (`Workspace`, `PreparedWorkspace`) e `createLocalDirectoryWorkspace()`.
  - `src/fake-harness.ts` — `runFakeAcpAgent()` e o comando que o roda a partir do próprio arquivo.
  - `src/session-types.ts`, `src/participant-error.ts`, `src/log.ts` — tipos públicos e `ParticipantError`.
- `src/hosting.ts`, `src/session.ts`, `src/participant-failure.ts`, `src/workspace-layer.ts`, `src/hosting-proofs.ts`, `src/bun-only.ts` — internos das entradas de hospedagem: a subida atrás da fronteira, o ciclo de vida da sessão (`leave`, `stop`, `ended`), a tradução de erros, a ponte do Workspace e as provas de tipo.
- `entries.ts`, `build.ts` — o build: um arquivo por entrada, mais as declarações.
- `scripts/check-packed-types.ts` — checa o pacote como um consumidor o instala.

## Contratos que a SDK mantém

Mudança aqui é mudança pública. A documentação pública (`apps/docs/src/content/docs/reference/sdk.md`) acompanha.

- Os métodos de `GambiClient` devolvem o valor do contrato, sem o envelope `{ data, meta }`.
- Toda falha do cliente é um `ClientError` (`code`, `status`, `hint`, `details`, `requestId`). `code` é uma união fechada: os códigos do contrato mais `HUB_UNREACHABLE` e `NOT_A_HUB`.
- `events.watch()` devolve um `AsyncIterable<RoomEvent>` cujo primeiro evento é sempre `room.snapshot`. O laço termina sem erro quando o hub fecha, quando o `signal` aborta ou quando o cliente é fechado.
- `harness.attach()` devolve um `AsyncIterable<HarnessAttachEvent>` com as mesmas regras de fim; `harness.send()`, `openSession()` e `closeSession()` são `Promise`. O attach é SSE e requisições comuns: a entrada padrão continua sem sockets.
- Um campo com valor `undefined` é um campo não informado, no cliente e nas entradas de hospedagem.
- `createHub()` rejeita só com `HubError` (`PORT_IN_USE`, `LISTEN_FAILED`, `MDNS_ANNOUNCE_FAILED`); as duas sessões de participante rejeitam só com `ParticipantError`. Cada entrada tem a própria classe de erro.
- Uma sessão de participante tem `participant`, `ended` (uma `Promise` que nunca rejeita), `leave()` (sai da sala e para) e `stop()` (só para). `leave()` de uma sessão que foi substituída (`replaced`) não avisa o hub: o participante com aquele id na sala já é outro runtime. Uma sessão cujo runtime acabou sozinho solta o que hospedava (harness, Workspace) antes de `ended` resolver.
- O que é hospedado não escreve log por conta própria: as linhas vão para `onLog` ou para lugar nenhum.
- `DiscoveryError.code` (`NO_HUBS_FOUND`, `NO_ROOMS_FOUND`, `ROOM_NOT_FOUND`, `AMBIGUOUS_ROOM_MATCH`).
- Helpers de routing do provider (`any`, `model`, `participant`) e namespaces por protocolo (`openResponses`, `chatCompletions`).

## Regras de design

- **Nenhum tipo do Effect em assinatura pública.** Nem `typeof Schema.Type`. O `check:packed-types` reprova.
- **A SDK exporta tipos, não valores de schema**, e não depende de zod.
- **O contrato é a fonte única.** A SDK não inventa rotas, e o cliente e o provider não escrevem chamada HTTP à mão para o management plane: passam pelo cliente derivado. Rota nova entra em `@gambi/protocol` primeiro. A exceção são os helpers de descoberta, que sondam `/v1/health` e `/v1/rooms` de vários hubs com `fetch` (aceitam `fetchFn`).
- **A entrada padrão só usa `fetch`.** Nada de `node:*`, `bun:*`, `Bun.*`, sockets ou servidor. O que precisar disso vai para outra entrada.
- **Nada do Effect atravessa entradas.** Cada entrada embute a própria cópia do `effect`; entre elas só passam JSON puro e `Promise`.
- **Tipo público mora em arquivo cujos exports são todos públicos.** As declarações de uma entrada são montadas a partir de todo arquivo que os tipos dela alcançam; um export interno ali (um `Layer`, uma função que recebe `Effect`) quebra o build com TS2742. O que é interno fica em arquivo próprio.
- **Explicitness sobre mágica.** `createGambi()` e `createClient()` não fazem descoberta implícita; quem quiser usa `resolveGambiTarget()` antes e passa o resultado.
- **`ParticipantAuthHeaders` nunca vão ao hub.** `participants.register` não os aceita; na sessão de participante eles vão só para o handler que chama o provider local e para a sonda (`probeProvider`), que também roda na máquina do participante.
- **O túnel não grava arquivo.** O Workspace é uma costura local: artefatos só sobem (ADR-0006).

## Validação

```bash
bun test packages/sdk/src
bun run --cwd packages/sdk check-types
bun run --cwd packages/sdk build && bun run --cwd packages/sdk check:packed-types
```

Os testes sobem um hub real em porta livre (`layerHub` de `@gambi/core/testing/hub`) e chamam a API em `Promise`. Não substituem `fetch`. O harness participant é testado com o harness `fake` como subprocesso de verdade. `src/node.test.ts` roda a entrada padrão num processo Node e precisa de `node` no `PATH`. `check:packed-types` carrega cada entrada no runtime dela, roda a entrada padrão em Node sem os arquivos das outras, e roda em Bun um programa que hospeda hub e participantes a partir do pacote empacotado.
