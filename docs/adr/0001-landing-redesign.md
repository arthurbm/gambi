# ADR: Reposicionamento da Landing Page (problem-first)

**Status:** Aceito
**Data:** 2026-04-29
**Escopo:** `apps/docs` (landing + docs de use cases)
**Substitui parcialmente:** `docs/PLAN-landing-docs.md` (plano removido na reorg de docs em 2026-05-17; conteúdo histórico no git log)

> **Nota editorial (2026-05-17):** durante a reorganização da pasta `docs/`, paths citados nesta ADR foram atualizados in-place para refletir a nova estrutura (`docs/reference/`, `docs/adr/`, `docs/product/`). O conteúdo decisório do documento não foi alterado.

---

## 1. Contexto

A landing atual (`apps/docs/src/components/Lander.astro` + `apps/docs/src/content/docs/index.mdx`) e a página de use cases (`apps/docs/src/content/docs/guides/challenges.md`) foram escritas no momento em que o produto se vendia como "share local LLMs across your network". Esse posicionamento é solution-first e não reflete a direção em que o projeto está caminhando.

Restrições e contexto que moldaram esta decisão:

- **O produto atual entrega substrato, não orquestração.** Hub HTTP + túnel WebSocket + roteamento OpenAI-compatible + SSE. Fim. `docs/product/vision.md` é explícito que orquestração de agentes está fora de escopo agora.
- **A direção futura é umbrella, modelo LangChain.** O dono pretende, no longo prazo, transformar `gambi.sh` numa página de marca com vários produtos-irmãos (sendo "Gambi Agents" um dos próximos). O produto atual será renomeado em outra iteração.
- **Os use cases atuais são fracos.** "Dev Teams", "Hackathons", "Research Labs", "Home Labs", "Education" são genéricos e não dão visão. Em particular:
  - **Hackathon é teatral.** Em hackathon real cada dev usa frontier model em harness (Claude Code, Codex), não pluga seu Ollama na sala dos amigos.
  - **Home Server é descartável.** Tailscale e similares resolvem isso melhor e com mais segurança. O fato de a Gambi ter túnel é incidental, não é o pitch.
- **Multi-pessoa é uso secundário, não primário.** O modelo room/participant suporta, mas o uso real majoritário é um único dev misturando provedores (Ollama local + cloud APIs) atrás de uma sala. Ancorar o produto em "junte os LLMs da galera" foi gambiarra retórica.

---

## 2. Decisões

### D1 — Posicionamento: "fabric + canvas"

A landing apresenta a Gambi como **substrato (sala) onde experiências multi-LLM acontecem**. A hero fala da experiência (canvas); a sub-hero ancora na realidade técnica (fabric/sala).

**Rejeitadas:**
- *Pivot puro pra "experiências colaborativas"* — overpromise, orquestração não existe ainda.
- *Foco em "AI gateway pra devs"* — perde a alma do projeto, vira commodity vs OpenRouter sem ângulo de vitória.
- *Manter "share local LLMs across your network"* — solution-first; não engaja builders e mistura mensagem com home server.

### D2 — Escopo desta iteração: landing de produto único, brand-aware

> **Parcialmente emendado em 2026-08-16** (§ 7, E1): a rejeição a tiles "coming soon" cai; o resto vale.

Esta iteração **não** transforma a landing em página de marca-guarda-chuva. O produto atual mantém o nome "Gambi" e a página fala dele. A copy é escrita pra que, quando o Gambi Agents existir, a transição pra formato umbrella seja **aditiva**, não destrutiva.

**Rejeitadas:**
- *Reorganizar como brand-page já com tiles "coming soon"* — escopo inflado, força decisão de naming prematura, mostra produto vazio.
- *Ignorar completamente o futuro umbrella* — gera retrabalho na próxima iteração.

### D3 — Hero: framing híbrido (canvas-first, fabric-anchored)

> **Emendado em 2026-08-16** (§ 7, E4): a hero não nomeia categoria — nem "room", nem "gateway".

**Tagline (h1):** "A room where many LLMs collaborate."

**Sub-hero:** "Arenas, judge panels, debate clubs, multi-persona NPCs, model-to-model reasoning chains. Mix local Ollama, vLLM, OpenRouter, OpenAI, or any OpenAI-compatible provider behind a single endpoint, with real-time observability. You write the experience. Gambi is the room."

**Princípios:**
- A hero promete experiência multi-LLM (atrai público builder/indie/researcher).
- A sub-hero **lista exemplos concretos** ("isso é pra mim?" decidido em meia tela).
- A última frase **divide responsabilidade explicitamente**: app escreve a lógica, Gambi entrega o substrato. Anti-overpromise.
- Linguagem fica em inglês (consistente com landing atual; tradução PT-BR fora de escopo).
- Texto acima é **rascunho de tom**; polish exato cabe na implementação.

### D4 — Use cases canônicos (6 cards, grid 3×2)

**Fileira A — Build with many LLMs:**
1. **Model arena** — mesmo prompt em N modelos, comparação lado a lado.
2. **Jury / judge panel** — N modelos votam/criticam/pontuam uma resposta (padrão g-eval).
3. **Draft → critique → polish chain** — cheap-then-strong em cadeia.

**Fileira B — Build experiences:**
4. **Debate club** — modelos discutem com modelo moderador.
5. **Multi-persona NPCs** — um participante por personagem com modelo + prompt próprios.
6. **LAN debate club / classroom arena** — multi-pessoa real (cada um pluga seu LLM).

**Cortados explicitamente:**
- *Capability routing*, *Local + cloud blend*, *Fallback / cost mitigation* — viram benefícios dentro dos cards ou da seção "Built for builders".
- *Multi-LLM observability dashboard* — vira card da seção "Built for builders".

**Justificativa do #6:** multi-pessoa entra como **um card entre seis**, não como pilar. Preserva honestidade do D1 (não é o uso primário) sem amputar o aspecto comunitário do produto.

### D5 — Arquitetura de informação

> **Emendado em 2026-08-16** (§ 7, E3): entra a seção `04 Layers`; install, specs e footer descem um.

Ordem de seções (substitui a ordem atual Hero → Install → Features → How → Use Cases → Code → Footer):

1. **Hero** (problema + sub-hero + CTAs)
2. **Use Cases** (prova narrativa — 6 cards 3×2)
3. **How It Works** (rewriten: foco no que o builder ganha, não no protocolo interno)
4. **Install + Quickstart** (combinados: curl/npm/bun + 1 snippet TS curto)
5. **Built for builders** (ex-Features, reframed pra diferenciação — ver D7)
6. **Footer**

**Mudanças vs atual:**
- *Use Cases* sobe pra logo abaixo do Hero (era seção 5, vira 2).
- *Install* desce pra depois da prova (era seção 2, vira 4).
- *Code Example* funde com *Install* (não é mais seção solta).
- *Features* vira *Built for builders* com conteúdo diferente.

**Rejeitadas:**
- *Manter ordem atual e só reescrever copy* — caminho do covarde, não resolve o problema da página.
- *Hero + install rápido inline + use cases* — perde densidade da prova.

### D6 — Profundidade e formato dos cards de use case

Cada card: **título + 2-3 frases concretas** (incluindo exemplo prático e 1 linha de "como você implementa") + link **"See pattern →"** pro guia consolidado (ver D8).

**Sem código inline nos cards.** Página fica leve; quem quer código clica no link.

**Rejeitadas:**
- *Title + one-liner* — formato atual fraco.
- *Title + descrição + snippet inline em cada card* — 6 snippets na mesma rolagem cansa, vira repetitivo.
- *Title + descrição + 6 guias separados* — escopo inflado de docs.

### D7 — Seção "Built for builders" (ex-Features, 4 cards)

> **Reafirmado em 2026-08-16** (§ 7, E4): a reprovação de "gateway" vale também para a hero, que divergira na implementação.

1. **Bring any provider, mix freely** — BYO + tunnel + multi-source. Credenciais ficam na máquina do participante; o hub não as vê.
2. **Real-time observability, out of the box** — eventos SSE com TTFT, duração, tokens. Sem bolt-on de Langfuse pra começar.
3. **OpenAI-compatible everywhere** — Responses API + Chat Completions. AI SDK, OpenAI SDK, curl, qualquer tool OpenAI.
4. **Many rooms, one hub** — multi-room scoping; uma sala por app/time/experimento, com participantes/roteamento/eventos próprios.

**"Local-first" e "no signup/no cloud bill"** entram como bullets na intro da seção, **não** como card próprio (commodity, não diferencial).

**Cards rejeitados:**
- *Local-first / no signup* — commodity entre self-hosted; não justifica card.
- *"Rooms, not gateways"* — formulação anterior descartada (termo "gateway flat" especificamente reprovado).

### D8 — Guia consolidado de patterns

Criar **`apps/docs/src/content/docs/guides/patterns.mdx`** com **6 seções** (uma por use case), cada uma com:
- 1-2 parágrafos de explicação
- Snippet TS curto usando o SDK
- Anchor link compatível com os cards da landing (`#model-arena`, `#jury-panel`, etc.)

O `challenges.md` original é **deletado** (conteúdo é absorvido e melhorado — o atual está raso).

### D9 — Limpeza de guias antigos

**Deletados:**
- `apps/docs/src/content/docs/guides/homelab.md` — framing de home server descartado em D1.
- `apps/docs/src/content/docs/guides/hackathon.md` — framing teatral, não corresponde ao workflow real (hackathon = frontier model + harness).
- `apps/docs/src/content/docs/guides/challenges.md` — absorvido em `patterns.mdx` (D8).

**Mantidos:**
- `quickstart.mdx`
- `custom-participant.mdx`
- `remote-providers.md`
- `ai-tools.md`
- `migrate-from-gambiarra.mdx`

`apps/docs/astro.config.mjs` precisa ter o sidebar atualizado (remover deletados, adicionar `patterns.mdx`).

### D10 — Tratamento do Gambi Agents

> **Revogado em 2026-08-16** (§ 7, E1 e E2). O texto abaixo é histórico: a landing ganha seção de camadas e o link de profundidade é `whats-next.mdx`.

**Sem teaser explícito na landing.** A direção futura fica embedada na linguagem da hero ("You write the experience. Gambi is the room." sugere que a sala pode ganhar maestro depois sem reaprender vocabulário).

**Caminho discreto:** link no footer pra `/explanation/why-gambi/` (que pode ganhar um parágrafo de "what's next" referenciando `docs/product/vision.md`) **ou** criar `apps/docs/src/content/docs/explanation/whats-next.mdx` puxando conteúdo de `docs/product/vision.md`. Decisão entre as duas variantes fica pra fase de implementação.

### D11 — Naming do produto atual: intacto

O produto continua sendo "Gambi" nesta iteração. CLI binary, npm packages (`gambi`, `gambi-sdk`, `gambi-tui`), repo, install scripts — tudo inalterado. Renomear é projeto separado, fora de escopo.

---

## 3. Não-objetivos

- Renomear pacotes, CLI ou repo
- Decidir o nome final do produto-de-hoje no contexto umbrella
- Implementar Gambi Agents (mesmo que stub)
- Adicionar autenticação ao hub
- Mudar contratos da API/SDK
- Refatorar `Hero.astro` ou `astro.config.mjs` além do necessário pro sidebar update e wiring do `Lander`
- Traduzir landing pra PT-BR
- Decidir tipografia, paleta, ilustrações, animações (responsabilidade da fase `/frontend-design` seguinte)

---

## 4. Mudanças concretas (mapa de arquivos)

**Editar:**
- `apps/docs/src/components/Lander.astro` — reorganização de seções (D5), copy nova (D3, D7), 6 cards de use case (D4 + D6).
- `apps/docs/src/content/docs/index.mdx` — atualizar `description` e `tagline` no frontmatter pra D3.
- `apps/docs/astro.config.mjs` — atualizar sidebar (remover `homelab`, `hackathon`, `challenges`; adicionar `patterns`).
- `apps/docs/src/content/docs/explanation/why-gambi.mdx` *ou* criar `apps/docs/src/content/docs/explanation/whats-next.mdx` (D10).

**Criar:**
- `apps/docs/src/content/docs/guides/patterns.mdx` — guia consolidado com 6 seções (D8).

**Deletar:**
- `apps/docs/src/content/docs/guides/homelab.md`
- `apps/docs/src/content/docs/guides/hackathon.md`
- `apps/docs/src/content/docs/guides/challenges.md`

**Antes de deletar:** rodar `grep -r "guides/homelab\|guides/hackathon\|guides/challenges"` no repo (incluindo `apps/`, `packages/`, `README.md`, `docs/`) pra mapear referências cruzadas. Atualizar links em vez de deixar quebrados.

**Verificações pós-mudança:**
- `bun run --cwd apps/docs build` (sem warnings de link quebrado).
- `bun run --cwd apps/docs dev` + smoke visual: hero, use cases (6 cards), how it works, install + snippet, built for builders (4 cards), footer.
- Confirmar links dos cards pro `patterns.mdx` (anchors funcionam).
- Confirmar nenhum 404 nos guias antigos (redirects opcional, mas grep deve garantir que ninguém mais aponta pra eles).

---

## 5. Riscos e itens em aberto

- **Texto exato dos cards** é polish, não decisão arquitetural. Os rascunhos da entrevista servem como ponto de partida; ajustes finais cabem na implementação.
- **Direção visual / estética** é responsabilidade da próxima fase (`/frontend-design`). Esta ADR não decide tipografia, paleta, layout exato, ilustrações ou animações.
- **Card "Many rooms, one hub"** pode soar fraco visualmente. Candidatos alternativos pra teste: "Multi-room hub", "Rooms with scope", "Per-app rooms". Decisão final na implementação.
- ~~**`/explanation/why-gambi.mdx` vs `/explanation/whats-next.mdx`** (D10) — depende de quanto contexto adicional cabe lá sem virar texto-frankenstein.~~ — **resolvido em 2026-08-16** (§ 7, E2): `whats-next.mdx`.
- **Links internos espalhados** podem referenciar `homelab.md`/`hackathon.md`/`challenges.md` em outros guias, no `README.md` raiz, ou em READMEs de workspace. Grep antes de deletar.
- **Conteúdo de `apps/tui/README.md` e similares** pode citar use cases descartados — fora de escopo desta ADR, mas vale grep pra catar referências quebradas.
- ~~**`docs/PLAN-landing-docs.md`** segue parcialmente válido (estrutura de pastas, design system, copy-to-clipboard). Não deletar; sobrescrever só o que esta ADR diverge.~~ — **superado em 2026-05-17:** o plano foi removido na reorg de docs; consultar git log se precisar do conteúdo histórico.

---

## 6. Implementação (próximos passos sugeridos)

1. Aprovar ADR.
2. Rodar grep pra mapear referências aos arquivos a serem deletados.
3. Criar `patterns.mdx` com as 6 seções (pode reaproveitar parágrafos do `challenges.md` original).
4. Reescrever `Lander.astro` seção por seção, na ordem do D5.
5. Atualizar `astro.config.mjs` (sidebar).
6. Deletar os 3 guias.
7. Atualizar/criar página de "what's next" do D10.
8. `bun run --cwd apps/docs build` + smoke visual.
9. Commit Conventional (`feat(docs): redesign landing problem-first` ou `docs(landing): pivot to multi-llm experiences framing`).

A fase visual/estética é tratada separadamente via `/frontend-design` (próxima invocação prevista).

---

## 7. Emendas

### 2026-08-16 — Seção de camadas, ordem do D5 e vocabulário da hero

**Origem:** ticket [#59](https://github.com/arthurbm/gambi/issues/59) do mapa de wayfinding [#58](https://github.com/arthurbm/gambi/issues/58) (repaginação da landing).
**Motivação:** a `docs/product/research-direction.md` (2026-06-17) explicitou o modelo em camadas — substrato hoje, primitivas sociais adiante — e a repaginação da landing quer refleti-lo. O D10 desta ADR proibia teaser explícito; esta emenda o revoga sob condições.

#### E1 — Revoga o D10: entra uma seção de camadas

A landing ganha uma seção dedicada às camadas, com a cebola da `research-direction.md` (simplificada para 3 faixas) como peça visual. A seção fala **no presente** sobre o que existe e marca a camada seguinte com um badge `coming soon`.

**Limites que a seção respeita:**
- Não nomeia produto futuro. "Gambi Agents" não aparece (mantém o D2: não força decisão de naming prematura).
- Não usa termo de arte na copy pública: sem "substrate", "social primitives", "room", "gateway" (ver E6).
- O "adiante" é dito por **badge**, não por prosa — a seção não explica que é pesquisa.

**Também revoga, do D2,** a rejeição a tiles "coming soon". A rejeição valia contra reorganizar a página inteira em formato umbrella com produto vazio; um badge numa faixa de diagrama não é isso. O resto do D2 (landing de produto único, brand-aware, transição aditiva) permanece.

**Rascunho de copy** (polish exato cabe na implementação):

```text
04  / layers
    What Gambi handles — and what still lands on you

    Gambi moves the messages between models. Everything about how the
    conversation actually runs is still your code.

    [ cebola: 3 faixas ]
      What you build          — arenas · debates · juries · multi-persona NPCs
      Turn-taking · shared context · models talking to models   [ coming soon ]
      One endpoint. Many models, many machines, many people.    [ today ]

    The turn-taking is your code. The shared context is your code.
    Keeping track of who said what to whom is your code. Gambi does not
    help you there — yet.

    Where this is going →   /explanation/whats-next/
```

**Enquadramento escolhido:** a seção descreve **o trabalho que hoje sobra pro leitor** (turnos, contexto compartilhado, bookkeeping), não os conceitos da camada. Quem já construiu algo multi-modelo reconhece a dor sem precisar aprender vocabulário; o "yet" mais o badge fazem o teaser sem substantivo abstrato.

**Rejeitados:** seção só-filosofia em presente puro (não entrega o "adiante" que a repaginação pede); teaser de roadmap explícito (overpromise que o D1 rejeitou); nomear "social primitives" cru (jargão de tese, ilegível pra quem chega frio).

#### E2 — Resolve o item em aberto do D10: `whats-next.mdx`

O link de profundidade aponta para **`apps/docs/src/content/docs/explanation/whats-next.mdx`** (novo, curto, puxando de `docs/product/vision.md`). `why-gambi.mdx` permanece sobre o nome apenas.

**Motivo:** o `why-gambi.mdx` hoje trata exclusivamente da origem do nome (gambi ← gambiarra) e não tem uma linha sobre camadas; enxertar ali produziria o "texto-frankenstein" que a seção 5 desta ADR já listava como risco.

**Rejeitado:** linkar `docs/product/research-direction.md` no repo — o doc se declara "intenção de pesquisa, não plano comprometido" e leitor público leria como roadmap.

**Cortável:** se o prazo apertar, a seção funciona sem link de profundidade.

#### E3 — Emenda o D5: nova ordem de seções

```text
01 Hero · 02 Use Cases · 03 How It Works · 04 Layers ·
05 Install + Quickstart · 06 Built for builders · 07 Footer
```

A seção de camadas entra **depois** da How It Works: o leitor acabou de ver onde a Gambi encaixa no stack dele, e a pergunta seguinte natural é o que existe acima disso. Preserva o princípio do D5 (prova antes de pitch) e mantém a cebola em slot de meio de página.

**Rejeitados:** logo após a hero (pede fé antes de dar prova, desfaz o D5); antes do footer (enterra a peça visual central da página).

#### E4 — Emenda o D3 e reafirma o D7: a hero não nomeia categoria

```diff
-Gambi ships the gateway. You ship the experience.
+Gambi connects the models. You write what happens between them.
```

O `Lander.astro` implementado dizia "gateway", termo que o D7 já reprovava — divergência entre ADR e código corrigida aqui. "Room" também sai da primeira tela: é o vocabulário interno do produto (`gambi hub` cria salas) mas não significa nada para quem chega frio.

**Motivo estrutural:** "gateway" é plano por definição; uma página que argumenta camadas não pode se chamar gateway na primeira tela sem contradizer a seção 04 três scrolls depois. A formulação escolhida carrega a divisão de trabalho sem termo de arte nenhum.

#### E5 — Gambiarra Club fora desta iteração

A landing **não** menciona o [Gambiarra Club](https://gambiarra.club). A menção volta quando houver exemplos concretos do que aconteceu nas edições — procedência com evidência, não link de comunidade.

#### E6 — Vocabulário interno vs. copy pública

"Substrato", "primitivas sociais" e "social-ready" são vocabulário **interno** (docs de produto e pesquisa). Não entram em copy pública. Registrado no `CONTEXT.md` § Flagged ambiguities.

#### Impacto no mapa de arquivos (seção 4)

- `apps/docs/src/components/Lander.astro` — nova seção 04 + reordenação (E1, E3) + hero (E4). **Nota:** a repaginação em curso ([#58](https://github.com/arthurbm/gambi/issues/58)) move a landing para `apps/docs/src/pages/index.astro`; a emenda vale para onde a landing viver.
- **Criar** `apps/docs/src/content/docs/explanation/whats-next.mdx` (E2).
- `why-gambi.mdx` sai do mapa de arquivos — não é mais tocado (E2).
