# ADR: Effect v4 is the foundation of the core and the CLI; the tunnel speaks `effect/rpc`

**Status:** Aceito
**Data:** 2026-11-10
**Escopo:** `packages/core`, novo `packages/protocol`, `packages/cli`, `packages/sdk`, `apps/tui` (só a fronteira)

---

## Contexto

O core cresceu sobre `Promise`, timers e estado em módulo. Cinco pontos concentram a complexidade acidental: a requisição no túnel não tem timeout nem cancelamento (um cancel do cliente não avisa o participante e o contador "busy" só zera quando o túnel cai); `createHub` publica mDNS e cria timers antes de abrir a porta, sem rollback (#54); a parada do subprocesso de harness combina flag, quatro timers e uma espera sem limite; os dois runtimes de participante duplicam código e não reconectam; e erros viajam como string (#55). Cada operação do management plane é escrita quatro vezes à mão (hub, SDK, CLI, TUI).

Todos esses pontos dá para consertar em TypeScript puro. Escolhemos trocar a fundação porque o que vem a seguir (harness participants, mais subprocessos, reconexão, observabilidade) cai exatamente no que o Effect resolve por construção. Ninguém usa o Gambi em produção hoje, então a troca pode quebrar contratos e sair de uma vez. Base factual em [`docs/research/effect-v4-foundation.md`](../research/effect-v4-foundation.md).

## Decisão

1. **Effect v4 é a fundação de `@gambi/core` e da CLI.** A TUI continua em React, e a API pública do `gambi-sdk` continua em `Promise`, sem tipos do Effect nas assinaturas.
2. **`effect/Schema` substitui o zod** no core e no SDK. O SDK exporta tipos, não valores de schema.
3. **O management plane é um contrato único** (`HttpApi`) num pacote novo, `@gambi/protocol`. Handlers do hub, cliente do SDK, comandos da CLI e hooks da TUI derivam dele. O inference plane fica como rotas cruas com `Stream`, porque é passthrough compatível com OpenAI.
4. **O túnel usa `effect/rpc` sobre WebSocket, com os papéis invertidos**: o participante disca e serve; o hub aceita e chama. Isso substitui os frames próprios descritos na ADR-0003. O invariante tunnel-first não muda. Como o formato no fio passa a ser o do Effect e não tem campo de versão, o registro do participante envia a versão da CLI e o hub recusa minor diferente.
5. **Um só sinal de vida.** O status do participante deriva só do túnel. O heartbeat HTTP e o conceito separado de connection saem. O participant runtime ganha um watchdog contra hub congelado e reconexão automática com o mesmo `participantId`.
6. **A CLI passa para `effect/cli`.** O princípio agent-first da ADR-0002 continua (saída estruturada fora de TTY, nenhum prompt sem TTY, exit codes com significado); flags, texto de ajuda e formato dos eventos são livres para mudar.
7. **`@effect/platform-bun` entra só no entrypoint.** O core depende dos serviços abstratos.
8. **Os testes continuam em `bun test`**, com um helper próprio que espelha a API do `@effect/vitest` (`it.effect`, `it.live`, layer compartilhada).
9. **Versão exata de `effect` fixada, uma única cópia no workspace**, e os módulos `unstable` são aceitos. Cada bump é deliberado.
10. **Sai como 0.8.0, de uma vez**, numa branch de integração.

## Alternativas rejeitadas

- **Consertar os cinco pontos sem Effect.** Resolve os bugs de hoje e deixa a próxima leva de timers, subprocessos e reconexão sobre a mesma base.
- **Manter os frames próprios do túnel e acrescentar cancel e timeout.** Mantém o formato no fio independente da versão do Effect. Rejeitada porque o `effect/rpc` já entrega cancelamento, timeout, backpressure e ping, medidos no spike, e o acoplamento de versão é contido pela checagem no registro.
- **`@effect/vitest`.** É o runner oficial e passou no spike com o Vitest rodando no Bun. Rejeitada porque essa combinação não é documentada como suportada, os testes que sobem o servidor Bun falham quando o Vitest roda no Node, e as propostas de integração com `bun:test` foram fechadas como "not planned". O OpenCode, que é Bun com Effect em escala, usa `bun test` com helper.
- **`@effect/platform-node` rodando em Bun**, como o OpenCode. Exigiu deles um workaround para o `ws` no binário compilado.
- **Adotar o `effect-acp` do T3 Code no participant runtime.** É um pacote privado do repositório deles (cerca de 4 mil linhas à mão e 19 mil geradas do schema do ACP), então usá-lo exigiria copiar e sincronizar. O participant runtime faz três chamadas ACP (`initialize`, `session/new`, `session/close`) e repassa o resto sem interpretar; elas ficam tipadas à mão em `Schema`. Quem é cliente ACP de fato é o orquestrador do gambiarra-lab, e é lá que vale reavaliar.
- **Migração incremental em vários releases.** Só faria sentido com usuários a proteger.
- **Adotar o rat-stack ou XState.** O primeiro é um modelo para apps web em Cloudflare; o segundo está fixado em beta e não é necessário para três estados.

## Consequências

- O formato do túnel fica acoplado à versão do Effect. Hub e participantes precisam estar na mesma minor do Gambi.
- O gambiarra-lab quebra no 0.8 (túnel, SDK) e migra depois, no repositório dele.
- A decisão 3 da revisão de 2026-10-24 da ADR-0006 continua valendo: o SDK ainda expõe o participant runtime para quem hospeda harness participants. A forma (entradas separadas, só para Bun) fica na spec.
- O Bun fixado sobe de 1.3.13 para 1.4.x, que partes do `@effect/platform-bun` exigem.
- O `GLOSSARY.md` perde **Heartbeat** e **Connection** e redefine **Status** quando o código entrar.
- Agentes erram nomes do beta (`ServiceMap`, `effect/unstable/*`, `TaggedErrorClass`). O repositório precisa de um documento de convenções que aponte para o `AGENTS.md` dentro de `node_modules/effect`.
