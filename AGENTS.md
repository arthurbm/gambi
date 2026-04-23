# AGENTS.md — Guia Operacional para Agentes de Código

Escopo: este arquivo orienta agentes que iniciam trabalho no repositório `gambi`.
Status de validação: conteúdo conferido contra o código em 2026-04-22 (branch `feat/tunnel-first-cleanup`).

## 1) Objetivo do projeto

Gambi é um sistema local-first para compartilhar endpoints LLM (OpenAI-compatible) em rede local por meio de um hub HTTP central.

Capacidades principais:
- Criar salas e registrar participantes.
- Rotear requests de inferência para participantes por ID, modelo ou aleatório.
- Monitorar eventos em tempo real via SSE.
- Observabilidade baseline de inferência (`llm.request`, `llm.complete`, `llm.error`) com métricas (`ttftMs`, `durationMs`, `*Tokens`, `tokensPerSecond`).
- Expor integração por CLI, SDK e TUI.

A arquitetura de transporte é **tunnel-first**: o participante abre um WebSocket ao hub (via rota de bootstrap) e o hub despacha requests por dentro desse túnel. O provider endpoint do participante nunca precisa ser alcançável pelo hub.

## 2) Fontes de verdade e precedência

Quando houver divergência de documentação, siga esta ordem:
1. Código-fonte atual em `packages/*` e `apps/*`.
2. Docs internas em `docs/` (`architecture.md`, `observability.md`, `release-architecture.md`, `versioning.md`).
3. Docs públicas em `apps/docs/src/content/docs/` (sobretudo `reference/api.md`, `reference/sdk.md`, `reference/cli.mdx`, `reference/observability.md`, `explanation/tunnel-first.mdx`, `architecture/overview.md`).
4. `README.md`.

Regra obrigatória:
- Se README/docs divergir do código, implemente com base no código e registre a divergência no resumo final.

## 3) Mapa do monorepo

Workspaces:
- `packages/core`: hub HTTP, sala/participante, SSE, mDNS, schemas Zod, tipos compartilhados, protocolo do túnel e runtime canônico de participante.
- `packages/cli`: workspace fonte do CLI `gambi` (workspace `private: true`); a distribuição publicada é gerada em `packages/cli/dist`.
- `packages/sdk`: quatro superfícies públicas — `createGambi()` (provider AI SDK), `createClient()` (cliente de management), `createParticipantSession()` (runtime de participante com túnel) e helpers de discovery (`discoverHubs`, `discoverRooms`, `resolveGambiTarget`).
- `apps/tui`: interface terminal (OpenTUI + React) para operação/monitoramento. Publicada como `gambi-tui` no npm.
- `apps/docs`: documentação pública (Astro Starlight).
- `packages/config`: configs TypeScript compartilhadas.

Arquivos de referência rápida:
- `packages/core/src/hub.ts` — servidor HTTP, upgrade do túnel, roteamento.
- `packages/core/src/room.ts` — estado de sala e participante.
- `packages/core/src/types.ts` — schemas Zod públicos, `HEALTH_CHECK_INTERVAL`, `PARTICIPANT_TIMEOUT`, `ParticipantConnection`, `ParticipantCapabilities`.
- `packages/core/src/tunnel-protocol.ts` — mensagens do túnel (`tunnel.request`, `tunnel.response.start/chunk/end/error`, `tunnel.ping/pong`).
- `packages/core/src/participant-session.ts` — implementação canônica de `createParticipantSession()` e close reasons.
- `packages/cli/src/cli.ts` — entrypoint e roteamento de subcomandos.
- `packages/cli/src/commands/*.ts` — definição autoritativa de flags de cada comando.
- `packages/sdk/src/provider.ts` — `createGambi()` e routing helpers.
- `packages/sdk/src/client.ts` — `createClient()` e `ClientError`.
- `packages/sdk/src/participant-session.ts` — reexport público de `createParticipantSession()` a partir do core.
- `apps/tui/src/index.tsx` — entrypoint da TUI.

## 4) Contratos e comportamentos críticos

### Endpoints HTTP do hub

Management plane (`/v1/*`):
- `GET /v1/health`
- `GET /v1/rooms`
- `POST /v1/rooms`
- `GET /v1/rooms/:code`
- `GET /v1/rooms/:code/participants`
- `PUT /v1/rooms/:code/participants/:id` — idempotente, registra/atualiza; retorna `{ participant, roomId, tunnel: { url, token } }`.
- `DELETE /v1/rooms/:code/participants/:id`
- `POST /v1/rooms/:code/participants/:id/heartbeat`
- `GET /v1/rooms/:code/participants/:id/tunnel?token=...` — upgrade WebSocket; token single-use, TTL 60 s.
- `GET /v1/rooms/:code/events` (SSE)

Inference plane (OpenAI-compatible, escopada por sala):
- `GET /rooms/:code/v1/models`
- `POST /rooms/:code/v1/responses` (padrão — OpenAI Responses API)
- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`
- `POST /rooms/:code/v1/chat/completions` (compatibilidade)

### Roteamento de modelo

O campo `model` escolhe o participante:
- `<participant-id>`: participante específico.
- `model:<nome-do-modelo>`: primeiro participante disponível que expõe esse modelo.
- `*` ou `any`: participante disponível aleatório.

Um participante é "disponível" apenas quando: túnel conectado, status não offline e não está atendendo outra request.

### Túnel e transporte

- O hub **nunca** origina conexão ao participante; é o participante que abre o WebSocket.
- Headers de auth do participante (`ParticipantAuthHeaders`) nunca deixam o runtime do participante — aplicados só ao chamar o provider local.
- `createParticipantSession()` é implementado em `packages/core/src/participant-session.ts`; a SDK reexporta como superfície pública e o CLI `gambi participant join` usa a implementação do core.
- Close reasons do runtime: `"closed"`, `"heartbeat_failed"`, `"tunnel_closed"`.
- Mensagens do protocolo do túnel vivem em `packages/core/src/tunnel-protocol.ts` e são validadas via Zod em ambas as pontas.

### Health e disponibilidade

- `HEALTH_CHECK_INTERVAL = 10_000` ms — cadência de heartbeat do management e de ping/pong do túnel.
- `PARTICIPANT_TIMEOUT = HEALTH_CHECK_INTERVAL * 3 = 30_000` ms — janela após a qual o hub marca o participante offline.
- Fonte: `packages/core/src/types.ts`.

### Estado de conexão do participante

Todo payload público de participante expõe:
```
connection: { kind: "tunnel", connected: boolean, lastTunnelSeenAt: number | null }
```
`status` e `connection.connected` são ortogonais: um participante pode estar "registrado mas sem túnel".

### Códigos de erro do management

Retornados via envelope `{ error: { code, message, hint } }`:
- `ROOM_NOT_FOUND`
- `PARTICIPANT_NOT_FOUND`
- `INVALID_REQUEST`
- `INVALID_PASSWORD`
- `ENDPOINT_NOT_REACHABLE`
- `PARTICIPANT_CONFLICT`
- `PARTICIPANT_BUSY`
- `PARTICIPANT_TUNNEL_NOT_CONNECTED`
- `MODEL_NOT_FOUND`
- `INTERNAL_ERROR`

Cliente SDK lança `ClientError` com `status`, `code`, `hint`, `details` e `requestId`.

### Observabilidade (baseline)

SSE room events:
- `connected`, `room.created`, `participant.joined`, `participant.updated`, `participant.left`, `participant.offline`
- `llm.request`, `llm.complete`, `llm.error`

`llm.complete.metrics` inclui: `ttftMs`, `durationMs`, `inputTokens`, `outputTokens`, `totalTokens`, `tokensPerSecond`. Contagens de token podem faltar quando o provider upstream não expõe `usage` em streaming.

Fonte pública: `apps/docs/src/content/docs/reference/observability.md`. Fonte interna: `docs/observability.md`.

### CLI

- `gambi` sem argumentos exibe help com referência ao `gambi-tui`.
- Comandos (resource-oriented):
  - `gambi hub serve`
  - `gambi room create|list|get`
  - `gambi participant join|leave|heartbeat`
  - `gambi events watch`
  - `gambi self update`
- Todos os comandos herdam flags globais do `AgentCommand` base:
  - `--format text|json|ndjson` (stdout pipeado escolhe `json` ou `ndjson` por padrão; comandos streaming coagem `json` → `ndjson`)
  - `--env <name>` (lê de `~/.config/gambi/config.json`, respeita `XDG_CONFIG_HOME`)
  - `--interactive` / `--no-interactive`
  - `--verbose` / `--quiet`
- Variáveis de ambiente:
  - `GAMBI_FORMAT` — fallback para `--format`
  - `GAMBI_ENV` — fallback para `--env`
  - `GAMBI_NO_INTERACTIVE=1` — desliga prompts em qualquer lugar
  - `XDG_CONFIG_HOME` — redefine base do `~/.config/gambi/config.json`
- Exit codes:
  - `0` sucesso
  - `1` falha interna inesperada
  - `2` uso inválido (flag faltando, valor ruim, `400`/`422` do hub)
  - `3` dependência/conectividade (`401`/`403`/`503`, hub inacessível)
  - `4` rejeição remota (`404`/`409` do hub)
- `gambi participant join` exige `--participant-id` para fluxos não interativos retry-safe e é implementado em cima de `createParticipantSession()`.
- `gambi self update` atualiza via `bun`, `npm` ou binário standalone.

### Contratos operacionais

- O management plane em `/v1` é a superfície canônica para automação.
- SDK de operação mapeia diretamente para os contratos do core; não inventar rotas paralelas.
- O CLI renderiza sobre contratos estruturados do core, sem criar contratos textuais paralelos.
- `createGambi()` e `createClient()` são explícitos: não adicionar discovery implícito nessas factories.
- Discovery (`discoverHubs`, `discoverRooms`, `resolveGambiTarget`) vive em `packages/sdk/src/discovery.ts` e usa mDNS + management API.
- Compatibilidade retroativa não é um requisito padrão quando houver pedido explícito de clean break.

## 5) Setup e comandos oficiais

Setup inicial:
```bash
bun install
```

Comandos na raiz:
```bash
bun run dev                 # hub (gambi hub serve)
bun run dev:hub             # idem
bun run dev:cli -- --help   # qualquer subcomando do CLI
bun run dev:tui             # roda apps/tui diretamente
bun run dev:monitor         # alias para TUI (monitor view)
bun run dev:docs            # docs Astro Starlight
bun run build               # turbo build
bun run check-types         # turbo check-types
bun x ultracite check
bun x ultracite fix
```

Fluxo de dev na raiz:
- `bun run dev` e `bun run dev:hub` iniciam o hub com `gambi hub serve`.
- `bun run dev:cli -- <subcomando...>` é o entrypoint padrão para testar qualquer subcomando do CLI a partir da raiz.
- `bun run dev:monitor` aponta para a TUI; não existe comando plano `monitor` no CLI.
- Não reintroduzir scripts raiz com comandos removidos como `serve`, `create`, `join`, `list`, `update` ou `monitor` sem namespace de recurso.

Comandos por workspace:
```bash
# Core
bun run --cwd packages/core check-types

# CLI
bun run --cwd packages/cli dev
bun run --cwd packages/cli dev -- --help
bun run --cwd packages/cli build
bun run --cwd packages/cli check-types

# SDK
bun run --cwd packages/sdk build
bun run --cwd packages/sdk check-types

# TUI
bun run --cwd apps/tui dev
bun run --cwd apps/tui build
bun run --cwd apps/tui test

# Docs
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
```

## 6) Fluxo padrão de execução para agentes

Passo 1 — localizar impacto antes de editar:
- Mapear arquivos com a ferramenta Grep/Glob (evitar `rg`/`find` diretos).
- Confirmar contrato no código-fonte antes de seguir docs.
- Identificar se a mudança afeta API pública, comportamento runtime, docs ou testes.

Passo 2 — editar com delta mínimo:
- Alterar apenas arquivos estritamente relacionados.
- Evitar refatorações paralelas sem necessidade funcional.
- Preservar compatibilidade de API quando não houver pedido explícito de breaking change.

Passo 3 — validar por área tocada:
- Mudou `packages/core`: rodar `bun test packages/core/src` e `check-types` do core.
- Mudou `packages/cli`: validar `--help`, rodar o comando afetado, `check-types` do CLI e, se tocar distribuição, o build.
- Mudou `packages/sdk`: rodar `bun test packages/sdk/src` e `check-types` do sdk.
- Mudou discovery do SDK: revisar `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/architecture.md`.
- Mudou `apps/tui`: rodar `bun run --cwd apps/tui test`.
- Mudou contratos HTTP/tipos públicos: revisar `README.md`, `docs/architecture.md`, `apps/docs/src/content/docs/reference/api.md` e as docs relacionadas (`reference/sdk.md`, `reference/cli.mdx`, `reference/observability.md`).
- Mudou protocolo do túnel: revisar `docs/architecture.md` e `apps/docs/src/content/docs/architecture/overview.md`.

Passo 4 — registrar resultado:
- Informar exatamente quais comandos rodaram.
- Informar falhas ambientais (ex.: porta em uso) separadas de falhas de produto.

## 7) Matriz de validação recomendada

Validação mínima (rápida):
```bash
bun run check-types
bun run --cwd apps/tui test
```

Validação direcionada de testes:
```bash
bun test packages/core/src
bun test packages/sdk/src
bun run --cwd apps/tui test
```

Observação importante de ambiente:
- Testes de `core` e `sdk` iniciam hub em portas fixas (ex.: 3998/3999) e podem falhar se a porta estiver ocupada.

## 8) Regras de qualidade e segurança

Qualidade:
- Seguir padrão Ultracite/Biome.
- Não deixar logs de debug em código final.
- Rodar `bun x ultracite fix` ao final de um EPIC, não após cada task individual.

Segurança e contexto de produto:
- Projeto orientado a rede local confiável.
- Hub sem autenticação nativa.
- Evitar introduzir exposição pública sem proxy/autenticação externa.
- `ParticipantAuthHeaders` nunca devem ser reenviadas para fora do runtime do participante.

## 9) Guardrails de edição e Git

Obrigatório:
- Não reverter mudanças do usuário que não fazem parte da tarefa.
- Não executar comandos destrutivos sem solicitação explícita.
- Não assumir árvore limpa.
- Se detectar mudanças inesperadas novas durante a tarefa, pausar e reportar.
- Usar **Conventional Commits** em todo novo commit (`tipo(escopo): resumo`), por exemplo `fix(cli): tratar cancelamento em prompts`.

## 10) Inconsistências conhecidas (documentar, não ignorar)

- Alguns READMEs de workspace estão placeholders e não refletem comportamento real; a documentação autoritativa vive em `apps/docs/src/content/docs/`.
- `packages/core/src/endpoint-capabilities.test.ts` tem um teste historicamente falho (`probeEndpoint > does not detect protected endpoints without auth headers`) — não introduzido por tarefas recentes.

## 11) Atualização de documentação ao mudar comportamento

Sempre que houver mudança de contrato público, atualizar no mesmo PR:

Docs internas (`docs/`):
- `architecture.md` para arquitetura e fluxos.
- `observability.md` se houver mudança em eventos/métricas.
- `versioning.md` se houver mudança no processo de release/versionamento.
- `release-architecture.md` se houver mudança na distribuição/publicação do CLI.

Docs públicas (`apps/docs/src/content/docs/`):
- `reference/api.md` para endpoints.
- `reference/sdk.md` para superfícies do SDK.
- `reference/cli.mdx` para comandos e flags.
- `reference/observability.md` para eventos e métricas.
- `architecture/overview.md` para o modelo mental.
- `explanation/tunnel-first.mdx` para racional do transporte.
- `guides/custom-participant.mdx` se mexer em `createParticipantSession()`.
- `guides/quickstart.mdx` e `guides/remote-providers.md` para UX de uso.

Raiz:
- `README.md` para UX geral.

## 11.1) Processo de release do CLI

Arquitetura atual do CLI:
- `packages/cli` é um workspace `private: true` com o código-fonte do CLI.
- O pacote npm público `gambi` e os pacotes `gambi-<os>-<arch>` são gerados em `packages/cli/dist/npm`.
- Os assets de GitHub Release são gerados em `packages/cli/dist/releases`.

Fluxo oficial:
- Fonte de verdade do release: `.github/workflows/release.yml` e `scripts/publish.ts`.
- O workflow captura um commit de origem, calcula uma versão sincronizada, builda o CLI uma vez, reutiliza esse artifact no publish npm e depois publica os mesmos binários no GitHub Release.
- Ordem obrigatória de publish: `gambi-sdk` → `gambi-tui` → pacotes binários do CLI → wrapper `gambi`.
- O workflow oficial publica sempre o conjunto sincronizado; não fazer release parcial de `sdk`, `tui` ou `cli`.
- Não fazer bump manual de versão em PRs normais; deixe isso para o workflow de release.

Autenticação npm:
- O publish usa um **granular access token** armazenado como secret `NPM_TOKEN` no repositório GitHub.
- O workflow passa `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` para o step de publish.
- Cada pacote no npmjs.com deve permitir granular access tokens (com 2FA bypass) nas configurações de publishing access.
- Ao adicionar um novo pacote npm ao repo, configurar publishing access no npmjs.com e garantir que `NPM_TOKEN` tenha acesso ao novo pacote.

Validação recomendada quando tocar distribuição/release:
```bash
bun run --cwd packages/cli check-types
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
node ./packages/cli/dist/npm/gambi/bin/gambi --version
```

## 12) Skills locais disponíveis para agentes

Quando aplicável:
- Use skill `opentui` para tarefas de TUI (`apps/tui`).
- Use skill `documentation-writer` para tarefas de documentação (Diátaxis).
- Use `skill-creator` apenas para criar/editar skills (`SKILL.md`).
- Use `skill-installer` apenas para instalar skills no ambiente Codex.

## 13) Definição de pronto para tarefas de agente

Uma tarefa só está pronta quando:
- Requisitos funcionais foram implementados sem escopo colateral.
- Validações relevantes foram executadas ou bloqueios foram explicitados.
- Documentação foi atualizada se houve mudança de contrato/comportamento (ver seção 11).
- Resumo final inclui arquivos alterados, comandos executados e riscos pendentes.

## 14) Code Standards

Este projeto usa **Ultracite** (preset zero-config em cima do Biome).

Referência rápida:
- Formatar: `bun x ultracite fix`
- Checar: `bun x ultracite check`
- Diagnóstico: `bun x ultracite doctor`

Biome cobre a maior parte de formatação e lint automáticos. O que ele não cobre e você deve olhar manualmente:
1. Corretude de lógica de negócio.
2. Naming significativo (funções, variáveis, tipos).
3. Decisões arquiteturais (estrutura de componentes, fluxo de dados, API design).
4. Edge cases e estados de erro.
5. UX (acessibilidade, performance, usabilidade).
6. Documentação — prefira código auto-explicativo e adicione comentário só quando o "porquê" não for óbvio.

Rode `bun x ultracite fix` antes de commitar para garantir compliance. Em EPICs grandes, rode só ao final para não interromper o fluxo.

## 15) Notas de ambiente

- Nenhum Docker, banco ou serviço externo é necessário — todo estado é em memória.
- Se `bun` não estiver no `PATH` (Cursor Cloud e ambientes similares): `export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH"`.
