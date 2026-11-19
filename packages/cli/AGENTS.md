# gambi (CLI)

Workspace fonte do CLI `gambi`. Este workspace é `private: true`; a distribuição publicada no npm e no GitHub Release é gerada em `packages/cli/dist` pelo workflow oficial.

O CLI é **resource-oriented e agent-first** ([ADR-0002](../../docs/adr/0002-agent-first-management-surface.md)): pensado para automação (flags, saída estruturada, exit codes previsíveis), com modo interativo como segunda camada. É escrito sobre `effect/cli` ([ADR-0007](../../docs/adr/0007-effect-as-runtime-foundation.md)).

Antes de mexer nele, leia a seção "The CLI" de [`docs/reference/effect-conventions.md`](../../docs/reference/effect-conventions.md): como acrescentar um comando, como emitir saída e erro, como hospedar um participante e como testar um comando. Este arquivo só diz onde as coisas estão.

## Estrutura

- `src/cli/main.ts`: o entrypoint do binário e o único arquivo que toca a plataforma (`@effect/platform-bun`, sinais, exit code do processo). O lint recusa `Bun.*` e `@effect/platform-*` no resto, fora dos testes.
- `src/cli/root.ts`: a árvore de comandos. Cada grupo é uma linha.
- `src/cli/commands/<grupo>.ts`: a definição de cada comando e das suas flags. Para confirmar uma flag, este arquivo vence qualquer outra fonte.
- `src/cli/run.ts`: `runCli`, o que o binário e os testes executam; mostra o erro em stderr e escolhe o exit code.
- `src/cli/exit-codes.ts`: a tabela única de erro tipado para exit code (`failureKinds`).
- `src/cli/output.ts`: `Output`, a única saída de um comando (texto para uma pessoa, JSON para um programa).
- `src/cli/global-flags.ts`, `flags.ts`, `hub-client.ts`: as flags que mais de um comando aceita.
- `src/cli/participant-stay.ts`: a estadia de `participant join` e os eventos que ela escreve.
- `src/cli/testing.ts`: `runCommand` e `startCommand`, para rodar um comando num teste.
- `bin/gambi` e `scripts/postinstall.mjs`: o wrapper npm, que acha o binário da plataforma e repassa sinais.
- `build.ts`: compila `src/cli/main.ts` para os cinco alvos e monta `dist/`.

## Comandos

```
gambi hub serve
gambi room create|list|get
gambi participant join|leave
gambi events watch
gambi self update
```

`gambi participant join` hospeda um participant runtime de `@gambi/core` no próprio processo, com um endpoint de modelo ou com um harness. Não duplique lógica de túnel aqui.

## Contratos operacionais

- **Saída estruturada**: `--format text|json`; sem a flag, `text` num terminal e `json` fora dele. `GAMBI_FORMAT` é o fallback. Um comando que roda até ser parado escreve um evento JSON por linha.
- **Interatividade**: uma flag obrigatória que falta vira pergunta só num terminal. `--no-interactive` e `GAMBI_NO_INTERACTIVE=1` nunca perguntam.
- **Hub**: `--hub`, depois `GAMBI_HUB`, depois `http://localhost:3000`.
- **Log**: `--log-level`, em stderr. stdout é só dado.

Exit codes (`src/cli/exit-codes.ts`):

| Code | Significado |
| --- | --- |
| `0` | sucesso, ou parada pedida por sinal |
| `1` | falha interna / inesperada |
| `2` | uso inválido: não adianta tentar de novo |
| `3` | conectividade ou dependência: hub inalcançável, provider fora do ar |
| `4` | o hub entendeu e recusou |
| `130` | um sinal interrompeu um comando que não esperava por um |

Os eventos de `hub serve` estão em `commands/hub.ts`, os de `participant join` no topo de `participant-stay.ts`, e `events watch` escreve os eventos de sala como chegam.

Flags, eventos e exit codes são contrato público: uma mudança neles pede atualização em `apps/docs/src/content/docs/reference/cli.mdx` e em `docs/reference/contracts.md`.

## Regras de design

- **Não inventar rotas nem contratos paralelos**: o CLI chama o management plane pelo cliente derivado do contrato (`withHub`). O que falta entra primeiro em `@gambi/protocol`.
- **`--participant-id` é obrigatório fora de um terminal**: é o que torna o registro idempotente e seguro para repetir.
- **Não reintroduzir aliases flat**: não existe `gambi serve`, `gambi join` nem `gambi list` sem o grupo do recurso.
- **Não adicionar lógica de negócio no CLI**: ele é uma casca sobre o core.

## Validação

Ao tocar este package:

```bash
bun run --cwd packages/cli dev -- <comando> --help
bun run --cwd packages/cli check-types
bun test packages/cli/src
```

Ao tocar distribuição ou release:

```bash
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
node ./packages/cli/dist/npm/gambi/bin/gambi --version
```

Ver `docs/reference/release-architecture.md` para o fluxo de release completo.
