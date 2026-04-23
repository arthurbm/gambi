# gambi (CLI)

Workspace fonte do CLI `gambi`. Este workspace é `private: true`; a distribuição publicada no npm e no GitHub Release é gerada em `packages/cli/dist` pelo workflow oficial.

O CLI é **resource-oriented e agent-first**: pensado para automação (flags, output estruturado, exit codes previsíveis) e com modo interativo como segunda camada.

## Estrutura

- `src/cli.ts` — entrypoint, roteamento de subcomandos.
- `src/commands/*.ts` — definição autoritativa de cada comando e suas flags. Se um agente precisar confirmar uma flag, ler esse arquivo vence qualquer outra fonte.
- `src/utils/agent-command.ts` — classe base `AgentCommand` com as flags globais (`--format`, `--env`, `--interactive`, `--no-interactive`, `--verbose`, `--quiet`).
- `src/utils/management-api.ts` — envelope de chamadas ao management plane + mapeamento de HTTP status para exit codes.
- `src/utils/output.ts` — renderização text/json/ndjson.
- `src/utils/cli-config.ts` — leitura do `~/.config/gambi/config.json` (respeita `XDG_CONFIG_HOME`).

## Comandos atuais

```
gambi hub serve
gambi room create|list|get
gambi participant join|leave|heartbeat
gambi events watch
gambi self update
```

`gambi participant join` é uma thin layer sobre `createParticipantSession()` de `@gambi/core/participant-session`. Não duplicar lógica de túnel/heartbeat aqui.

## Contratos operacionais

Mantidos pelo base `AgentCommand`:

- **Saída estruturada**:
  - `--format text|json|ndjson`
  - TTY + comando one-shot → `text`
  - stdout pipeado + one-shot → `json`
  - stdout pipeado + streaming → `ndjson`
  - streaming com `--format json` é coagido para `ndjson`
- **Interatividade**: `--interactive` / `--no-interactive`; prompts também suprimidos com `GAMBI_NO_INTERACTIVE=1`.
- **Ambientes nomeados**: `--env <name>` lê de `~/.config/gambi/config.json`; fallback `GAMBI_ENV`.
- **Format fallback**: `GAMBI_FORMAT`.

Exit codes (de `utils/management-api.ts`):

| Code | Significado |
| --- | --- |
| `0` | sucesso |
| `1` | falha interna / inesperada |
| `2` | uso inválido (`400`/`422` do hub, validação local) |
| `3` | conectividade/dependência (`401`/`403`/`503`, hub inacessível) |
| `4` | rejeição remota (`404`/`409` do hub) |

Agentes-supervisores usam esses códigos para decidir retry: `2` não retrier, `3` geralmente sim, `4` significa rejeição por estado do hub.

## Eventos NDJSON de comandos streaming/longos

- `hub serve`: `started`, `mdns_registered`, `signal_received`, `stopped`.
- `participant join`: `prepared`, `registered`, `tunnel_connected`, `leaving`, `left`, `heartbeat_failed`, `tunnel_failed`.
- `events watch`: os próprios eventos SSE do management (`connected`, `room.*`, `participant.*`, `llm.*`).

Qualquer mudança nesses lifecycle events é contrato público — atualizar `apps/docs/src/content/docs/reference/cli.mdx`.

## Regras de design

- **Não inventar rotas/contratos paralelos**: o CLI só renderiza sobre o management plane do core. Se precisar de algo novo, adicionar no core primeiro.
- **`--participant-id` é obrigatório em fluxos não interativos**: é o que garante retry-safe no `PUT /v1/rooms/:code/participants/:id` idempotente.
- **Não reintroduzir aliases flat**: não existe mais `gambi serve` / `gambi join` / `gambi list` sem namespace de recurso.
- **Flags são documentadas em três lugares em sync**: o próprio comando (`commands/*.ts`), `apps/docs/src/content/docs/reference/cli.mdx`, e `README.md`/guias quando relevantes para o usuário.
- **Não adicionar lógica de negócio no CLI**: o CLI é uma shell sobre o core + SDK.

## Validação

Ao tocar este package:

```bash
bun run --cwd packages/cli dev -- <comando> --help
bun run --cwd packages/cli check-types
bun test packages/cli/src
```

Ao tocar distribuição/release:

```bash
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
node ./packages/cli/dist/npm/gambi/bin/gambi --version
```

Ver `docs/release-architecture.md` e seção 11.1 do AGENTS.md da raiz para o fluxo de release completo.

## Regras do Bun

Este workspace roda em Bun; prefira as APIs nativas:
- `bun run <script>` para scripts; `bun <file>` para executar TS direto.
- `bun test` para testes.
- `Bun.$` (template tag) em vez de `execa` / `child_process`.
- Bun carrega `.env` automaticamente — não usar `dotenv`.
