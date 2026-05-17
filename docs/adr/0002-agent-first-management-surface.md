# ADR: Agent-First Management Surface (CLI + HTTP + SDK)

**Status:** Aceito (implementado)
**Data:** 2026-04-14 (decidido) / 2026-05-17 (registrado como ADR)
**Escopo:** `packages/cli`, `packages/core` (management plane), `packages/sdk`

---

## 1. Contexto

Antes deste redesign, a superfície operacional do Gambi era inconsistente entre camadas:

- **CLI** usava verbos flat (`serve`, `create`, `join`, `list`, `update`, `monitor`) sem agrupamento por recurso, com prompts interativos misturados ao caminho de controle.
- **Management HTTP API** não tinha envelope padronizado, error codes determinísticos, nem versionamento explícito. As respostas eram ad-hoc por endpoint.
- **SDK** expunha um `createClient()` flat misturando inference (chamar modelos) com management (criar salas, registrar participantes), sem deixar claro qual público servia.

Isso impedia uso por agentes/scripts: cada camada inventava seu próprio contrato implícito, retries não eram seguros, e prompts interativos vazavam para fluxos automatizados.

A direção do produto (ver [`docs/product/vision.md`](../product/vision.md)) é ser substrato/transport para experiências multi-LLM — incluindo agentes consumindo a hub programaticamente. Sem uma superfície agent-first, o produto não conseguiria suportar esse uso primário.

---

## 2. Decisão

Redesenhar **as três camadas (CLI + HTTP + SDK) juntas como sistema agent-first**, tratando a management plane como contrato público de primeira classe.

### D1 — Clean break, sem camada de compatibilidade

Nenhum alias para comandos flat antigos. Nenhuma rota não-versionada preservada. Nenhum método SDK antigo mantido. A migração é hard cut.

**Rejeitadas:**
- *Manter aliases dos comandos antigos* — perpetuaria o contrato implícito; agentes ficariam confusos sobre qual forma é canônica.
- *Versionar lado-a-lado (`/v0` + `/v1`)* — dobra superfície de teste sem ganho real; o produto era jovem o suficiente pra absorver o break.

### D2 — Split em management plane e inference plane

- **Management plane:** rooms, participants, health, events, status. Contratos Gambi-native, sob `/v1`.
- **Inference plane:** `/v1/models`, `/v1/responses*`, `/v1/chat/completions`. OpenAI-compatible, sem envelope Gambi por cima (compatibilidade exige passagem transparente).

A documentação trata as duas planes separadamente.

### D3 — CLI resource-oriented com saída estruturada

Comandos agrupados por recurso (`gambi hub serve`, `gambi room create/list/get`, `gambi participant join/leave/heartbeat`, `gambi events watch`, `gambi self update`).

Contrato global:
- Flags `--format text|json|ndjson`, `--interactive`, `--no-interactive`, `--env`, `--verbose`, `--quiet`.
- Defaults baseados em TTY: piped → `json` ou `ndjson`; TTY → `text`.
- Exit codes determinísticos (`0` ok, `1` interno, `2` uso inválido, `3` conectividade, `4` rejeição remota/conflito).
- Prompts proibidos em comandos automatizáveis; `room create`/`participant join` só promptam quando `--interactive` está em efeito e o caminho TTY permite.

### D4 — Envelopes HTTP padronizados e error codes determinísticos

Todas as respostas management seguem:
- Sucesso objeto: `{ "data": {...}, "meta": {...} }`
- Sucesso lista: `{ "data": [...], "meta": {...} }`
- Erro: `{ "error": { "code", "message", "hint", "details" }, "meta": { "requestId" } }`

Error codes explícitos (`ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`, `INVALID_REQUEST`, `INVALID_PASSWORD`, `ENDPOINT_NOT_REACHABLE`, `LOOPBACK_ENDPOINT_FOR_REMOTE_HUB`, `PARTICIPANT_CONFLICT`, `MODEL_NOT_FOUND`) são a base do mapeamento determinístico para exit codes da CLI e exceções tipadas do SDK.

### D5 — Idempotência onde retries fazem sentido

`PUT /v1/rooms/:code/participants/:id` substitui a semântica antiga de join:
- Ausente → cria (201)
- Presente, sem mudança material → 200 com mesma representação
- Presente, com mudança → 200 atualizado

Isso permite que agentes e long-running automation retentem com segurança.

`room create` permanece não-idempotente por design (criação é decisão humana/agente explícita).

### D6 — Eventos SSE tipados

Todo evento SSE management carrega `{ type, timestamp, roomCode, data }`. Tipos canônicos: `connected`, `room.created`, `participant.joined`, `participant.updated`, `participant.left`, `participant.offline`.

A CLI (`events watch --format ndjson`) relai esses eventos sem reinterpretação. O SDK expõe `client.events.watchRoom(...)` consumindo o mesmo contrato.

### D7 — SDK split por audiência

- `createGambi()` — inference-focused, para apps usando AI SDK / OpenAI-compatible tooling.
- `createClient()` (management) — namespaced (`client.rooms.*`, `client.participants.*`, `client.events.*`), retornos estruturados, `ClientError` tipado com `status`, `code`, `hint`, `details`, `requestId`.

A regra documentada: use `createGambi()` para mandar requests de modelo; use o management client para operar (criar salas, registrar participantes, observar eventos).

---

## 3. Consequências

**Positivas:**
- Agentes podem executar fluxo completo (start hub → create room → register participant → heartbeat → watch events → cleanup) sem prompts.
- Saída JSON/NDJSON estável permite pipes, log processors e tooling.
- Error envelope deixa o "porquê" do erro explícito, viabilizando user guidance e retries inteligentes do lado do SDK.
- Idempotência em `participants` remove classes inteiras de bugs de retry em automação.
- Inference plane permanece OpenAI-compatible, então tooling existente (AI SDK, OpenAI SDK, curl) continua funcionando sem adaptador.

**Negativas / aceitas:**
- Hard cut quebra qualquer integração que dependia das rotas antigas ou comandos flat. Aceito porque o produto era jovem e a base de usuários era pequena.
- A superfície pública dobra em "obrigações de estabilidade" (envelope, error codes, tipos de evento, exit codes) — qualquer mudança incompatível agora precisa de versionamento explícito.

**Guardrails operacionais:**
- Não reintroduzir comandos flat (`serve`, `create`, `join`, `list`, `update`, `monitor`) sem namespace de recurso. Esta proibição está registrada em [`docs/agents/commands.md`](../agents/commands.md).
- Doc updates obrigatórias quando esta superfície muda: ver [`docs/agents/docs-update.md`](../agents/docs-update.md).

---

## 4. Estado atual (referência)

Para o contrato concreto vigente, ver:
- [`docs/reference/architecture.md`](../reference/architecture.md) — modelo conceitual das duas planes.
- [`docs/reference/contracts.md`](../reference/contracts.md) — envelopes, error codes, eventos SSE, runtime constants, CLI flags/exit codes/env vars.
- `apps/docs/src/content/docs/reference/{cli,api,sdk}.{mdx,md}` — docs públicas.

---

## 5. Origem

Esta ADR foi extraída em 2026-05-17 do plano `docs/plan-agent-first-cli-http-sdk.md` (criado 2026-04-14, executado nas semanas seguintes; removido após extração). O conteúdo deste ADR reflete as decisões já implementadas, não trabalho futuro.
