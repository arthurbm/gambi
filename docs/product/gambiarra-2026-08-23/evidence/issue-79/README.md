# Evidência do ensaio do issue 79

Execução local em 22 de agosto de 2026 com `bun run board:e2e`, Codex in-app
browser e banco SQLite efêmero. Admin, membro e steerer usaram origens distintas
para manter identidades separadas. Essa parte determinística não chamou modelo
pago.

| Arquivo | Viewport | Verificação |
| --- | --- | --- |
| `01-admin-desktop-1440x900.jpg` | 1440×900 | três squads e dois fakes hospedados |
| `02-member-mobile-390x844.jpg` | 390×844 | membro do squad, comando pessoal e fake conectado |
| `03-round-4-city-desktop-1440x900.jpg` | 1440×900 | duas estações, linha e um lote fora da rede |
| `04-round-4-city-mobile-390x844.jpg` | 390×844 | mesma cidade após reflow |
| `05-round-5-crisis-desktop-1280x720.jpg` | 1280×720 | vizinho nomeado, devolução e mesmo session ID |
| `06-round-6-model-swap-desktop-1280x720.jpg` | 1280×720 | modelo anterior, novo modelo e handoff |
| `07-finale-after-restart-desktop-1440x900.jpg` | 1440×900 | cidade e caderno consolidado após restart |
| `08-finale-after-restart-mobile-390x844.jpg` | 390×844 | finale sem overflow horizontal |

Os arquivos rastreados são JPEG. Use este corpo exato ao corrigir o comentário do
issue 79 (não troque as extensões por `.png`):

```markdown
Evidência do ensaio determinístico de `bun run board:e2e` (sem chamadas pagas):

- [Admin · desktop 1440×900](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/01-admin-desktop-1440x900.jpg)
- [Membro · mobile 390×844](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/02-member-mobile-390x844.jpg)
- [Rodada 4 · desktop 1440×900](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/03-round-4-city-desktop-1440x900.jpg)
- [Rodada 4 · mobile 390×844](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/04-round-4-city-mobile-390x844.jpg)
- [Rodada 5 · desktop 1280×720](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/05-round-5-crisis-desktop-1280x720.jpg)
- [Rodada 6 · desktop 1280×720](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/06-round-6-model-swap-desktop-1280x720.jpg)
- [Finale após restart · desktop 1440×900](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/07-finale-after-restart-desktop-1440x900.jpg)
- [Finale após restart · mobile 390×844](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/08-finale-after-restart-mobile-390x844.jpg)

O roteiro completo e os resultados de restart/cleanup estão no [README de evidência](https://github.com/arthurbm/gambi/blob/codex/spec-68-harness-board/docs/product/gambiarra-2026-08-23/evidence/issue-79/README.md).
```

O supervisor recebeu `SIGUSR1`, encerrou somente o board com `SIGTERM`, reabriu
o mesmo banco e imprimiu `Board restart complete`. Após recarregar, fase,
identidades, claims, tiles ao vivo, decisões, uma devolução e o modelo final
continuaram presentes. No finale móvel, `scrollWidth` e `clientWidth` ficaram
em 380 px.

## Smokes reais dos harnesses

Os novos smokes limitados de OpenCode, Claude Code e Codex receberam
`GAMBI_SMOKE_ACK` e `end_turn` após exatamente um prompt por harness, sem retry.
Os bridges ausentes de Claude Code e Codex foram usados somente a partir de um
prefix/cache efêmero já removido. Versões, integridades, lifecycle, limites e a
pós-condição de cleanup estão registrados em
[`../real-harness-smokes-2026-08-22.md`](../real-harness-smokes-2026-08-22.md).
