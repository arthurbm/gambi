# Depois do evento: mapeado, fora do escopo de 2026-08-23

Decidido no grill de 2026-08-22. Cada item diz por que ficou de fora e o que reabriria.

- **AI SDK v7 e `@ai-sdk/harness-acp`.** Nada do caminho ACP precisa de v7. Migrar com a skill `migrate-ai-sdk-v6-to-v7`; depois avaliar um sandbox provider local (~200 linhas, ver `docs/research/harness-orchestration-options.md`) para rodar `HarnessAgent` sobre o workspace real.
- **Git como publicação do bairro.** "Contribuir = push" é mais fiel à tese; ficou de fora por git server + push em Windows na véspera. Hoje o `gambi join` sincroniza a pasta.
- **Votação e discussão no board.** A primitiva de hoje é draft → decisão → aceitar/devolver. Votação exige múltiplos clientes escrevendo no mesmo objeto; reabrir se a dinâmica pedir.
- **Orquestrador por squad (assembleia).** Hoje é um orquestrador global, hub-and-spoke nomeado. A versão com vários orquestradores é a próxima experiência (Meira et al., Tabela 5.2).
- **Trabalho de plataforma.** Consolidar os tiles e refinar as guidelines do starter a partir do que os squads entregaram, continuamente. Analogia: times de produto (squads) e time de plataforma. Não entra na dinâmica; entra no TCC.
- **Mastra / frameworks.** Só para o TCC (AI SDK nativo, A2A client/server). Nenhum framework tem primitiva para "processo remoto via túnel".
- **Effect v4.** Migração ampla da stack, inspirada em opencode v2 e t3code. Sem relação com o evento.
- **Extrair `gambi-agents` para repo próprio.** Talvez nunca: a preferência atual é `packages/agents` no monorepo, usável de fora. Revisar depois do evento; se mudar, fazer completo (publicação, docs, versionamento), não pela metade.
- **Sandbox para harnesses.** eve.dev, Flue, Vercel Sandbox: todos para construir agentes em nuvem. Hoje o sandbox é o PC da pessoa.
- **ACP v2.** Pinado em v1; acompanhar o draft (muda `session/prompt` e `session/load`).
