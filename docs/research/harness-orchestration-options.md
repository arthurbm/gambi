# Orquestração de harnesses de agentes: opções de biblioteca

**Status:** pesquisa, 2026-08-22. Gerado por agente a partir de fontes primárias (código no GitHub, docs oficiais, `npm view`). Versões citadas são as do dia.
**Contexto:** [`../product/vision.md`](../product/vision.md) (Gambi Agents), [`../product/research-direction.md`](../product/research-direction.md) (camada social / TCC), [`../adr/0003-tunnel-first-transport.md`](../adr/0003-tunnel-first-transport.md).
**Pergunta:** o Gambi quer subir uma camada — além de compartilhar modelos, compartilhar e orquestrar *harnesses* (OpenCode, Claude Code, Codex, Pi) que rodam no PC de cada pessoa, já autenticados. Que biblioteca usar para (1) falar com cada harness de forma uniforme e (2) construir o orquestrador, dado que o Gambi usa AI SDK?

## TL;DR

- **(1) Camada uniforme:** **ACP** (`@agentclientprotocol/sdk` 1.4.0). Os quatro harnesses já falam ACP (OpenCode nativo; Claude Code e Codex via adapters oficiais da org ACP; Pi via adapter comunitário), todos rodando no PC da pessoa com o login local. É JSON-RPC NDJSON — cabe dentro do túnel WebSocket do Gambi sem tradução.
- **`@ai-sdk/harness` não é a resposta para amanhã.** Exige AI SDK v7 (o Gambi está em v6), é experimental, e os adapters de Claude/Codex/OpenCode instalam o harness *dentro* de um sandbox e ignoram o login local. O "sandbox de rede" é só "um lugar com FS + `spawn` + porta WebSocket alcançável" — dá para fazer um provider local em 2-3 h (já existe um: `@openagentsinc/ai-sdk-sandbox-local`), mas isso resolve o problema errado: você ganha os bridges da Vercel, que são wrappers dos mesmos SDKs nativos de (b), e perde a autenticação local.
- **(2) Orquestrador:** AI SDK que já está no repo (`ToolLoopAgent`/`streamText` + tools), com cada squad exposto como tool que faz `session/prompt` via túnel. Frameworks (LangGraph, Mastra, OpenAI Agents) só acrescentam HITL durável — não para amanhã; Mastra é o candidato se o TCC quiser grafo com `suspend/resume`.
- **Flue** e **eve** são frameworks para *construir* agents (Flue sobre Pi, eve sobre AI SDK + Workflow DevKit), não para orquestrar harnesses de terceiros. Fora.

## Tabela comparativa

| Candidato | Versão / licença | Uniformiza os 4 harnesses? | Reusa login local? | Depende de nuvem? | Custo de adoção no Gambi | Veredito |
|---|---|---|---|---|---|---|
| (a) `@ai-sdk/harness` + adapters | 1.0.85 / Apache-2.0, **experimental** | Sim (Claude, Codex, OpenCode, Pi, Cline, ACP genérico) → stream parts AI SDK | **Não** (só env vars / API key; HOME sobrescrito com skills) | Não obrigatória, mas desenhado para Vercel Sandbox; precisa de sandbox provider local (não oficial) | Alto: migrar para `ai@7`, sandbox provider local, bootstrap `pnpm install` em cada PC | TCC talvez; amanhã não |
| (b) SDKs nativos (4×) | OpenCode 1.18.21 MIT; Claude SDK 0.3.239 ToS; Codex SDK 0.149.0 Apache; Pi 0.84.2 MIT | Não — 4 formatos de evento | **Sim** (os quatro) | Não | Médio: 4 adapters pequenos escritos por você | Base de tudo; use direto se só houver 1-2 harnesses no evento |
| (c) ACP `@agentclientprotocol/sdk` | 1.4.0 / Apache-2.0; spec v1 estável, v2 draft | **Sim** — 1 protocolo, N agents; `session/new`, `session/prompt`, `session/update`, `session/request_permission`, `session/load` | **Sim** (adapters rodam o CLI local) | Não | Baixo: spawn do agent + NDJSON no participante; relay de frames no hub | **Recomendado para (1)** |
| (d) Flue | `@flue/runtime` 2.0.3 / Apache-2.0, 6 meses | Não (é um harness próprio, sobre Pi) | n/a | Não | n/a | Fora |
| (e) eve | `eve` 0.44.0 / Apache-2.0, 2 meses | Não (harness de backend sobre AI SDK); expõe-se como ACP agent | n/a | Puxa Workflow DevKit, Chat SDK, Vercel Sandbox | Alto | Fora (referência de design) |
| (f) LangGraph / Mastra / OpenAI Agents / Workflow SDK | 1.4.12 MIT / 1.61.0 Apache / 0.17.0 MIT / 4.8.4 Apache | Não (node/step custom) | n/a | Não (SQLite/libsql/arquivo) | Médio-alto | Só se precisar de HITL durável; Mastra é o mais aderente ao AI SDK v7 |

## (a) AI SDK `@ai-sdk/harness` + adapters + sandboxes

**Fonte primária:** monorepo `vercel/ai` em `ed857f50` (2026-08-22), pastas `packages/harness*`, `packages/sandbox*`, `content/docs/03-ai-sdk-harnesses/`. Versões npm em 2026-08-22: `ai` 7.0.77; `@ai-sdk/harness` 1.0.85; `harness-claude-code` 1.0.88; `harness-codex` 1.0.87; `harness-opencode` 1.0.86; `harness-pi` 1.0.87; `harness-cline` 1.0.12; `harness-acp` (existe no repo, também publicado); `sandbox-vercel` / `sandbox-just-bash` 1.0.85. Todos Apache-2.0. A doc marca tudo como **experimental** ("Expect breaking changes between releases") — [`01-overview.mdx`](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-harnesses/01-overview.mdx).

### O que é

`HarnessAgent` (`@ai-sdk/harness/agent`) é um *agent* AI SDK cuja "inteligência" é um runtime externo (Claude Code, Codex, OpenCode, Pi...). A saída é projetada para os tipos de stream do AI SDK: `agent.stream()` devolve `StreamTextResult`, `agent.generate()` devolve `GenerateTextResult`, e dá pra passar direto para `toUIMessageStream` / `useChat` ([overview, "Compatible Streams"](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-harnesses/01-overview.mdx)). Tem sessão com `createSession({ sessionId })`, `detach()` (devolve *resume state*), `stop()`, `destroy()`, `continueFrom`, `stopWhen: isStepCount(1)` para avançar passo a passo ([`02-harness-agent.mdx`](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-harnesses/02-harness-agent.mdx)). Aceita `tools` AI SDK normais (executadas no host), `skills`, `permissionMode` (`allow-reads | allow-edits | allow-all`) e aprovação de built-in tools.

Dependências duras: `@ai-sdk/harness@1.0.85` depende de `ai@7.0.77` (exato) e `@ai-sdk/provider-utils@5.0.29`; peer `ws@^8.21` e `zod`. **Ou seja: usar harness = migrar o Gambi para AI SDK v7** (o `packages/sdk` hoje aceita `ai ^4||^5||^6`).

### Tabela de adapters (da doc oficial, [`05-harness-adapters.mdx`](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-harnesses/05-harness-adapters.mdx))

| Adapter | Runtime location | Custom tools | Skills | Structured output | Tool approval |
|---|---|---|---|---|---|
| Claude Code | **Sandbox bridge** | sim | sim | sim | sim |
| Codex | **Sandbox bridge** | sim | sim | sim | não |
| OpenCode | **Sandbox bridge** | sim | sim | sim | sim (auto-rejection) |
| Pi | **Host process** | sim | sim | não | sim |
| Cline | Host process | sim | sim | sim | sim |
| Grok Build / ACP genérico | Sandbox via ACP | sim | sim | parcial | sim |

"Coming soon": Amp, Goose, Mastra.

### Por que os adapters "sandbox bridge" exigem sandbox com porta de rede

Não é uma exigência de segurança *do protocolo*; é consequência da arquitetura escolhida:

1. O adapter **instala e roda o harness dentro do sandbox**, não no host. O bootstrap do Claude Code escreve `package.json` + `bridge.mjs` em `.harness-bootstrap/claude-code` e roda `pnpm install` + `./node_modules/.bin/claude --version` *dentro* do sandbox ([`claude-code-bootstrap.ts`](https://github.com/vercel/ai/blob/main/packages/harness-claude-code/src/claude-code-bootstrap.ts)). O bridge de cada adapter é um wrapper fino sobre o SDK nativo: `@anthropic-ai/claude-agent-sdk@0.3.213` ([bridge/package.json](https://github.com/vercel/ai/blob/main/packages/harness-claude-code/src/bridge/package.json)), `@openai/codex-sdk@0.144.5` (`startThread` / `resumeThread` / `runStreamed` em [`harness-codex/src/bridge/index.ts`](https://github.com/vercel/ai/blob/main/packages/harness-codex/src/bridge/index.ts)), `@opencode-ai/sdk@1.18.3` (`createOpencodeServer` em [`harness-opencode/src/bridge/index.ts`](https://github.com/vercel/ai/blob/main/packages/harness-opencode/src/bridge/index.ts)).
2. O host faz `sandboxSession.spawn(bridge)` e depois abre um **WebSocket** para o bridge via `sandboxSession.getPortEndpoint({ port, protocol: 'ws' })` ([`claude-code-harness.ts` ~L918-1075](https://github.com/vercel/ai/blob/main/packages/harness-claude-code/src/claude-code-harness.ts)). O "sandbox de rede" é só o mecanismo de resolver *qual URL* alcança a porta do bridge (no Vercel Sandbox é uma URL pública com headers; num host local seria `ws://127.0.0.1:PORT`).
3. A interface que o adapter exige é `HarnessV1NetworkSandboxSession` = `SandboxSession` (readFile/writeFile/run/spawn) **+** `id`, `defaultWorkingDirectory`, `ports`, `getPortEndpoint`, `stop`, `destroy`, e opcionais `setNetworkPolicy`, `setPorts`, `add/setRequestTransformations` ([`harness-v1-network-sandbox-session.ts`](https://github.com/vercel/ai/blob/main/packages/harness/src/v1/harness-v1-network-sandbox-session.ts)). O provider é `HarnessV1SandboxProvider { specificationVersion: 'harness-sandbox-v1'; providerId; createSession; resumeSession? }` ([`harness-v1-sandbox-provider.ts`](https://github.com/vercel/ai/blob/main/packages/harness/src/v1/harness-v1-sandbox-provider.ts)).
4. `@ai-sdk/sandbox-just-bash` falha de propósito nesses adapters: `ports = []` e `getPortEndpoint` lança `HarnessCapabilityUnsupportedError` ("just-bash sandboxes run in-process and cannot expose a port URL") — [`just-bash-network-sandbox-session.ts`](https://github.com/vercel/ai/blob/main/packages/sandbox-just-bash/src/just-bash-network-sandbox-session.ts). Pi não precisa de porta porque roda no processo host e usa o sandbox só como FS/shell remoto ([README harness-pi](https://github.com/vercel/ai/blob/main/packages/harness-pi/README.md)).
5. A parte de *credential brokering* (`RequestTransformation`: a chave fica fora do sandbox e é injetada num proxy de saída) é opcional — `setRequestTransformations?`. Sem ela, o adapter "retém o comportamento legado de encaminhar o valor para o processo" ([README harness-acp](https://github.com/vercel/ai/blob/main/packages/harness-acp/README.md)).

**Resposta direta:** a exigência é "um lugar onde eu possa (i) escrever arquivos, (ii) spawnar um processo Node e (iii) abrir um WebSocket para uma porta desse processo". Um host local satisfaz as três.

### Autenticação: os adapters NÃO reaproveitam o login local

- Claude Code: `resolveClaudeCodeEnv` procura `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`, depois `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, depois o `apiKeyHelper` de `~/.claude/settings.json` ([`claude-code-auth.ts`](https://github.com/vercel/ai/blob/main/packages/harness-claude-code/src/claude-code-auth.ts)). Não há caminho para o OAuth de `claude login` (`~/.claude/.credentials.json`). Se `skills` forem usados, o adapter ainda sobrescreve `HOME` para um dir dentro do sandbox ([`claude-code-harness.ts` L1009-1037](https://github.com/vercel/ai/blob/main/packages/harness-claude-code/src/claude-code-harness.ts)).
- OpenCode: `OPENCODE_CREDENTIAL_ENVIRONMENT_VARIABLES = [AI_GATEWAY_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN]` ([`opencode-auth.ts`](https://github.com/vercel/ai/blob/main/packages/harness-opencode/src/opencode-auth.ts)). Nada de `~/.local/share/opencode/auth.json`.
- Codex: o bridge passa `apiKey: CODEX_API_KEY` para `new Codex(...)` ([bridge/index.ts L183](https://github.com/vercel/ai/blob/main/packages/harness-codex/src/bridge/index.ts)); o adapter define `CODEX_HOME` para um dir de skills do sandbox (L421 de `codex-harness.ts`).

Isso é esperado: o produto foi desenhado para sandbox remoto, onde o login do dev não existe. Para o Gambi (harness no PC da pessoa, já logado) é atrito real: ou a pessoa exporta API key, ou o sandbox provider local precisa fazer o processo enxergar o `HOME`/`CLAUDE_CONFIG_DIR`/`CODEX_HOME` verdadeiros.

### Existe sandbox provider "local host"? Sim, dois

- **`@openagentsinc/ai-sdk-sandbox-local` 0.1.1-rc.1** (Apache-2.0, publicado 2026-07-22). 641 linhas num único `src/index.ts`. README: "Owner-local `HarnessV1SandboxProvider` for AI SDK harness fixtures... intentionally not a production sandbox. It creates a temporary workspace, scopes file APIs to that workspace, launches child processes with explicit `HOME`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR`, and exposes localhost port URLs for bridge experiments." `getPortEndpoint` devolve `ws://127.0.0.1:<port>/`; `spawn` usa `child_process.spawn('/bin/bash', ['-lc', cmd])`. Tem `inheritClaudeConfig: true` para "reuse the host CLI's current login" e `rootDirectory` para um workspace estável por `sessionId`. **Ressalva:** pina `@ai-sdk/harness@1.0.36` e `provider-utils@5.0.11` (atual 1.0.85 / 5.0.29) — provável drift de tipos; melhor copiar o arquivo para o repo e adaptar do que depender dele.
- **`@lgrammel/apple-container-sandbox` 1.1.0** (MIT, 2026-07-01, autor é o mantenedor do AI SDK): container real via Apple Container CLI, "Publish selected sandbox ports on `127.0.0.1` for local bridges". Requer Apple Silicon + macOS 26. Não serve para Linux/Windows.

### Viável em poucas horas? Sim — e tem um atalho oficial

A doc tem uma seção **"Basic Sandbox Sessions Without Network Control"** ([`02-harness-agent.mdx` § Custom Sandbox Orchestration](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-harnesses/02-harness-agent.mdx)): você passa um `SandboxSession` *básico* (só FS + processo) para `agent.createSession({ sandboxSession })` e informa a porta na mão: `createClaudeCode({ port: 4000, portEndpoint: { url: 'ws://127.0.0.1:4000' } })`, com `prepareSandboxForHarness({ session, harnesses })` antes. Um `SandboxSession` básico sobre `node:fs` + `node:child_process` são ~8 métodos (`readFile`, `readBinaryFile`, `readTextFile`, `writeFile`, `writeBinaryFile`, `writeTextFile`, `spawn`, `run`) — [`provider-utils/src/types/sandbox.ts`](https://github.com/vercel/ai/blob/main/packages/provider-utils/src/types/sandbox.ts). Estimativa: 150-250 linhas, 2-3 h incluindo teste manual, **se** o AI SDK v7 já estiver no projeto. Risco conhecido: o bootstrap roda `pnpm install --frozen-lockfile` dentro do "sandbox" (= no PC da pessoa), então precisa de `pnpm` no PATH e rede.

## (b) Falar com cada harness pelo SDK/servidor nativo

Versões npm em 2026-08-22: `@opencode-ai/sdk` 1.18.21 (MIT), `@anthropic-ai/claude-agent-sdk` 0.3.239 (Commercial ToS, não open source), `@openai/codex-sdk` 0.149.0 (Apache-2.0), `@earendil-works/pi-coding-agent` 0.84.2 (MIT).

| | Criar sessão | Prompt | Stream | Continuar | Reusa login local? |
|---|---|---|---|---|---|
| **OpenCode** (`opencode serve` + SDK) | `session.create()` → `POST /session` | `session.prompt()` (sync) ou `session.promptAsync()` | `event.subscribe()` → `GET /event` SSE (`message.part.updated`, `session.idle`, `permission.updated`...) | mesmo `session.id` em novo prompt; `session.list()`; `session.abort()` | **Sim** — `~/.local/share/opencode/auth.json`, mesmo runtime do CLI |
| **Claude Code** (Agent SDK) | `query({ prompt, options })` — `session_id` chega no `system/init` | mesmo `query()`; `prompt` pode ser `AsyncIterable` (streaming input) | `AsyncGenerator<SDKMessage>`; `includePartialMessages` para `stream_event` | `resume: sessionId`, `continue: true`, `forkSession` | **Sim tecnicamente** (OAuth de `claude login`), com ressalva de termos (abaixo) |
| **Codex** (`@openai/codex-sdk`) | `new Codex().startThread(opts)` | `thread.run(input)` | `thread.runStreamed(input)` → `AsyncGenerator<ThreadEvent>` (`item.*`, `turn.*`) | `codex.resumeThread(thread.id)`; sessões em `~/.codex/sessions` | **Sim por inferência** — sem `apiKey`, o CLI cai em `~/.codex/auth.json` (ChatGPT login) |
| **Pi** (SDK in-process) | `createAgentSession({ cwd })` → `{ session }` | `session.prompt(text, { streamingBehavior: 'steer' \| 'followUp' })` | `session.subscribe(listener)` (`message_update` com `text_delta`, `tool_execution_*`, `turn_end`...) | `SessionManager.open(path)` / `continueRecent(cwd)`; JSONL em `~/.pi/agent/sessions/` | **Sim** — `ModelRuntime.create()` lê `~/.pi/agent/auth.json` |

Detalhes e fontes:

- **OpenCode.** `opencode serve --port --hostname` ([docs/server](https://opencode.ai/docs/server/), [serve.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/serve.ts)); basic auth opcional via `OPENCODE_SERVER_PASSWORD`. SDK: `createOpencode()` spawna o server, `createOpencodeClient({ baseUrl })` conecta a um existente ([docs/sdk](https://opencode.ai/docs/sdk/), [sdk.gen.ts](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/sdk.gen.ts)). Rotas em [session.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts). Divergência: doc diz porta 4096, [network.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/network.ts) tem default `0`. Também fala ACP nativo: `opencode acp` ([docs/acp](https://opencode.ai/docs/acp/)).
- **Claude Code.** `query()` em [typescript reference](https://code.claude.com/docs/en/agent-sdk/typescript); `resume`/`continue`/`forkSession` em [sessions](https://code.claude.com/docs/en/agent-sdk/sessions); `permissionMode` (`default | acceptEdits | bypassPermissions | plan | dontAsk | auto`) e `canUseTool(toolName, input) => { behavior: 'allow' | 'deny' }` em [permissions](https://code.claude.com/docs/en/agent-sdk/permissions) — **esse `canUseTool` é o gancho natural de steering humano**. CLI equivalente: `claude -p --output-format stream-json --input-format stream-json --resume <id>` ([cli-reference](https://code.claude.com/docs/en/cli-reference), [headless](https://code.claude.com/docs/en/headless)). Auth: cadeia `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → OAuth de `/login` (`~/.claude/.credentials.json`) ([authentication](https://code.claude.com/docs/en/authentication)). **Termos:** [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance) proíbe terceiros oferecerem login claude.ai / intermediarem tokens de assinatura; a exceção explícita é o end user logando com a própria assinatura num **binário não modificado** do Claude Code. Leitura para o Gambi: cada pessoa roda o *seu* `claude` no *seu* PC com a *sua* conta e o hub nunca vê token — compatível com o invariante `ParticipantAuthHeaders` do repo. Um hub que armazenasse/repassasse credenciais de terceiros não seria.
- **Codex.** `codex exec --json` emite JSONL (`thread.started`, `turn.*`, `item.*`) ([exec_events.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs)); `codex exec resume <id>`; `-s read-only|workspace-write|danger-full-access`. SDK: "spawns the CLI and exchanges JSONL events" ([README](https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md), [thread.ts](https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/thread.ts)). Alternativa mais rica: `codex app-server` JSON-RPC com transports stdio / `ws://` (experimental) / `unix://`, métodos `thread/start|resume|fork`, `turn/start`, `turn/interrupt`, **`turn/steer`** ([app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)). Sem ACP nativo (o adapter `codex-acp` da org ACP fica em cima do app-server); `codex mcp-server` imprime "deprecated".
- **Pi.** SDK em [docs/sdk.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) e [agent-session.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts); persistência JSONL em [docs/sessions.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/sessions.md). Modo processo: `pi --mode rpc` (comandos JSON por linha: `prompt`, `steer`, `follow_up`, `abort`, `switch_session`, `get_state`) ([docs/rpc.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)). Auth em [docs/providers.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md) (OAuth para ChatGPT, Claude, Copilot...). Nota: CLI contata `pi.dev` salvo `PI_OFFLINE`.

**Conclusão de (b):** os quatro têm API programática local decente e os quatro reaproveitam o login do CLI. O problema é que são **quatro formatos de evento diferentes** (SSE do OpenCode, `SDKMessage` do Claude, `ThreadEvent` do Codex, eventos do Pi). Os `@ai-sdk/harness-*` bridges são exatamente esses quatro SDKs com um normalizador para stream parts do AI SDK — e ACP é a outra normalização disponível.

## (c) ACP — Agent Client Protocol

**O que é.** JSON-RPC 2.0 entre um *Client* (editor/UI, que lança o agent como subprocesso) e um *Agent* (harness). Fluxo: `initialize` → `authenticate` (opcional) → `session/new` | `session/load` → `session/prompt` → notificações `session/update` (agent→client) → `session/request_permission` (agent→client) → `session/cancel` ([protocol/v1/overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/overview.mdx)). Repo movido de `zed-industries` para a org `agentclientprotocol`; 4.042 stars; release `schema-v1.21.0` em 2026-08-20.

**Transport.** Spec define **stdio** (NDJSON, agent escreve só ACP em stdout) e **Streamable HTTP** "in discussion, draft" ([transports.mdx](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/transports.mdx)). Mas o SDK TS já traz `createWebSocketStream`, `createHttpStream`, `ws-server.ts` e exemplo `http-server.ts` ([typescript-sdk/src/examples](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/README.md)). Para o Gambi isso importa: o framing ACP pode viajar **dentro do túnel WebSocket** existente sem inventar protocolo.

**Resume.** `session/load` exige `agentCapabilities.loadSession`; o agent reproduz o histórico via `session/update`. Existe também `session/resume` (sem replay) ([session-setup.mdx](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx)). **ACP v2 (draft)** remove `session/load`, `fs/*`, `terminal/*` e muda `session/prompt` para "aceite + término via `state_update`" ([v2/migration.mdx](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/migration.mdx)) — ou seja, a spec ainda está em movimento.

**SDK TS.** `@agentclientprotocol/sdk` **1.4.0** (2026-08-20; `@zed-industries/agent-client-protocol` está deprecated). Exporta `ndJsonStream`, `ClientSideConnection`, `AgentSideConnection` e a API nova `agent({name})` / `client({name})` com `connectWith(stream, ctx => ...)` ([README](https://github.com/agentclientprotocol/typescript-sdk/blob/main/README.md), [src/acp.ts](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts)). O exemplo oficial de client faz `spawn()` do agent + `ndJsonStream(stdin, stdout)` + `ctx.request(acp.methods.agent.initialize, ...)` + `session.prompt(...)` ([src/examples/client.ts](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts)). **Sim: dá para spawnar e dirigir qualquer agent ACP a partir de Node com ~50 linhas.**

**Quem fala ACP** ([agentclientprotocol.com/overview/agents](https://agentclientprotocol.com/overview/agents), [registry](https://github.com/agentclientprotocol/registry)):

| Harness | Como | Pacote / comando |
|---|---|---|
| Claude Code | adapter oficial sobre Claude Agent SDK | `@agentclientprotocol/claude-agent-acp` 0.70.0 (2026-08-18) — [repo](https://github.com/agentclientprotocol/claude-agent-acp) |
| Codex | adapter oficial sobre Codex App Server | `@agentclientprotocol/codex-acp` 1.6.2 (2026-08-20) — [repo](https://github.com/agentclientprotocol/codex-acp) |
| OpenCode | **nativo** | `opencode acp` — [docs](https://github.com/sst/opencode/blob/dev/packages/web/src/content/docs/acp.mdx) |
| Gemini CLI | nativo | `gemini --acp` — [docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md) |
| Pi | adapter comunitário | [svkozak/pi-acp](https://github.com/svkozak/pi-acp) |
| Cursor, Goose, Kiro, Copilot, Cline, OpenHands, Devin, Junie... | nativo | lista oficial |

Clients: Zed, JetBrains, Neovim (3 plugins), Emacs, VS Code, Obsidian, bots Telegram/Discord/Slack, e frameworks que se expõem como ACP agent (Mastra, LangChain deepagents, eve) — [overview/clients](https://agentclientprotocol.com/overview/clients).

**É a "translation layer" pronta?** Sim, para os quatro harnesses do evento: Claude Code, Codex, OpenCode e Pi têm implementação ACP (duas oficiais da org ACP, uma nativa, uma comunitária). Os adapters `claude-agent-acp` e `codex-acp` rodam no PC da pessoa e usam o login local do CLI (são os mesmos adapters que o Zed usa para "sign in with your Claude/ChatGPT account"). O próprio `@ai-sdk/harness-acp` da Vercel é prova de que ACP serve como denominador comum — só que a Vercel o envolve em sandbox, e nós não precisamos.

## (d) Flue (flueframework.com)

- Repo [withastro/flue](https://github.com/withastro/flue) — **org do Astro**. "The Agent Harness Framework". Apache-2.0. 7.983 stars, criado 2026-02-07, último push 2026-08-08, 0 releases GitHub (só tags `v2.0.x`).
- npm: `@flue/runtime` 2.0.3 (2026-08-05), `@flue/cli`, `@flue/sdk`, adapters (postgres, slack, discord, github...) ([README](https://github.com/withastro/flue/blob/main/README.md)).
- O que é: framework para **construir** agents autônomos estilo Claude Code (`'use agent'`, `useModel/useSandbox/useSkill/useTool`, SKILL.md, sandbox local/container, durable stream, subagents, MCP). Construído sobre **Pi** (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`), `hono`, `valibot`. **Não usa `ai` da Vercel.**
- Veredito: concorrente de "escreva seu harness", não um orquestrador de harnesses de terceiros. Irrelevante para o problema (1); para (2) traria um segundo runtime de agent ao lado do AI SDK. Descartar.

## (e) eve.dev

- [vercel/eve](https://github.com/vercel/eve), Apache-2.0, "MADE BY Vercel", "filesystem-first framework for durable backend AI agents — like Next.js for agents". Agent = pasta com `instructions.md`, `tools/`, `skills/`, `channels/`, `schedules/`. 4.758 stars, criado 2026-06-16, npm `eve` 0.44.0 (2026-08-21, pré-1.0 com release quase diária).
- Relação com AI SDK: usa diretamente `ai`, `@ai-sdk/anthropic|openai|google|mcp|otel`, mais `@workflow/*` (durabilidade), `chat` (Chat SDK) e `@vercel/sandbox` ([packages/eve/package.json](https://github.com/vercel/eve/blob/main/packages/eve/package.json)).
- Relação com ACP: depende de `@agentclientprotocol/sdk` e tem `eve acp` + `@eve/buzz-acp-adapter` — um agent eve pode ser **exposto** como agent ACP ([cli/acp](https://github.com/vercel/eve/tree/main/packages/eve/src/cli/acp), [adapter README](https://github.com/vercel/eve/blob/main/packages/eve-buzz-acp-adapter/README.md)).
- Veredito: é um harness de agent de backend (cron, canais, memória), não orquestrador de coding agents de terceiros. Poderia ser *o orquestrador* em tese, mas puxa Workflow DevKit + Chat SDK + Vercel Sandbox; pesado demais para um CLI local-first. Interessante só como referência de "agent definido por pasta" e pelo fato de falar ACP.

## (f) LangGraph JS, Mastra, OpenAI Agents SDK, Workflow SDK — só para orquestrar harnesses externos

Versões em 2026-08-22: `@langchain/langgraph` 1.4.12 (MIT), `@mastra/core` 1.61.0 (Apache-2.0), `@openai/agents` 0.17.0 (MIT), `workflow` 4.8.4 (Apache-2.0).

**Resposta curta:** nenhum tem primitiva de "processo remoto arbitrário via túnel". Todos deixam envolver isso como tool/step/node custom — código que você escreveria de qualquer jeito. O que se compra é human-in-the-loop + estado serializável + persistência local.

| | Wrap de harness remoto | HITL | AI SDK v7 | Persistência local |
|---|---|---|---|---|
| LangGraph | node custom (`RemoteGraph` só fala com LangGraph Server, que exige LangSmith key) | `interrupt()` + `Command({ resume })` | não (modelos LangChain) | `@langchain/langgraph-checkpoint-sqlite` |
| Mastra | `createStep({ execute })` custom; `A2AAgent({ url })` se houver shim A2A na frente do harness; "agent networks" deprecated | `suspend()` / `workflow.resume()` | nativo — `@mastra/core` declara aliases `@ai-sdk/provider-v5/-v6/-v7` | `@mastra/libsql` (arquivo) |
| OpenAI Agents | function tool / MCP; `codexTool` (`@openai/agents-extensions/experimental/codex`) roda Codex **local** via `@openai/codex-sdk`; "sandbox agents" (beta) com `UnixLocalSandboxClient`/`DockerSandboxClient` é harness *próprio*, não wrapper de terceiros | `needsApproval` + `RunState.toString()/fromString()` | `aisdk(model)` em `@openai/agents-extensions/ai-sdk` (peer `ai ^6 || ^7`) | só `MemorySession`; interface `Session` de 5 métodos pra implementar |
| Workflow SDK (Vercel) | `'use step'` custom | `createHook()` / `defineHook()` / `createWebhook()` — `await hook` pausa, `resumeHook(token, data)` retoma | agnóstico | Local World em `.workflow-data/`; exige bundler (Next/Vite/Nitro) — não é "import e roda" num CLI Bun |

Fontes: [`remote.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/remote.ts), [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [Mastra suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume), [Mastra A2A](https://mastra.ai/docs/agents/a2a), [Mastra model providers](https://mastra.ai/docs/getting-started/model-providers), [OpenAI Agents HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/), [codex extension](https://github.com/openai/openai-agents-js/tree/main/packages/agents-extensions/src/experimental/codex), [sandbox agents](https://openai.github.io/openai-agents-js/guides/sandbox-agents/), [Workflow hooks](https://workflow-sdk.dev/docs/foundations/hooks), [Workflow deploying](https://workflow-sdk.dev/docs/deploying).

**Veredito:** para amanhã, nenhum. Para o TCC, se quiser um grafo durável com suspend/resume sem escrever o runner, Mastra é o mais aderente (AI SDK v7 nativo, libsql local, A2A client/server de graça); o custo é um framework grande e opinativo. O `ToolLoopAgent` do próprio AI SDK v7 + um loop seu costuma bastar.

## Resposta direta à pergunta do sandbox

**Por que os adapters "sandbox bridge" exigem sandbox de rede?** Porque o design da Vercel roda o harness *dentro* do sandbox: o adapter escreve um `bridge.mjs` + `package.json` no sandbox, roda `pnpm install` lá, faz `sandboxSession.spawn(bridge)` e abre um WebSocket do host para a porta do bridge usando `sandboxSession.getPortEndpoint({ port, protocol: 'ws' })`. "Sandbox de rede" (`HarnessV1NetworkSandboxSession`) é o nome da interface que sabe resolver essa porta; `just-bash` falha porque não tem porta. Não há exigência criptográfica nem de isolamento no protocolo — o README do `harness-acp` admite que, sem `setRequestTransformations`, o adapter "forwards the value to the ACP process" (comportamento legado).

**Viável implementar um provider "local host" em poucas horas?** Sim. Caminho oficial mais curto: seção "Basic Sandbox Sessions Without Network Control" da doc — implementar só o `SandboxSession` básico (8 métodos sobre `node:fs` + `node:child_process`), passar `createClaudeCode({ port: 4000, portEndpoint: { url: 'ws://127.0.0.1:4000' } })` e `prepareSandboxForHarness()`. ~200 linhas. **Já existe:** `@openagentsinc/ai-sdk-sandbox-local` 0.1.1-rc.1 (641 linhas, `getPortEndpoint` → `ws://127.0.0.1:<port>/`, `inheritClaudeConfig: true` para reusar login do `claude`), mas pina `@ai-sdk/harness@1.0.36` — copiar e adaptar, não depender. `@lgrammel/apple-container-sandbox` é só macOS 26 + Apple Silicon.

**Mas vale a pena?** Só se você quiser os stream parts do AI SDK e o `HarnessAgent` (sessões, `detach()`/resume, tools host-side, skills) de graça. O preço: `ai@7` hoje, bootstrap `pnpm install` no PC de cada participante, e auth por API key (ou hack de `CLAUDE_CONFIG_DIR`/`CODEX_HOME`) — exatamente o que o evento não quer.

## Recomendação

### Até amanhã de manhã (dinâmica de 1 h)

Objetivo mínimo: orquestrador manda tarefa → harness no PC de alguém executa → output volta → humano aprova/devolve. Não migrar AI SDK, não adotar framework.

1. **Participante "harness" = processo ACP local.** No runtime do participante (`packages/cli`), adicionar um modo que faz `spawn` de um agent ACP e liga stdin/stdout ao túnel com `ndJsonStream` do `@agentclientprotocol/sdk`. Comandos por harness, todos usando o login que a pessoa já tem:
   - OpenCode: `opencode acp`
   - Claude Code: `npx @agentclientprotocol/claude-agent-acp`
   - Codex: `npx @agentclientprotocol/codex-acp`
   - Pi: `npx pi-acp` (comunitário — testar antes; fallback `pi --mode rpc` com tradução mínima)
   O hub **não** interpreta ACP: só relaya frames JSON-RPC entre o orquestrador e o túnel do participante (novo tipo de mensagem no protocolo do túnel, ao lado de inference). Tunnel-first preservado; tokens nunca saem do PC.
2. **Orquestrador = `streamText`/`ToolLoopAgent` do AI SDK v6 já no repo**, usando qualquer modelo da sala. Uma tool `dispatch({ participantId, task })` que abre `session/new` + `session/prompt` no harness escolhido e devolve o texto final; uma tool `listSquads()` que lê `client.participants.list()`. Decomposição de tarefas é só prompt.
3. **Steering humano = `session/request_permission`.** O adapter ACP já pausa e pergunta; o hub roteia a pergunta para a TUI (`apps/tui`) da pessoa dona do harness, que aprova/nega. Para "revisar e devolver output", o humano manda `session/prompt` de follow-up na mesma sessão.
4. Se o tempo apertar: cortar para **um** harness (OpenCode, ACP nativo, SDK MIT, zero adapter) e fazer os outros na hora só se sobrar tempo. Se ACP der problema com algum, o plano B é o SDK nativo daquele harness (b) com um adapter de 50 linhas para o formato de evento que a TUI consome.

### Para o TCC

- **Manter ACP como camada (1)** e tratar o Gambi como *client ACP multi-agente sobre transporte tunnel-first* — é uma contribuição legível: o ACP foi feito para 1 client ↔ 1 agent via stdio; o Gambi o estende para N humanos + N agents numa sala, com presença, roteamento e observabilidade. Acompanhar ACP v2 (`session/resume` com `replayFrom`, `state_update`) — o draft muda `session/prompt`.
- **Migrar para AI SDK v7** (há skill `migrate-ai-sdk-v6-to-v7` no repo) e então reavaliar `@ai-sdk/harness`: com um sandbox provider local no repo, o `HarnessAgent` dá sessões resumíveis, tools host-side e stream parts prontos para `useChat`; e o `@ai-sdk/harness-acp` mostra que ACP + AI SDK convivem. O provider local é o trabalho de engenharia; a pesquisa é a camada social por cima.
- **Orquestração durável / HITL:** começar com loop próprio no AI SDK (v7 `ToolLoopAgent`). Se a tese precisar de grafo com `suspend/resume` persistido, Mastra é o único com AI SDK v7 nativo + libsql local + A2A client/server; LangGraph exige modelos LangChain; Workflow SDK exige bundler. A2A (que o research-direction cita) pode ser o "bridge externo único": Mastra expõe `/api/a2a/<id>` e consome `A2AAgent({ url })`.
- **Questão de termos a registrar:** o Claude Agent SDK é Commercial ToS e proíbe intermediar tokens de assinatura; o desenho "cada pessoa roda seu próprio binário não modificado no seu PC" fica na exceção documentada. Qualquer evolução em que o hub guarde credenciais muda isso.

## Fontes-chave (além das inline)

- vercel/ai `ed857f50` (2026-08-22): `packages/harness/src/v1/harness-v1-sandbox-provider.ts`, `harness-v1-network-sandbox-session.ts`; `packages/harness-claude-code/src/{claude-code-harness,claude-code-auth,claude-code-bootstrap}.ts`; `packages/harness-codex/src/bridge/index.ts`; `packages/harness-opencode/src/bridge/index.ts`; `packages/sandbox-just-bash/src/just-bash-network-sandbox-session.ts`; `content/docs/03-ai-sdk-harnesses/{01-overview,02-harness-agent,05-harness-adapters,06-workflow-utilities}.mdx`.
- agentclientprotocol/agent-client-protocol `docs/protocol/v1/{overview,transports,session-setup}.mdx`, `docs/protocol/v2/migration.mdx`; agentclientprotocol/typescript-sdk `README.md`, `src/examples/client.ts`.
- Docs oficiais: opencode.ai/docs/{server,sdk,acp}; code.claude.com/docs/en/{agent-sdk/typescript,agent-sdk/sessions,agent-sdk/permissions,authentication,legal-and-compliance,cli-reference}; github.com/openai/codex `sdk/typescript`, `codex-rs/app-server/README.md`; github.com/earendil-works/pi-mono `packages/coding-agent/docs/{sdk,sessions,rpc,providers}.md`.
