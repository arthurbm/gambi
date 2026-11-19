---
title: Observabilidade
description: Eventos SSE, métricas e status dos participantes emitidos pelo hub do Gambi.
---

O hub informa a atividade de inferência e o estado dos participantes como eventos da sala. Esta página documenta esse contrato público.

Leia os eventos pelo stream SSE de gerenciamento:

```text
GET /v1/rooms/:code/events
```

Ou pelo SDK:

```ts
for await (const event of client.events.watch(roomCode)) {
  // ...
}
```

Ou pela CLI, com uma linha JSON por evento:

```bash
gambi events watch --room ABC123 --format ndjson
```

Todo evento traz `type`, `roomCode` e `timestamp` (milissegundos desde a epoch, pelo relógio do hub) no nível de cima, ao lado dos próprios campos.

## Tipos de evento

O primeiro evento de toda conexão é um snapshot da sala. Depois dele, o stream traz cada mudança de um participante e cada requisição de inferência.

| Evento | Quando é disparado |
| --- | --- |
| `room.snapshot` | primeiro evento de toda conexão: `room` e os `participants` dela naquele momento |
| `participant.joined` | um participante se registrou; ele começa `offline` |
| `participant.updated` | um participante que já estava na sala se registrou de novo; o status dele não mudou |
| `participant.online` | o túnel dele abriu, ou a requisição que ele atendia terminou |
| `participant.busy` | o hub despachou uma requisição para ele |
| `participant.offline` | o túnel dele caiu |
| `participant.removed` | ele saiu da sala, ou ficou offline por 60 segundos |
| `llm.request` | o roteamento escolheu um participante e o hub despachou a requisição pelo túnel dele |
| `llm.complete` | a resposta do provedor terminou |
| `llm.error` | a requisição terminou sem a resposta inteira do provedor |

Uma requisição que falha no roteamento (nenhum participante disponível, participante ocupado ou offline, participante de harness) recebe um erro HTTP e não emite evento. Veja [Erros de inferência](/pt-br/reference/api/#erros-de-inferência).

Sessões e artefatos de harness não são eventos da sala. Para acompanhar um participante de harness, faça attach nele com `client.harness.attach()` ou `GET /v1/rooms/:code/participants/:id/harness/events`; veja [Attach de harness](/pt-br/reference/api/#attach-de-harness).

Os eventos não têm ID e o hub não guarda histórico. Um assinante que fica mais de 256 eventos para trás perde os mais antigos; ao reconectar, ele recomeça de um `room.snapshot` novo. Uma aplicação que precisa de histórico guarda o próprio, por exemplo gravando os eventos num banco de dados. Isso não acrescenta armazenamento nem replay a `/v1/rooms/:code/events`.

### Eventos de participante

`participant.joined` e `participant.updated` trazem o resumo `participant`. Os três eventos de status trazem o `participant` depois da mudança e o `previousStatus` dele:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `participant` | `ParticipantSummary` | o participante depois da mudança |
| `previousStatus` | `"offline" \| "online" \| "busy"` | o status dele antes da mudança |

`participant.removed` traz `participantId` e `reason`: `left` quando ele saiu da sala, `reconnectDeadlinePassed` quando ficou offline por 60 segundos.

### `llm.request`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | ID da requisição HTTP no hub, compartilhado por `llm.request`, `llm.complete` e `llm.error`, e presente no log do hub |
| `participantId` | `string` | participante escolhido pelo roteamento |
| `model` | `string` | o modelo do participante, que é o que foi pedido ao provedor dele |
| `modelSelector` | `string` | o valor de `model` do corpo da requisição (`*`, `model:llama3`, um ID de participante, ...) |
| `protocol` | `"openResponses" \| "chatCompletions"` | API que a requisição usou no hub |

### `llm.complete`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | o mesmo de `llm.request` |
| `participantId` | `string` | participante que produziu a resposta |
| `model` | `string` | o modelo do participante |
| `protocol` | `"openResponses" \| "chatCompletions"` | API da requisição |
| `status` | `number` | status HTTP com que o provedor respondeu; uma resposta de erro do provedor também completa |
| `metrics` | `Metrics` | veja abaixo |

### `llm.error`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | identificador de correlação |
| `participantId` | `string` | participante escolhido pelo roteamento |
| `model` | `string` | o modelo do participante |
| `protocol` | `"openResponses" \| "chatCompletions"` | API da requisição |
| `stage` | `"dispatch" \| "stream"` | `dispatch`: o app ainda não tinha recebido nada. `stream`: uma resposta em streaming quebrou depois de começar |
| `code` | `string` | o `code` do erro de inferência que o app recebeu (como `participant_disconnected` ou `inference_timeout`), ou `request_cancelled` quando o próprio app desistiu da requisição |
| `error` | `string` | mensagem de falha legível por pessoas |

## Métricas

`llm.complete.metrics` traz até seis campos:

| Campo | Unidade | Origem | Observações |
| --- | --- | --- | --- |
| `ttftMs` | milissegundos | medido pelo hub | tempo do despacho até o primeiro pedaço do corpo da resposta |
| `durationMs` | milissegundos | medido pelo hub | tempo do despacho até o fim da resposta |
| `inputTokens` | tokens | `usage` do provedor | só em respostas que não são stream |
| `outputTokens` | tokens | `usage` do provedor | só em respostas que não são stream |
| `totalTokens` | tokens | `usage` do provedor ou derivado | o total do provedor, ou `inputTokens + outputTokens` quando ele não informa nenhum |
| `tokensPerSecond` | tokens/segundo | derivado | `outputTokens / durationMs * 1000`; só aparece quando `outputTokens` é conhecido e `durationMs` é maior que zero |

### Com o que você pode contar

- `ttftMs` e `durationMs` sempre aparecem, porque o hub mede esses valores.
- A contagem de tokens vem só do `usage` de uma resposta que não é stream. Uma resposta em streaming não tem contagem de tokens.
- O hub mede essas métricas do lado dele. Elas não incluem a latência sentida do lado do cliente da requisição HTTP e não substituem tracing distribuído de ponta a ponta.

## Status do participante

Todo participante tem um `status`, derivado do túnel dele:

| Status | Significado |
| --- | --- |
| `offline` | registrado, mas com o túnel fechado; não recebe requisições |
| `online` | túnel aberto e ocioso; o único status que recebe novas requisições de inferência |
| `busy` | atendendo uma requisição |

Cada mudança emite um evento `participant.online`, `participant.busy` ou `participant.offline`, então um monitor consegue acompanhar a sala só pelo stream de eventos.

## Logs estruturados

O hub também escreve linhas de log estruturadas para quem o opera, como `tunnel opened`, `tunnel dropped`, `participant status changed` e `inference request failed`, com a sala, o participante e o ID da requisição anexados. O `gambi hub serve` escreve essas linhas no stderr, em JSON quando a saída dele não é um terminal; `--log-level` filtra as linhas. Um hub iniciado com `createHub()` entrega as linhas ao callback `onLog` dele.

Programas devem ler o stream SSE, não os logs.

## O que fica fora do escopo

O hub não oferece:

- armazenamento persistente ou replay de eventos passados
- dashboards agregados (latência p50/p95, taxa de erro ao longo do tempo)
- pipelines de amostragem ou exportação (OpenTelemetry, Prometheus)
- tracing de ponta a ponta entre cliente, hub e participante

Você pode construir qualquer um deles em cima do stream SSE.
