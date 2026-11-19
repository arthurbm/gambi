# ADR: Tunnel-First Transport

**Status:** Aceito (implementado)
**Data:** pré-histórico (implementado nas versões iniciais do hub) / 2026-05-20 (registrado como ADR)
**Escopo:** `packages/core` (hub + participant runtime), `packages/sdk` (participant session), `packages/cli` (`participant join`)

> **Nota (2026-11-18, Gambi 0.8):** a decisão desta ADR (o participante abre o túnel, o hub nunca origina conexão, `ParticipantAuthHeaders` ficam no participant runtime) continua valendo. O mecanismo mudou com a [ADR-0007](0007-effect-as-runtime-foundation.md): o túnel passou a usar chamadas tipadas de `effect/rpc` no lugar dos frames `tunnel.*`, o heartbeat HTTP saiu e o status do participante deriva só do túnel, o runtime reconecta sozinho com o mesmo `participantId`, e o registro não devolve mais `tunnel.url`. Hub e participantes precisam estar na mesma minor. A seção 3 cita um "retry de bootstrap" no participant runtime que nunca existiu no código: antes do 0.8 o runtime não repetia nem o registro nem a abertura do túnel. Os contratos em vigor estão em [`docs/reference/contracts.md`](../reference/contracts.md#tunnel-calls). O corpo desta ADR não foi alterado.

---

## 1. Contexto

O hub precisa rotear requests OpenAI-compatible (`/rooms/:code/v1/*`) para o provider que cada participante expõe. O cenário-alvo é um dev rodando Ollama em `localhost`, ou um grupo numa rede local rodando vários providers heterogêneos (Ollama, vLLM, OpenRouter via proxy, OpenAI direto).

A escolha do **sentido da conexão entre hub e participante** define o modelo de segurança, o esforço de setup do usuário, e quem detém credenciais sensíveis.

Restrições:

- **Gambi assume rede local confiável.** Não há auth nativa no hub (ver invariant em `AGENTS.md`); expor publicamente exige proxy externo. Isso amplifica o custo de qualquer credencial residente no hub.
- **Providers rodam em endpoints sem reachability garantida.** `localhost:11434` do Ollama na máquina do dev não é (e não deveria ser) accessível pela máquina do hub na rede local.
- **Auth headers de provider são sensíveis.** Quando o participante usa OpenRouter/OpenAI via proxy local, o header carrega API key real.

---

## 2. Decisão

O **participante** abre a conexão de longa duração com o hub via WebSocket. O **hub** despacha cada inference request para dentro desse túnel. O hub nunca origina conexão de volta para o participante.

Mecanismo:

1. Participante registra via `PUT /v1/rooms/:code/participants/:id` (idempotente, definido em ADR-0002). Response inclui `tunnel: { url, token }`.
2. Participante abre WebSocket em `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
3. Token de bootstrap é single-use, TTL 60s — só serve pra autenticar o upgrade WebSocket.
4. Daí em diante, o hub envia `tunnel.request` por esse socket; participante stream-de-volta `tunnel.response.{start,chunk,end,error}`.
5. Heartbeat de management (`POST /v1/rooms/:code/participants/:id/heartbeat`) e ping/pong do túnel rodam em paralelo, ambos com cadência `HEALTH_CHECK_INTERVAL` (10s). Janela de offline: `PARTICIPANT_TIMEOUT` (30s).

### Alternativas rejeitadas

- **Hub chama endpoint do participante diretamente via HTTP** (modelo "gateway clássico").
  Rejeitado porque exige que cada participante exponha seu provider em URL reachable pelo hub. Em rede local isso é dor (firewall, NAT, mDNS frágil); em rede privada heterogênea (VPN parcial, Tailscale opcional), inviável. Também forçaria o hub a deter credenciais (próximo ponto).

- **Hub guarda `ParticipantAuthHeaders` e injeta em outbound HTTP.**
  Rejeitado porque o hub vira repositório de credenciais sensíveis sem ter auth própria. Vazamento via management API (`GET /v1/rooms/:code/participants/:id`) seria caminho fácil de exfiltração. Tunnel-first elimina a classe inteira de bugs: hub jamais vê os headers.

- **Reverse-tunnel externo (ngrok, cloudflared, frp).**
  Rejeitado porque adiciona dependência fora do binário do gambi, complica setup ("instale ngrok e crie token"), e empurra trust pra terceiros. O ganho — reachability sem WebSocket próprio — não justifica.

- **Polling do participante (participante puxa "tem job?" via long-poll).**
  Rejeitado porque latência de TTFT vira refém do intervalo de poll, e SSE/streaming exige stream bidirecional. WebSocket dá o mesmo padrão de longa duração com semântica clara de fechamento.

- **mDNS estrito + assunção de reachability LAN.**
  Considerado e descartado: mesmo em LAN, dev runs com `127.0.0.1` precisariam expor `0.0.0.0`; quebra o "uso secundário" do gambi (um único dev misturando providers atrás de uma sala — ver `docs/product/vision.md`).

---

## 3. Consequências

### Invariantes derivadas

- **`ParticipantAuthHeaders` nunca chegam ao hub.** Aplicados apenas no leg participante→provider local, dentro do `createParticipantSession()` em `packages/core/src/participant-session.ts`. O management plane jamais os surface.
- **`ParticipantConnection.kind === "tunnel"`** sempre. Não existe outro transport.
- **Token de bootstrap single-use, TTL 60s.** Implementado em `hub.ts` (`tunnelBootstrapRegistry`).
- **`status` e `connection.connected` são ortogonais.** Um participante pode estar registrado e heartbeating sem ter tunnel ativo; routing só considera quando os dois batem.

### Trade-offs aceitos

- **Disconnect do hub interrompe in-flight requests.** Não há reconnect transparente do request meio-fluxo. Aceito porque o cenário-alvo é rede local com hub estável; reconnect resiliente entra em escopo futuro se virar problema real.
- **Participant runtime mais pesado.** O participante mantém WebSocket aberto, heartbeat HTTP em paralelo, retry de bootstrap. Encapsulado em `createParticipantSession()` para não vazar pra apps.
- **Dois sinais de liveness paralelos** (heartbeat de management + ping/pong do túnel) — duplicação aparente, mas necessária: heartbeat HTTP é independente do estado da conexão WebSocket, então marca offline mesmo se o socket caiu por bug.

### Acoplamentos preservados

- Surface pública de inferência continua HTTP (`/rooms/:code/v1/*` OpenAI-compatible). WebSocket é apenas o canal de controle hub↔participante. Apps usando AI SDK / OpenAI SDK / curl não veem o túnel.
- Contagem de participantes não muda o protocolo client-facing.

---

## 4. Estado atual (referência)

Para contratos concretos:

- [`docs/reference/contracts.md`](../reference/contracts.md) — mensagens do túnel, endpoints, constantes de runtime, fields públicos de participant/connection.
- [`docs/reference/architecture.md`](../reference/architecture.md) — modelo conceitual; seção "Tunnel transport" descreve o estado atual e referencia este ADR para o porquê.
- `packages/core/src/tunnel-protocol.ts` — schemas Zod das mensagens.
- `packages/core/src/participant-session.ts` — runtime canônico (re-exportado pela SDK).
- `packages/core/src/hub.ts` — upgrade WebSocket e despacho.

---

## 5. Origem

Esta ADR formaliza, em 2026-05-20, uma decisão de arquitetura que precede o histórico atual do repo e estava registrada apenas como invariante distribuído (em `AGENTS.md` raiz, `packages/core/AGENTS.md`, `packages/sdk/AGENTS.md`, `docs/reference/architecture.md`). Sem este ADR, novos contribuidores encontravam o "como" do túnel mas não o "porquê" da inversão de sentido.
