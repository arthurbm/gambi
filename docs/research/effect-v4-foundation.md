# Effect v4 como fundação do Gambi: estado da biblioteca, referências e spike

**Status:** pesquisa, 2026-11-10. Gerado por agentes a partir de fontes primárias (`npm view`, pacote `effect@4.1.3` extraído, clones locais do OpenCode e do T3 Code, e um spike executado em Bun 1.4.4). Datas e versões são as do dia.
**Contexto:** base factual da [ADR-0007](../adr/0007-effect-as-runtime-foundation.md).
**Perguntas:** (1) o Effect v4 está pronto para ser a fundação do core e da CLI? (2) o túnel pode usar `effect/rpc` com os papéis invertidos do Gambi? (3) qual runner de testes?

> **O código do spike se perdeu.** Ele vivia numa pasta temporária que foi apagada num reboot antes de ser copiada. O que está neste documento (fiação, medições, formato no fio) foi transcrito do relatório do agente que o executou. Os trechos de código abaixo são os que carregam decisão; o resto precisa ser reescrito.

## TL;DR

- **A v4 é estável** desde 2026-10-01 (`latest` 4.1.3, LTS até pelo menos setembro de 2029). Só o núcleo tem semver estrito; `effect/cli`, `http`, `http-api`, `socket`, `process` e `rpc` são `@stability unstable` e podem quebrar em minor.
- **RPC invertido funciona** com construtores públicos, sem `Protocol` customizado, inclusive em binário compilado. Cancelamento, timeout, backpressure e ping já vêm embutidos.
- **`bun test` com um helper de 27 linhas** passou em tudo. `@effect/vitest` também passa quando o Vitest roda no Bun, mas essa combinação não é documentada como suportada.
- **O binário não cresce de forma relevante**: +0,85 MB sobre 109 MB.

## 1. Estado do Effect v4

| Item | Fato |
|---|---|
| Versões | 4.0.0 em 2026-10-01, 4.1.0 em 2026-10-29, 4.1.3 em 2026-11-10. A v3 ainda recebe patches (3.22.4) |
| Pacotes irmãos | `@effect/platform-bun`, `platform-node`, `vitest`, `opentelemetry`: mesma versão, sempre |
| Absorvidos em `effect` | `@effect/cli` e `@effect/platform` não têm linha 4.x; viraram `effect/cli`, `effect/http` etc. |
| Caminhos | Não existe `effect/unstable/*`; foi removido no rc.118, sem exports de compatibilidade |
| Estáveis | `Effect`, `Schema`, `Context`, `Layer`, `Stream`, `Config`, `ManagedRuntime`, `JsonSchema` |
| Unstable | `FileSystem`, `Terminal`, `Stdio`, `Path` e 100% de `cli`, `http`, `http-api`, `socket`, `process`, `rpc`, `observability` |
| Política | `unstable`: breaking em minor. `experimental`: breaking em patch. Sem tag: semver estrito |
| Cadência | 11 releases em 41 dias. A 4.1.0 quebrou `FileSystem` customizado e templates de child process |
| Guia para agentes | `AGENTS.md` e `ai-docs/` dentro do pacote publicado |

Nomes que mudaram entre o beta e a estável, e que agentes ainda erram:

| Não existe mais | Usar |
|---|---|
| `ServiceMap.Service`, `Context.Tag`, `Effect.Service` | `Context.Service` com `static layer` |
| `Schema.TaggedErrorClass`, `Data.TaggedError` | `Schema.TaggedError` |
| `Effect.catchAll`, `catchAllCause` | `Effect.catch`, `catchCause` |
| `Effect.fork`, `forkDaemon` | `forkChild`, `forkDetach` |
| `Schema.decodeUnknown`, `Union(A, B)`, `Literal("a", "b")` | `decodeUnknownEffect`, `Union([A, B])`, `Literals([...])` |

Interop de `Schema`: gera Standard Schema e JSON Schema. Não há ponte para zod.

## 2. Referências

| | OpenCode | T3 Code |
|---|---|---|
| Versão | `effect` 4.1.0 | `effect` 4.1.2 |
| Runtime | Bun, com `@effect/platform-node` | Node |
| Adoção | Backend quase todo; UI quase toda fora | Servidor quase todo; web usa atoms e `Schema` |
| CLI | `effect/cli` | `effect/cli` |
| HTTP | `HttpApi` + `HttpApiBuilder`, cliente gerado | `HttpApi` + `effect/rpc` sobre WebSocket |
| Testes | `bun:test` com helper próprio (`packages/core/test/lib/effect.ts`) | `@effect/vitest` |
| SDK público | API Promise sobre `ManagedRuntime` | n/a |
| Subprocessos | n/a | `effect/process` com `Scope` e `forceKillAfter` |

Lições que as duas registram: uma única cópia de `effect` no workspace (duas cópias quebram o decode de schemas), import dinâmico nos entrypoints por causa do tempo de startup, e `ManagedRuntime` só nas fronteiras com código não-Effect. O OpenCode precisou de um workaround para o `ws` no binário compilado por usar `platform-node` em Bun.

O T3 Code usa ACP (via um pacote próprio e privado, `effect-acp`) para Kiro, Grok e agentes do registro ACP. Para Claude, Codex, Cursor e OpenCode usa integrações nativas (`@anthropic-ai/claude-agent-sdk`, protocolo app-server do Codex, `@cursor/sdk`, `@opencode-ai/sdk`). O `effect-acp` publicado no npm é outro projeto, de outra autora.

## 3. Spike A: RPC invertido sobre WebSocket

No Gambi o participante abre o socket, mas é o hub quem chama. Logo o lado que aceita o socket é o cliente RPC e o lado que disca é o servidor RPC, o inverso do uso comum.

Versões: bun 1.4.4, `effect` e `@effect/platform-bun` 4.1.3, Linux x64.

Participante: `RpcServer.layerProtocolSocketServer` mais um `SocketServer` de 12 linhas que entrega o socket discado.

```ts
const SocketServerOverDialedSocket = Layer.effect(SocketServer.SocketServer)(Effect.gen(function*() {
  const socket = yield* Socket.Socket
  return SocketServer.SocketServer.of({
    address: NetAddress.unixPathAddress("dialed-tunnel"),
    run: (handler) => handler(socket).pipe(Effect.exit, Effect.repeat(Schedule.spaced("1 second")), Effect.andThen(Effect.never))
  })
}))

RpcServer.layer(TunnelRpcs).pipe(
  Layer.provide(TunnelHandlers),
  Layer.provide(RpcServer.layerProtocolSocketServer),
  Layer.provide(SocketServerOverDialedSocket),
  Layer.provide(BunSocket.layerWebSocket(url)),
  Layer.provide(RpcSerialization.layerJson))
```

Hub: `RpcClient.makeProtocolSocket` recebe direto o `Socket` do upgrade. O scope da requisição de upgrade é o scope do túnel.

```ts
// dentro de HttpRouter.add("GET", "/tunnel", ...)
const socket = yield* Effect.orDie(request.upgrade)
const closed = yield* Deferred.make<void>()
const base = yield* RpcClient.makeProtocolSocket({ retryPolicy: Schedule.recurs(0) }).pipe(
  Effect.provideService(Socket.Socket, socket))
const protocol: typeof base = { ...base, run: (clientId, f) => base.run(clientId, (m) =>
  m._tag === "ClientProtocolError" ? Effect.ensuring(f(m), Deferred.succeed(closed, undefined)) : f(m)) }
const client = yield* RpcClient.make(TunnelRpcs).pipe(Effect.provideService(RpcClient.Protocol, protocol))
yield* Effect.acquireRelease(Effect.sync(() => registry.participants.set(id, client)),
  () => Effect.sync(() => registry.participants.delete(id)))
yield* Deferred.await(closed)
return HttpServerResponse.empty()
```

Três ajustes que só apareceram rodando:

1. `retryPolicy: Schedule.recurs(0)` no hub. O padrão tenta reabrir para sempre, e um socket aceito não se redisca.
2. Fechar o scope pelo wrapper de `run`, não por `ConnectionHooks.onDisconnect`. Com o hook, as chamadas em voo terminam como `InterruptError` em vez de erro tipado. O wrapper depende da tag `ClientProtocolError`, que é pública mas `unstable`.
3. Fechar os túneis antes de parar o servidor. Sem isso, SIGTERM num hub com um túnel aberto leva 20 s para sair (o `gracefulShutdownTimeout` padrão do `BunHttpServer`). Com um finalizer construído depois do servidor: cerca de 30 ms.

Medições:

| Cenário | Resultado |
|---|---|
| Stream de 30 chunks a cada 100 ms | Chegam incrementalmente, atraso de 0 a 4 ms |
| Hub interrompe o consumo (`Stream.take(5)`, `Fiber.interrupt`) | Finalizer do handler roda no participante em até 3 ms |
| `Effect.timeout` no hub | `TimeoutError` no hub; finalizer do participante no mesmo milissegundo |
| 5 chamadas concorrentes no mesmo socket | Funcionam, sem mistura |
| `kill -9` no participante | Hub recebe `RpcClientError { reason: SocketCloseError, code: 1006 }` em 10 a 19 ms; o registro esvazia sozinho |
| Participante congelado (`SIGSTOP`) | Hub recebe `RpcClientError { reason: SocketReadError }` em cerca de 8 s (timeout de ping) |
| `kill -9` no hub | Participante percebe em cerca de 10 ms e redisca quando o hub volta |
| Hub congelado (`SIGSTOP`) | **Participante não percebe** em 12 s. Só o cliente RPC faz ping |
| Produtor rápido, consumidor lento | Backpressure por `Ack`: o produtor desacelera |

Formato no fio (JSON, um frame de texto por mensagem):

```
hub->participante {"_tag":"Request","id":1,"tag":"Infer","payload":{...},"traceId":"…","spanId":"…","sampled":true,"headers":[]}
participante->hub {"_tag":"Chunk","requestId":1,"values":[{...}]}
hub->participante {"_tag":"Ack","requestId":1}
participante->hub {"_tag":"Exit","requestId":1,"exit":{"_tag":"Success","value":null}}
hub->participante {"_tag":"Interrupt","requestId":2}
hub->participante {"_tag":"Ping"}   /   participante->hub {"_tag":"Pong"}
```

Não existe campo de versão do protocolo no fio. Todo `Request` leva `traceId` e `spanId`.

## 4. Spike B: binário compilado e subprocesso

- `bun build --compile` de um CLI `effect/cli` com subcomandos de hub e participante: sem workaround. 109.975.728 bytes contra 109.123.760 de um binário vazio.
- Streaming e cancelamento no binário compilado: idênticos ao código-fonte.
- `effect/process`: o filho morre ao fechar o `Scope` e ao receber SIGINT ou SIGTERM no binário (saída em 17 a 24 ms, rc 130).
- `forceKillAfter` existe em `ChildProcess.make`. Sem ele, a limpeza de um filho que ignora SIGTERM espera sem limite.
- `detached` é `true` por padrão fora do Windows. Um `kill -9` no binário deixa o filho órfão.

## 5. Spike C: runner de testes

Mesmos corpos de teste nos dois runners.

| Runner | `it.effect` + `TestClock.adjust` | Layer compartilhada | Teste live com `BunHttpServer` + WebSocket | Tempo |
|---|---|---|---|---|
| `bun test` + helper de 27 linhas | passa | passa | passa | 0,5 s |
| `@effect/vitest` 4.1.3, Vitest 5.1.0 rodando no Bun (`bun --bun vitest run`) | passa | passa | passa | 1,1 s |
| O mesmo rodando no Node | passa | passa | falha: `ReferenceError: Bun is not defined` | 1,4 a 2,2 s |

- `@effect/vitest` importado de dentro do `bun test` não funciona (`Vitest failed to find the current suite`).
- Não existe integração oficial com `bun:test`. As propostas foram fechadas sem merge (PRs #5973, #6236, #7521; issue #5964 como `not_planned`).
- O helper expõe `it.effect`, `it.live` e `layer(L)(nome, it => …)` via `ManagedRuntime` e `afterAll`. O do OpenCode é a referência.

## 6. rat-stack

`ratstack.sh` é um repositório-modelo de terceiros para apps web em Cloudflare Workers com `effect` 4.1.2. Aproveitável: a ideia de um contrato com várias projeções (CLI, HTTP, RPC), que o próprio `effect/http-api` já entrega, e os guardrails para agentes. Não aproveitável: Cloudflare, Alchemy, Foldkit, Drizzle, Better Auth, XState beta, pnpm.

## Não verificado

- Partição de rede real entre máquinas (só `SIGSTOP`), `wss`/TLS, frames binários, payloads grandes, carga com muitos participantes.
- macOS, Windows e cross-compile do binário.
- Vitest no Bun em modo watch ou coverage.
- Data ou critério para `cli`, `http` e `socket` virarem estáveis.
