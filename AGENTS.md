# AGENTS.md - Guia Operacional para Agentes de Código

Escopo: este arquivo orienta agentes que iniciam trabalho no repositório `gambi`.
Status de validação: conteúdo conferido no código em 2026-03-18.

## 1) Objetivo do projeto

Gambi é um sistema local-first para compartilhar endpoints LLM (OpenAI-compatible) em rede local por meio de um hub HTTP central.

Capacidades principais:
- Criar salas e registrar participantes.
- Rotear requests de chat para participantes por ID, modelo ou aleatório.
- Monitorar eventos em tempo real via SSE.
- Expor integração por CLI, SDK e TUI.

## 2) Fontes de verdade e precedência

Quando houver divergência de documentação, siga esta ordem:
1. Código-fonte atual em `packages/*` e `apps/*`.
2. `docs/architecture.md`.
3. `README.md`.

Regra obrigatória:
- Se README/docs divergir do código, implemente com base no código e registre a divergência no resumo final.

## 3) Mapa do monorepo

Workspaces:
- `packages/core`: hub HTTP, sala/participante, SSE, mDNS e schemas/tipos.
- `packages/cli`: workspace fonte do CLI `gambi`; a distribuição publicada é gerada em `packages/cli/dist`.
- `packages/sdk`: provider para AI SDK, cliente HTTP e discovery opcional de hubs/salas para apps locais Node/Bun.
- `apps/tui`: interface terminal (OpenTUI + React) para operação/monitoramento. Publicado como `gambi-tui` no npm.
- `apps/docs`: documentação (Astro Starlight).
- `packages/config`: configs TypeScript compartilhadas.

Arquivos de referência rápida:
- `packages/core/src/hub.ts`
- `packages/core/src/room.ts`
- `packages/core/src/types.ts`
- `packages/cli/src/cli.ts`
- `packages/sdk/src/provider.ts`
- `apps/tui/src/index.tsx`

## 4) Contratos e comportamentos críticos

Endpoints do hub (HTTP):
- `POST /rooms`
- `GET /rooms`
- `POST /rooms/:code/join`
- `DELETE /rooms/:code/leave/:id`
- `POST /rooms/:code/health`
- `GET /rooms/:code/participants`
- `GET /rooms/:code/v1/models`
- `POST /rooms/:code/v1/chat/completions`
- `GET /rooms/:code/events` (SSE)
- `GET /health`

Roteamento de modelo no proxy:
- `model = <participant-id>`: participante específico.
- `model = model:<nome-do-modelo>`: primeiro participante online que casa.
- `model = *` ou `any`: participante online aleatório.

Health e disponibilidade:
- `HEALTH_CHECK_INTERVAL = 10_000` ms.
- `PARTICIPANT_TIMEOUT = 30_000` ms.
- Fonte: `packages/core/src/types.ts`.

Comportamento do CLI:
- `gambi` sem argumentos exibe help com referencia ao `gambi-tui`.
- Subcomandos registrados hoje: `serve`, `create`, `join`, `list`, `update`.
- Todos os comandos suportam modo interativo: quando rodados sem flags obrigatorias em TTY, promptam o usuario via `@clack/prompts`.
- Flags continuam funcionando normalmente para scripting e automacao.
- `gambi update` atualiza instalacoes via `bun`, `npm` ou binario standalone do instalador oficial.
- No modo interativo do `join`, o usuario seleciona provedor LLM (Ollama, LM Studio, vLLM ou custom) e modelo de uma lista.

## 5) Setup e comandos oficiais

Setup inicial:
```bash
bun install
```

Comandos na raiz:
```bash
bun run dev
bun run dev:hub
bun run dev:tui
bun run dev:docs
bun run build
bun run check-types
bun x ultracite check
bun x ultracite fix
```

Comandos por workspace:
```bash
# Core
bun run --cwd packages/core check-types

# CLI
bun run --cwd packages/cli dev
bun run --cwd packages/cli build
bun run --cwd packages/cli check-types

# SDK
bun run --cwd packages/sdk build
bun run --cwd packages/sdk check-types

# Discovery do SDK
# `discoverHubs()`, `discoverRooms()` e `resolveGambiTarget()` vivem na SDK.
# `createGambi()` e `createClient()` continuam explicitos; nao adicionar discovery implicito nessas factories sem pedido explicito.

# TUI
bun run --cwd apps/tui dev
bun run --cwd apps/tui build
bun run --cwd apps/tui test

# Docs
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
```

## 6) Fluxo padrão de execução para agentes

Passo 1: localizar impacto antes de editar
- Mapear arquivos com `rg`.
- Confirmar contrato no código-fonte antes de seguir README.
- Identificar se muda API publica, comportamento runtime, docs ou testes.

Passo 2: editar com delta minimo
- Alterar apenas arquivos estritamente relacionados.
- Evitar refatoracoes paralelas sem necessidade funcional.
- Preservar compatibilidade de API quando nao houver pedido explicito de breaking change.

Passo 3: validar por area tocada
- Mudou `packages/core`: rodar testes de core e `check-types` de core.
- Mudou `packages/cli`: validar `--help`, comando afetado, `check-types` do CLI e o build de distribuição.
- Mudou `packages/sdk`: rodar testes de sdk e `check-types` de sdk.
- Mudou discovery do SDK: revisar `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md` e `docs/architecture.md`.
- Mudou `apps/tui`: rodar `bun run --cwd apps/tui test`.
- Mudou contratos HTTP/tipos publicos: revisar `README.md` e `docs/architecture.md`.

Passo 4: registrar resultado
- Informar exatamente quais comandos rodaram.
- Informar falhas ambientais (ex.: porta em uso) separadas de falhas de produto.

## 7) Matriz de validacao recomendada

Validacao minima (rapida):
```bash
bun run check-types
bun run --cwd apps/tui test
```

Validacao direcionada de testes:
```bash
bun test packages/core/src
bun test packages/sdk/src
bun run --cwd apps/tui test
```

Observacao importante de ambiente:
- Testes de `core` e `sdk` iniciam hub em portas fixas (ex.: 3998/3999) e podem falhar se a porta estiver ocupada.

## 8) Regras de qualidade e seguranca

Qualidade:
- Seguir padrao Ultracite/Biome.
- Seguir `CLAUDE.md` da raiz para estilo e processo.
- Nao deixar logs de debug em codigo final.

Seguranca e contexto de produto:
- Projeto orientado a rede local confiavel.
- Hub atualmente sem autenticacao nativa.
- Evitar introduzir exposicao publica sem proxy/autenticacao externa.

## 9) Guardrails de edicao e Git

Obrigatorio:
- Nao reverter mudancas do usuario que nao fazem parte da tarefa.
- Nao executar comandos destrutivos sem solicitacao explicita.
- Nao assumir arvore limpa.
- Se detectar mudancas inesperadas novas durante a tarefa, pausar e reportar.

## 10) Inconsistencias conhecidas (documentar, nao ignorar)

- `README.md` referencia `.claude/CLAUDE.md`, mas o arquivo de padroes existente esta na raiz como `CLAUDE.md`.
- Alguns READMEs de workspace estao placeholders e nao refletem comportamento real.

## 11) Atualizacao de documentacao ao mudar comportamento

Sempre que houver mudanca de contrato publico, atualizar no mesmo PR:
- `README.md` para UX de uso.
- `docs/architecture.md` para arquitetura e fluxos.
- `docs/versioning.md` se houver mudanca de processo de release/versionamento.
- `docs/release-architecture.md` se houver mudanca relevante na arquitetura de distribuicao/publicacao do CLI.

## 11.1) Processo de release do CLI

Arquitetura atual do CLI:
- `packages/cli` e um workspace `private: true` com o codigo-fonte do CLI.
- O pacote npm publico `gambi` e os pacotes `gambi-<os>-<arch>` sao gerados em `packages/cli/dist/npm`.
- Os assets de GitHub Release sao gerados em `packages/cli/dist/releases`.

Fluxo oficial:
- Fonte de verdade do release: `.github/workflows/release.yml` e `scripts/publish.ts`.
- O workflow captura um commit de origem, calcula uma versao sincronizada, builda o CLI uma vez, reutiliza esse artifact no publish npm e depois publica os mesmos binarios no GitHub Release.
- Ordem obrigatoria de publish: `gambi-sdk` → `gambi-tui` → pacotes binarios do CLI → wrapper `gambi`.
- O workflow oficial de release publica sempre o conjunto sincronizado de pacotes; nao fazer release parcial de `sdk`, `tui` ou `cli`.
- Nao fazer bump manual de versao em PRs normais; deixe isso para o workflow de release.

Autenticacao npm:
- O publish usa um **granular access token** armazenado como secret `NPM_TOKEN` no repositorio GitHub.
- O workflow passa `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` para o step de publish.
- Cada pacote no npmjs.com deve permitir granular access tokens (com 2FA bypass) nas configuracoes de publishing access.
- Ao adicionar um novo pacote npm ao repo, configurar as permissoes de publishing access no npmjs.com e garantir que o token `NPM_TOKEN` tenha acesso ao novo pacote.

Validacao recomendada quando tocar distribuicao/release:
```bash
bun run --cwd packages/cli check-types
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
node ./packages/cli/dist/npm/gambi/bin/gambi --version
```

## 12) Skills locais disponiveis para agentes

Quando aplicavel:
- Use skill `opentui` para tarefas de TUI (`apps/tui`).
- Use `skill-creator` apenas para criar/editar skills (`SKILL.md`).
- Use `skill-installer` apenas para instalar skills no ambiente Codex.

## 13) Definicao de pronto para tarefas de agente

Uma tarefa so esta pronta quando:
- Requisitos funcionais foram implementados sem escopo colateral.
- Validacoes relevantes foram executadas ou bloqueios foram explicitados.
- Documentacao foi atualizada se houve mudanca de contrato/comportamento.
- Resumo final inclui arquivos alterados, comandos executados e riscos pendentes.

## 14) Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

## Cursor Cloud specific instructions

If `bun` is not on `PATH`, run `export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH"`.

No Docker, databases, or external services are required — all state is in-memory. See section 5 for all commands.

Known pre-existing issues (not environment-related):
- 1 failing test in `packages/core/src/endpoint-capabilities.test.ts` (`probeEndpoint > does not detect protected endpoints without auth headers`).
- `bun x ultracite check` reports formatting issues in `packages/cli/src`.
