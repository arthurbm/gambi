# Direção de pesquisa: experiências sociais entre LLMs (TCC)

**Status:** Exploratório — intenção de pesquisa, não plano comprometido.
**Data:** 2026-06-17
**Relacionado:** [`vision.md`](./vision.md) (Gambi Agents), [`../adr/0003-tunnel-first-transport.md`](../adr/0003-tunnel-first-transport.md), [`../adr/0001-landing-redesign.md`](../adr/0001-landing-redesign.md)

> Este documento registra a intenção de pesquisa/TCC do mantenedor. **Não é uma ADR** (não decide nada irreversível) nem um **PRD** (não há escopo de entrega). Serve para alinhar a conversa com o orientador e ancorar futuras PRDs/issues.

## Tese

Gambi como a **infraestrutura/protocolo prático onde experiências sociais entre LLMs acontecem** — em eventos presenciais e dentro de produtos. Aqui "social" significa uso conjunto de múltiplos modelos (e das pessoas por trás deles) para uma tarefa, uma conversa, um jogo, um debate — qualquer interação multi-participante.

O [**Gambiarra LLM Club**](https://gambiarra.club) é o campo de experimentação e validação: eventos reais, com pessoas reais plugando seus LLMs locais numa sala compartilhada.

## Duas camadas (e onde a pesquisa mora)

```
┌──────────────────────────────────────────────────────────────┐
│  Experiências sociais  (apps / eventos)                       │
│  arenas · debates · jurados · jogos · NPCs multi-persona      │
└───────────────────────────┬──────────────────────────────────┘
                            │ constrói sobre
        ┌───────────────────┴────────────────────┐
        │ (ii) Primitivas sociais   [PESQUISA/TCC]│  ← "Gambi Agents"
        │ turnos · conversa · contexto compart.   │    (parkado p/ produto
        │ interação entre agentes pessoais        │     em vision.md)
        └───────────────────┬────────────────────┘
                            │ sobre
        ┌───────────────────┴────────────────────┐
        │ (i) Substrato social-ready   [PRODUTO]  │  ← Gambi hoje
        │ hub · túnel · roteamento · presença     │
        │ observabilidade · join sem fricção      │
        └───────────────────┬────────────────────┘
                            │ tunnel-first (ADR-0003)
        ┌───────────────────┴────────────────────┐
        │ LLMs locais das pessoas (Ollama, etc.)  │
        └─────────────────────────────────────────┘
```

- **(i) Substrato social-ready — produto de hoje, lean.** Hub + túnel + roteamento OpenAI-compatible + observabilidade. A sala torna multi-participante trivial (join sem fricção, presença, eventos), e a *lógica social* é construída pela aplicação. É onde o produto deve investir agora (adotabilidade), e é o que `vision.md` já delimita.
- **(ii) Primitivas sociais — fronteira de pesquisa (TCC) / "Gambi Agents".** Turnos, conversa entre participantes, contexto compartilhado, interação entre agentes pessoais. É a camada de orquestração que `vision.md` explicitamente parkou para o produto — e é justamente a matéria-prima de uma contribuição de pesquisa: propor e validar um *protocolo* para interação social entre LLMs heterogêneos sobre transporte tunnel-first.

## Evidência motivadora

Um membro do clube (caso `gambiarra-arena`, prof. Filipe Calegario) reconstruiu o stack inteiro — transporte, registro de participante, presença, roteamento e até uma arena 2D — em vez de usar o Gambi. A causa-raiz foi a **parede de adotabilidade do substrato** (onboarding só por CLI, sem modo de dev local, sem história guiada de "construa sobre mim"; somado a falhas de erro silencioso — issues #54 e #55), **não** falta de primitivas sociais: ele construiu 6 jogos sociais sozinho.

Leitura: o substrato (i) precisa ficar adotável **antes** de a camada (ii) ter público. E a camada (ii) é o que diferencia o Gambi de gateways tipo OpenRouter — "ponha o LLM da galera na sala" é a moldura que eles não copiam.

## Tensão a namorar

- **Produto** quer substrato lean (i).
- **Pesquisa/TCC** quer empurrar a fronteira do protocolo (ii).

As duas coisas convivem, mas cada decisão deve rotular qual chapéu está usando — para o produto não overpromise orquestração que ainda não existe, e para a pesquisa não ficar refém do roadmap de produto.

## Enquadramento de pesquisa (em alinhamento — 2026-06-17)

**Tipo de contribuição:** artefato de **sistemas/protocolo (a)** com um fio de **HCI/experiência (b)**. O foco é projetar/construir/avaliar a camada de interação social; o clube fornece validação de campo que naturalmente gera evidência de experiência.

**Unidade de participação: agente pessoal, não só endpoint de modelo.** O objeto evoluiu de "LLMs" para **agentes** — na linha dos "Claws" (Karpathy, 2026-02): uma camada acima dos agentes de LLM que leva orquestração, escalonamento, contexto, tool-calls e persistência a outro nível (ex.: NanoClaw, ~4k linhas, configurável via skills). Cada participante é um *agente pessoal* (identidade, memória, ferramentas, autonomia), não um endpoint roteável.

**Desiderata:** comunidade de agentes/modelos **heterogêneos**, **configs diferentes**, **sob demanda**, contribuídos por **pessoas**. Local-first é **um sabor** (a proposta do clube), **não** a restrição — não focar exclusivamente em local.

**Hipótese de gap:** existe a camada de **agente pessoal** (Claws — centrada em um usuário) e a de **chamada agente↔agente** (A2A, Google — ponto-a-ponto, orientada a tarefa). Falta a **camada SOCIAL multi-parte**: um modelo + infra para muitos agentes pessoais (mesma plataforma *ou* entre plataformas) co-participarem de experiências sociais compartilhadas (debate, colaboração, jogo, conversa) — com estado compartilhado, dinâmica de participação/turnos, humano no loop e observabilidade. Claws são single-user; A2A é ponto-a-ponto/tarefa; ninguém dona a experiência social multi-parte.

**Humano no loop (dimensão central, a explorar).** Não é só multiagente: o **humano participa ativamente** — controlando agentes, fazendo *steering*, participando diretamente — **ao lado** de agentes autônomos. Experiências sociais **mistas humano-agente**. Encaixa na pegada de criatividade computacional/HCI e reforça o lado (E).

**Papel do Gambi:** **instrumento / implementação de referência / host** — não a tese. A tese é maior que o Gambi.

**Disciplina-casa: criatividade computacional.** O orientador é de **computação** (forte em agentes/IA) e costuma pegar projetos de **criatividade computacional** — que por natureza combinam *construir um sistema* + *estudar a experiência/artefato criativo*. Isso dissolve a falsa escolha (P) vs (E): a contribuição é **dupla e conjunta** — o **modelo de experiência (E)** + a **implementação de referência (P)** que o instancia —, exatamente o formato de um TCC de criatividade computacional.

**Orientação (em aberto):** o orientador do clube cobre as duas pontas (agentes + criatividade), então o segundo professor (eng. de software) é **estratégico**, não uma necessidade técnica. Co-orientação a decidir — item pra call.

**Recorte tratável (anti-moonshot) — para não "ficar demais":**
- **Cross-platform = (β) modelo + UM bridge mínimo.** O modelo é agnóstico de plataforma por design; a implementação fica **no Gambi** + **um único** agente externo (ex.: um Claw/NanoClaw ou agente A2A) participando de **uma** experiência, pra provar a generalidade sem virar moonshot. (Rejeitados: α = só argumentar; γ = várias pontes = moonshot.)
- **Poucas experiências.** Ancorar em **1–3 experiências sociais concretas** (ex.: debate, criação colaborativa, jogo), não um catálogo.
- **Não inventar protocolo universal.** Estender o transporte do Gambi e apoiar no que já existe (A2A/MCP como vizinhos), não competir com a Google.

## Fios em aberto (para sessões dedicadas)

- O **protocolo de interação social** em si: turnos, contexto compartilhado, identidade/capacidade dos participantes.
- **Interação entre agentes pessoais** — pessoas representadas por seus próprios agentes na sala.
- **Metodologia de validação** no clube: que métricas, que experiências, que coleta de dados (o `gambiarra-arena` já loga eventos de alto nível — conexões, rodadas, votos, ciclo de vida do mundo).
- Como/se isso **reabre a fronteira de escopo** do `vision.md`.

## Próximos passos

Após fechar o diagnóstico de adotabilidade (issues #54, #55 e os levers de onboarding / dev-mode / build-on), formalizar via `/to-prd` e/ou `/to-issues`:

- o **reposicionamento** (emenda ao ADR-0001, D1/D4);
- os **levers de adotabilidade**;
- o **escopo de pesquisa** da camada (ii).
