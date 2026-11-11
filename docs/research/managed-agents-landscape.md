# Agentes gerenciados e colaborativos: mapa de mercado

**Status:** pesquisa, 2026-11-10. Gerado por agente a partir de documentação oficial, do clone local do T3 Code (`80e62619f5`, 2026-11-10) e do clone local do opencode (`17c95db`, 2026-11-10). Nada aqui é decisão.
**Contexto:** [`../product/vision.md`](../product/vision.md) (Gambi Agents), [`../product/research-direction.md`](../product/research-direction.md) (camada social / TCC), [`../adr/0006-harness-participants-over-acp.md`](../adr/0006-harness-participants-over-acp.md), **Managed hub** em [`../../GLOSSARY.md`](../../GLOSSARY.md).
**Pergunta:** se o Gambi ganhar uma versão operada pelo projeto (Managed hub), o que o mercado já faz, e onde o Gambi se encaixa sem virar mais uma plataforma de colaboração?

Este mapa está incompleto de propósito. O mantenedor tem várias outras soluções salvas (Twitter) e quer se aprofundar depois; elas entram na seção [A explorar](#a-explorar).

## Resumo

- Os produtos de 2026 resolvem "um time coordena agentes" com um coordenador, execução em nuvem e um chat compartilhado. Quem paga e quem executa é a conta ou o workspace.
- O T3 Code resolve "uma pessoa orquestra harnesses em várias máquinas suas". Não tem sala nem time.
- Não achei, nesta rodada, produto em que pessoas diferentes emprestam o próprio harness ou modelo, sob o próprio login, a um grupo. Isso é ausência na documentação lida, não prova de que não existe.
- Essa propriedade só importa para grupos sem pagador comum (clube, sala de aula, hackathon, comunidade open source). Empresa com orçamento não precisa dela.

## Mapa

| Produto | Lançamento | O que faz | Quem executa e quem paga | Fonte |
|---|---|---|---|---|
| Amp Spaces | 2026-11-06 | Um space é uma conversa com um agente que cria e coordena outros agentes; threads em paralelo como cards; compartilhável com workspace ou grupos; integração com Slack | "Orbs" (máquinas do Amp, uma por thread) ou "runners" (`amp --no-tui` na máquina de alguém). Space compartilhado só usa orbs ou runners compartilhados com o workspace, e a thread roda como quem iniciou o runner | https://ampcode.com/news/spaces · https://ampcode.com/docs/spaces · https://ampcode.com/docs/cli/runners |
| T3 Code (Orchestrator V2) | clone de 2026-11-10 | Control plane por máquina; threads duráveis sobre vários harnesses; delegação entre providers, modelos e máquinas pela própria API MCP | Uma pessoa, várias máquinas. Cada link executa como o usuário da máquina que o recebe | `docs/orchestration-v2/README.md` no clone |
| Slack Code | 2026-08-20 | "Code channels" em que time e agentes (Claude, ChatGPT, Devin, Copilot, Vercel) planejam e revisam | Agentes de terceiros, pagos à parte | https://www.salesforce.com/slack/introducing-slack-code/ |
| Warp Oz | 2026-02-10 | Orquestra agentes em nuvem ou self-hosted, com link compartilhável e trilha de auditoria | Nuvem do Warp ou infraestrutura própria | https://www.warp.dev/newsroom/2026/2/10/warp-launches-oz-the-orchestration-platform-for-cloud-coding-agents |
| Cursor Projects | 2026-09-10 (beta) | Coordenador planeja e delega a agentes; arquivos e task tracker compartilhados entre máquinas | Conta Cursor | https://cursor.com/changelog/projects |
| Devin Desktop | 2026-06-02 | Agent Command Center em kanban, "Spaces" próprios e registro ACP de agentes de terceiros gerido pelo admin | Conta Devin | https://devin.ai/blog/windsurf-is-now-devin-desktop |
| Augment Cosmos | não verificado | Frotas de agentes acionadas por eventos do ciclo de desenvolvimento | não verificado | https://www.augmentcode.com/product/cosmos |
| Superconductor | não verificado | Sessões de agente que colegas observam ou assumem | não verificado | só fonte secundária |

Preço do Amp: não há preço próprio para Spaces; Hobby custa US$ 0 com pay-as-you-go, Megawatt US$ 20/mês com 45.000 minutos de orb (https://ampcode.com/docs/pricing). Disponibilidade de Spaces por plano: não verificado.

## T3 Code em detalhe

É a referência mais próxima do desenho do Gambi, por isso o detalhe.

**Modelo.** Environment é um servidor numa máquina, dono dos arquivos, das credenciais e do estado. Um agente delega pela tool MCP `delegate_task(task, target{provider|model|environmentId})`; a thread filha recebe só o prompt e devolve o resultado por transferência de contexto. A filha nunca recebe permissão mais ampla que a do pai.

**Entre máquinas não há hub central.** Um environment entra no `/mcp` de outro como cliente MCP externo (OAuth com PKCE e pairing code). O transporte é HTTP/WebSocket direto, por LAN, Tailscale, SSH ou T3 Connect.

**T3 Connect é a parte gerenciada.** O que ela faz e o que não faz:

- Identidade de conta via Clerk. O Clerk não autoriza nada dentro do environment.
- Um relay em Cloudflare Worker provisiona um Cloudflare Tunnel por máquina, na conta da T3. O host roda `cloudflared` e abre a conexão de saída.
- O relay não faz proxy do tráfego da aplicação. Ele só faz o bootstrap: assina um pedido de credencial válido por 2 minutos, e o próprio environment emite a sessão (DPoP, 1 hora).
- Limite de 3 máquinas por conta no plano gratuito. Celulares e browsers não contam.

**Guest links.** Um convidado sem conta abre `https://<host>/guest#<shareId>.<HMAC>`, lê a thread e propõe mensagens; o dono aprova com Send ou Dismiss. O segredo vai no fragmento da URL, o resgate é de uso único, o link expira em 24 horas e nada secreto é armazenado.

**Multiusuário.** Não há times, salas nem threads compartilhadas entre contas. As exceções parciais são os guest links e as políticas de organização aplicadas a uma máquina.

Correspondência com o vocabulário do Gambi:

| T3 Code | Gambi |
|---|---|
| Cloudflare Tunnel iniciado pelo host | Tunnel (WebSocket iniciado pelo participant) |
| Environment | Participant |
| Provider instance (Codex, Claude, ACP…) | Harness participant |
| `/mcp` com OAuth, `delegate_task` | Management plane mais `client.harness.attach()` |
| T3 Connect (alcance e identidade) | Managed hub, se existir |
| Várias pessoas no mesmo lugar | Room: sem equivalente no T3 Code |

Padrões do T3 Code que um hub HTTP + WebSocket sem auth adotaria rápido: token de capacidade por sala no fragmento da URL; resgate do link em cookie de sessão; ticket curto para o upgrade de WebSocket; bind em loopback com proxy autenticado na frente; aprovação humana para mensagens de convidado. Padrões que custam semanas: túnel provisionado por usuário, relay de controle com contas, DPoP, rotas múltiplas com failover, app nativo.

## Restrições de fornecedor que afetam o desenho

- **Assinatura Claude não serve terceiros.** A Anthropic não permite intermediar uso de assinatura para usuários finais; cada pessoa autentica com a própria credencial. Claude Code headless na máquina do dono é uso documentado (`claude setup-token`). Fonte: https://code.claude.com/docs/en/legal-and-compliance.md. A ADR-0006 já recusa Claude Code hospedado por esse motivo.
- **Codex com login do ChatGPT:** a OpenAI recomenda API key para fluxos programáticos e pede para não expor a execução em ambientes públicos. Fonte: https://learn.chatgpt.com/docs/auth. Termos do plano para esse uso: não verificado.
- **Modelos gratuitos do opencode só funcionam dentro do opencode.** Outros clientes recebem 403, mesmo com API key (`services/site/src/docs/content/console/api/inference.mdx` no clone; não testado). Na prática, modelo gratuito entra numa sala como harness participant, não como endpoint.
- **Nenhuma key gratuita única aguenta dezenas de pessoas ao mesmo tempo.** OpenRouter `:free`: 20 req/min e 50 req/dia, ou 1.000/dia com créditos (https://openrouter.ai/docs/api_reference/limits). Cerebras: 5 RPM. GitHub Models foi aposentado em 2026-07-30.

A primeira restrição tem uma leitura dupla. Ela favorece o modelo "cada um traz o seu login". Ela também deixa em zona cinzenta emprestar o próprio harness de assinatura para outras pessoas mandarem prompts.

## Leitura (hipótese, não decisão)

Dizer que "a sala é o diferencial" é fraco: sala é contêiner. O que é estruturalmente diferente no Gambi é a posse: cada pessoa mantém a máquina, o login e a conta, e empresta a um grupo. No T3 Code uma pessoa é dona de tudo. No Amp o workspace paga e o runner compartilhado roda como quem o iniciou.

Isso é uma propriedade. Para virar diferencial precisa de um público que dependa dela, e hoje esse público é o próprio clube.

## Fios em aberto

Para uma sessão dedicada; nenhum está decidido.

- **Plataforma.** Há potencial em transformar o Gambi em plataforma de colaboração? Contra: Amp, Slack e Cursor têm distribuição, modelos e orçamento. A favor: "o lugar onde uma comunidade junta os próprios harnesses" não tem dono.
- **Linha entre o Gambi e o que se constrói por cima.** Teste proposto: "precisa saber qual é o trabalho?". O hub sabe quem está na sala, como alcançar cada um e se está livre. Tarefa, turno, papel e voto ficam por cima. Identidade, alcance e permissão de entrada (o Managed hub) ficam abaixo da linha.
- **Gambi como MCP.** O MCP do T3 Code controla as máquinas de uma pessoa e funciona porque tudo roda como essa pessoa. Um MCP do Gambi controlaria harnesses de outras pessoas. Embrulhar o management plane e o `harness.attach()` em tools é barato; o difícil é o consentimento: o que o orquestrador de um estranho pode fazer no meu harness, no meu workspace, na minha assinatura. Hoje o attach não tem auth e transmite tudo a todos os anexados (`packages/core/src/hub.ts`).
- **Consentimento entre pessoas como candidato a diferencial.** Ninguém no mapa resolve isso: o T3 Code evita por ser de um usuário só, o Amp por executar em máquinas próprias ou como quem iniciou o runner. É onde produto e TCC (humano no loop) se encontram.
- **Dependência dos termos de fornecedor.** A tese "empreste seu harness de assinatura ao grupo" depende de como Anthropic e OpenAI tratam esse uso.

## A explorar

Soluções salvas pelo mantenedor para olhar depois. Acrescentar aqui com link, data e uma linha sobre o que cada uma faz.

- _(vazio)_
