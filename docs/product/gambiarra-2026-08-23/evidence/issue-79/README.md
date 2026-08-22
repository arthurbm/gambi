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

O supervisor recebeu `SIGUSR1`, encerrou somente o board com `SIGTERM`, reabriu
o mesmo banco e imprimiu `Board restart complete`. Após recarregar, fase,
identidades, claims, tiles ao vivo, decisões, uma devolução e o modelo final
continuaram presentes. No finale móvel, `scrollWidth` e `clientWidth` ficaram
em 380 px.

## Smoke real do OpenCode

Executado somente depois das validações determinísticas, em Linux, com OpenCode
1.18.21, adapter e model label `opencode`. A prontidão encontrou o binário e uma
autenticação configurada; a saída da autenticação não foi copiada.

Houve exatamente um dispatch e nenhum retry. O participante registrou
`registered`, `tunnel_connected`, `harness_spawned` e `session_opened`, mas não
confirmou o RPC dentro do limite. O board registrou o dispatch como
`delivery_unknown`. Ao encerrar o participante com Ctrl+C, ele publicou uma
versão final dos quatro arquivos iniciais sem alteração do modelo. O board
validou o artefato, e a revisão o aceitou e publicou como versão 1. O terminal
registrou `artifact_sent`, `harness_exited` com código 130 para o processo ACP e
`left`; o comando participante e o supervisor encerraram com código 0. Nenhum
processo `opencode acp` permaneceu.

Resultado: o ciclo de registro, túnel, workspace, ingestão, validação, aceite,
publicação e cleanup passou. A confirmação e execução do prompt real não
passaram; o erro exato foi `The harness did not acknowledge the prompt`, sem
segunda tentativa.
