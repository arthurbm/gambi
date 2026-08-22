# ADR: Harness participants speak ACP v1 through the tunnel; orchestration lives above the hub

**Status:** Aceito
**Data:** 2026-08-22
**Escopo:** `packages/core` (tunnel frame), `packages/cli` (`join --harness`), `packages/sdk`, novo `packages/agents`, novo `apps/board`

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
