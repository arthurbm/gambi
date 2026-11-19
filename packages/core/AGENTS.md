# @gambi/core

O hub, o participant runtime e o harness, sobre Effect v4 ([ADR-0007](../../docs/adr/0007-effect-as-runtime-foundation.md)). Este package é **consumido** pelo CLI e pela SDK (e, pela SDK, pela TUI); não importe nada de CLI, SDK ou TUI de volta para cá. Os schemas, o contrato do management plane, as chamadas do túnel e os erros tipados vivem em `@gambi/protocol`.

Antes de mexer aqui, leia [`docs/reference/effect-conventions.md`](../../docs/reference/effect-conventions.md): as seções do túnel, do inference plane, dos eventos de sala, dos harness participants e dos testes dizem onde cada coisa mora e as regras de cada uma. Este arquivo só dá o mapa.

## Onde as coisas estão

- `src/hub/`: o hub. `hub.ts` sobe e fecha (`Hub.layer`), `settings.ts` tem os ajustes, `management.ts` os handlers do contrato, `inference.ts` as rotas compatíveis com OpenAI, `tunnels.ts` e `tunnel-route.ts` o túnel, `participants.ts` os participantes e o status, `rooms.ts` as salas, `room-events.ts` os eventos de sala, `harness-attach.ts` e `harness-clients.ts` o attach de clientes a um harness participant, `mdns.ts` o anúncio mDNS.
- `src/participant/`: o participant runtime (`runtime.ts`), o handler que chama o provider local (`inference.ts`), a detecção de capacidades (`endpoint-capabilities.ts`) e os handlers padrão das chamadas que um tipo de participante não atende.
- `src/harness/`: o subprocesso do harness e a sessão ACP (`harness.ts`, `acp.ts`), a detecção de harness instalado (`detection.ts`, `adapters.ts`), o Workspace e os artefatos (`workspace.ts`, `artifacts.ts`) e o harness participant inteiro (`harness-participant.ts`).
- `src/fake-acp-agent.ts`: o harness `fake`, um agente ACP determinístico que roda como subprocesso e não chama modelo. O CLI o roda como `gambi __fake-acp-agent`.
- `src/testing/`: os helpers de teste (`layerHub`, `joinParticipant`, `fakeProvider`, `linkToHub`, os harnesses de fixture). Só para testes; nunca é dependência de runtime.

O `package.json` exporta os arquivos `.ts` direto, sem build: quem embute o core é o `Bun.build` da SDK e o `bun build --compile` do CLI.

## Regras de design

- **Tunnel-first**: o hub nunca origina conexão ao participante. Toda requisição passa pelo WebSocket que o próprio participante abriu. Não adicione fallback de HTTP direto ao endpoint do provider.
- **`ParticipantAuthHeaders` nunca chegam ao hub**: são uma opção de `providerInference` e de `probeEndpoint`, na máquina do participante. Nada no hub nem em `@gambi/protocol` tem campo para eles.
- **Estado mora em serviço, nunca em variável de módulo**: dois hubs no mesmo processo não enxergam as salas um do outro. `scripts/repo-guards.test.ts` reprova uma variável de módulo mutável aqui.
- **Nenhuma API `Bun.*`, nem `@effect/platform-*`**: o core depende dos serviços abstratos do `effect`, e o entrypoint (CLI, entradas de hospedagem da SDK) fornece a plataforma. O lint reprova, fora dos testes e de `src/testing/`.
- **Sem zod**: schema é `effect/Schema`, em `@gambi/protocol`.
- **O management plane é o contrato**: uma rota nova entra em `@gambi/protocol` primeiro; os handlers daqui derivam dele.

Mudança em contrato público (envelope, códigos de erro, eventos de sala, chamadas do túnel, ajustes do hub) pede a atualização listada em [`docs/reference/docs-update.md`](../../docs/reference/docs-update.md).

## Validação

```bash
bun test packages/core/src
bun run --cwd packages/core check-types
```

Os testes sobem um hub de verdade em porta livre (`layerHub`, porta `0`), um participant runtime de verdade e um provider falso em loopback. Não precisam de rede e não usam espera real: tempo é `TestClock`, e teste `live` espera um evento.
