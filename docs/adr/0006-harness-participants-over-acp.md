# ADR: Harness participants speak ACP v1 through the tunnel; orchestration lives above the hub

**Status:** Aceito
**Data:** 2026-08-22
**Escopo:** `packages/core` (tunnel frame), `packages/cli` (`join --harness`), `packages/sdk`, novo `packages/agents`, novo `apps/board`  
**Revisado:** 2026-10-24 (ver fim do documento)

---

## Contexto

Gambi compartilha endpoints de modelo numa sala. O próximo degrau é compartilhar **harnesses** (OpenCode, Claude Code, Codex, Pi): o runtime que transforma um modelo em agente (system prompt, tools, loop, translation layer). Cada harness já roda no PC da pessoa, autenticado com a conta dela. Precisávamos de (1) um protocolo uniforme entre o hub e harnesses heterogêneos e (2) um lugar para um orquestrador que decompõe trabalho e despacha para eles, com humanos revisando. Pesquisa em `docs/research/harness-orchestration-options.md` e `docs/research/acp-status-and-gas-town.md`.

## Decisão

1. Um **harness participant** é um participante comum cujo `gambi participant join --harness <id>` faz spawn do agent ACP local (`opencode acp`, `claude-agent-acp`, `codex-acp`) com `cwd` em `~/.gambi/workspaces/<room>/<participantId>/`, e encaminha as mensagens **ACP v1** (JSON-RPC) pelo túnel existente num frame opaco. O hub **relaya**; não interpreta o payload nem guarda credenciais. O mesmo processo observa o workspace e envia os arquivos alterados pelo túnel como artefato versionado.
2. **Orquestração fica fora do hub.** `packages/agents` é uma biblioteca (orquestrador como `ToolLoopAgent` do AI SDK cujas tools são os harness participants; dispatch tipado; aceitar/devolver com motivo; drafts; decisões; escalação após N devoluções). `apps/board` é a aplicação de uma experiência específica (rodadas, cidade, viewer, SQLite). O hub ganha só o relay.
3. Pinar ACP **v1** (`@agentclientprotocol/*`); negociar apenas v1 até o v2 sair do draft.

## Alternativas rejeitadas

- **`@ai-sdk/harness` + adapters.** Exige `ai@7` exato, é experimental, e os adapters bridge instalam o harness dentro de um sandbox de rede (só `@ai-sdk/sandbox-vercel` oficial) e autenticam por env var, ignorando o login local. Resolve "meu servidor cria agentes na nuvem", não "pessoas trazem seus agentes já configurados". Reavaliar depois via `@ai-sdk/harness-acp` e um sandbox provider local.
- **Interface própria + SDKs nativos de cada harness.** Quatro formatos de evento para manter; ACP já normaliza e os quatro harnesses falam.
- **Orquestração dentro do hub.** Toda mudança de dinâmica viraria mudança no protocolo público; `docs/product/vision.md` já veta.
- **Tool MCP / comando CLI para publicar artefatos.** Peça extra que o modelo precisaria aprender; observar o `cwd` é invisível para o harness e funciona igual nos três.

## Consequências

- O risco de termos de uso existe só no harness Claude Code (a Anthropic proíbe intermediar login de assinatura; o desenho fica na exceção de usuário final com binário original). Documentar no adapter; não hospedar Claude Code em nome de terceiros.
- `CONTEXT.md` ganha a seção "Harness layer" (harness, harness participant, harness session, orchestrator, steerer, squad, draft, decision, dispatch, return).
- Para o TCC: Gambi como client ACP multi-parte sobre transporte tunnel-first (ACP foi desenhado 1 client ↔ 1 agent via stdio).

---

## Revisão 2026-10-24

Decidido no grill pós-evento sobre o PR #81. A decisão 3 (ACP v1) continua valendo como está. As decisões 1 e 2 mudam assim:

1. **Onde roda: costura `Workspace`.** O `cwd` deixa de ser fixo. O runtime do participante recebe um **Workspace** com três operações: preparar a pasta, observar e coletar os artefatos. A implementação padrão é uma pasta local em `~/.gambi/workspaces/<room>/<participantId>/` que contém só `.gambi.json`, e `gambi participant join --harness` aceita `--workspace <pasta>`. O starter do evento, que vazou para o core em `harness-workspace.ts`, sai do gambi. Quem traz o próprio harness recebe conteúdo inicial pelo texto do dispatch ou pela pasta que escolheu. O túnel **não** ganha um canal para gravar arquivos no PC da pessoa, porque isso seria uma decisão de segurança à parte. Foi rejeitado usar como costura o `SandboxSession` do AI SDK v7. Ele modela o host fazendo IO dentro de um sandbox que ele controla, exige porta WebSocket alcançável (não existe pelo túnel), instala o harness dentro do sandbox (o que perde o login local) e prenderia o core à linha experimental `@ai-sdk/provider-utils@5`. Um adaptador `Workspace → SandboxSession` cabe fora do core se um dia fizer falta.
2. **Orquestração fora do hub e fora deste repositório.** `packages/agents`, `apps/board`, `apps/board-web`, os scripts do evento e o registro de 2026-08-23 vão para [`arthurbm/gambiarra-lab`](https://github.com/arthurbm/gambiarra-lab), com histórico preservado. O motivo: o evento não usou o board, o board contaminou o core e o `agents` pinava `ai ^6` tendo um único consumidor. Regras do lab: (a) o gambi nunca importa nada de lá, só o contrário; (b) nada de lá é publicado enquanto tiver um consumidor só; (c) uma primitiva sobe para um futuro "Gambi Agents" quando duas experiências a compartilham. Meira et al. é inspiração e referência, não especificação.
3. **Hospedados pelo SDK.** O `gambi-sdk` exporta `createHarnessParticipantSession` (mesmo padrão do `createParticipantSession`) e o fake ACP agent como função executável. Com isso, consumidores externos sobem harnesses hospedados e testam sem gastar modelo, sem depender do `@gambi/core`, que não é publicado.
4. **AI SDK v7.** O `gambi-sdk` 0.7.0 continua em `ai ^4 || ^5 || ^6` (provider spec 3). O lab pode usar `ai@7` apontando `@ai-sdk/openai-compatible@3` direto para o endpoint da sala e usar o `gambi-sdk` só para harness. A spec 4 no `gambi-sdk` fica para decidir em outro release.

Itens que estavam em `later.md` e são do gambi:

- **ACP v2**: continua pinado em v1. Acompanhar o draft, que muda `session/prompt` e `session/load`.
- **Git como publicação**: "contribuir = push" é mais fiel à tese do que observar a pasta. Ficou de fora por exigir git server e push em Windows. Reabrir quando um Workspace precisar publicar para mais de um leitor.

O `CONTEXT.md` mantém Harness, Harness participant, Harness session e ganha **Workspace**. O vocabulário de orquestração vai para o `CONTEXT.md` do lab.
