# Smokes reais dos harnesses — 22 de agosto de 2026

Execução local, limitada e sem retry, feita somente depois de install congelado,
typechecks, testes determinísticos, builds e ensaio do supervisor ficarem verdes.
Nenhuma autenticação foi criada, alterada ou copiada.

| Harness | CLI local | Bridge ACP | Prontidão | Prompts reais | Resultado |
| --- | --- | --- | --- | ---: | --- |
| OpenCode | 1.18.21 | `opencode acp`, presente | login detectado | 1 | reconhecido, `end_turn` |
| Claude Code | 2.1.239 | `claude-agent-acp` 0.70.0, efêmero | login detectado | 1 | reconhecido, `end_turn` |
| Codex | 0.149.0 | `codex-acp` 1.6.2, efêmero | login detectado | 1 | reconhecido, `end_turn` |

## OpenCode

O adapter normal abriu um processo ACP efêmero e uma sessão por um hub real. O
cliente anexado enviou exatamente um `session/prompt`: “Reply with exactly
GAMBI_SMOKE_ACK. Do not create or modify files.” Não houve segundo dispatch.

- lifecycle de abertura: `harness_spawned`, `session_opened`;
- resposta: continha `GAMBI_SMOKE_ACK` e terminou com `stopReason: end_turn`;
- duração aproximada: 71 s, dentro do limite de resposta de 180 s e do kill
  externo de 210 s;
- artefato: o encerramento publicou o snapshot final do workspace; o modelo não
  criou nem alterou arquivos;
- cleanup: `artifact_sent`, `harness_exited`; o bridge saiu com 143 após o
  `SIGTERM` gerenciado;
- pós-condição exata: PID 326205 ausente, raiz temporária do workspace ausente e
  nenhum processo `opencode acp` ou script de smoke restante.

Resultado: round mínimo reconhecido. Custo sensível: um prompt real, zero
retries.

## Claude Code

`claude auth status --json` confirmou login local. A versão oficial 0.70.0 do
bridge foi verificada no npm com integridade
`sha512-Psqj6fhV4pQ8IM480zpJ+xGiMMIqNLxlsTj5Mzn+T8KSURCVNJdl0ktcqLMjgHJC/QnOvDdDkFf3xTW9VIV9aQ==`
e instalada somente num prefix/cache temporário. Exatamente um prompt respondeu
`GAMBI_SMOKE_ACK`, com 15 caracteres, `end_turn` e duração aproximada de 7 s.
O lifecycle de cleanup foi `artifact_sent`, `harness_exited`, com código 0; PID
327824, workspace temporário e processo `claude-agent-acp` ficaram ausentes.

O aviso dos termos foi respeitado: `hosted: false`, autenticação local do próprio
usuário, sem intermediação de login ou alteração do binário da Anthropic.

## Codex

`codex login status` confirmou login local. A versão oficial 1.6.2 do bridge foi
verificada no npm com integridade
`sha512-2eF1mbs1gTqkZJSLYOun/pFDx37sYa7W63HOPezC37b/R8AYms5O1nfQu8lrqFSGDrwDZkASVORymLcqjCNqyA==`
e instalada no mesmo prefix/cache temporário. Exatamente um prompt recebeu
`GAMBI_SMOKE_ACK`, `end_turn` e duração aproximada de 8 s. O lifecycle de cleanup
foi `artifact_sent`, `harness_exited`; o bridge saiu com 143 após o `SIGTERM`
gerenciado. PID 328108, workspace temporário e processo `codex-acp` ficaram
ausentes.

O prefixo efêmero `/tmp/gambi-real-bridges.mPVR6G` foi removido ao final, e não
restou processo de nenhum dos três bridges. Total sensível: três prompts reais,
um por harness, zero retries.

## Supervisor do ensaio

O comando documentado `bun run board:e2e` chegou a pronto no room `PP-V65`. Um
`SIGINT` enviado diretamente ao PID 324932 do supervisor encerrou com código 0.
A pós-condição exata foi: banco efêmero ausente; portas 3000, 3001, 3002, 3101 e
3102 livres; nenhum processo do supervisor, hub, fixtures, board ou web restante.
Isso distingue o cleanup do produto do primeiro Ctrl+C injetado no wrapper PTY,
que interrompeu o wrapper antes de entregar o sinal ao supervisor.
