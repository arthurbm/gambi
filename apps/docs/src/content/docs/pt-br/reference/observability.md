---
title: Observabilidade
description: Eventos SSE, métricas e estado de conexão dos participantes emitidos pelo hub do Gambi.
---

O hub informa a atividade de inferência e o estado dos participantes como eventos da sala. Esta página documenta esse contrato público.

Leia os eventos pelo stream SSE de gerenciamento:

```text
GET /v1/rooms/:code/events
```

Ou pelo SDK:

```ts
for await (const event of client.events.watchRoom({ roomCode })) {
  // ...
}
```

## Tipos de evento

O hub emite três eventos de inferência depois que o roteamento escolhe um participante.

| Evento | Quando é disparado |
| --- | --- |
| `llm.request` | o roteamento escolheu um participante e o hub está prestes a enviar a requisição pelo túnel |
| `llm.complete` | o participante devolveu uma resposta final ou o stream terminou sem erro |
| `llm.error` | o envio para o participante escolhido falhou, ou o stream de resposta dele quebrou |

Uma requisição que falha no roteamento (nenhum participante disponível, participante ocupado, túnel fechado, participante harness) recebe um erro HTTP e não emite evento. Veja [Erros de inferência](/pt-br/reference/api/#erros-de-inferência).

Os eventos de gerenciamento (`participant.joined`, `participant.updated`, `participant.left`, `participant.offline`, `room.created`) estão documentados na [referência da API](/pt-br/reference/api/) e na [referência do SDK](/pt-br/reference/sdk/#clienteventswatchroom-roomcode-signal-).

Participantes harness acrescentam três sinais de ciclo de vida:

| Evento | Dados |
| --- | --- |
| `harness.session.opened` | `participantId`, `sessionId` |
| `harness.session.closed` | `participantId`, `sessionId` |
| `harness.artifact` | `participantId`, `sessionId`, `version` incremental |

O conteúdo dos arquivos do artefato não vai pelo SSE. Consuma o canal de attach quando precisar do artefato em si.

Os eventos de sessão confirmam que a sessão ACP local abriu ou fechou. Eles não incluem prompts ACP, respostas, autenticação local nem arquivos do workspace. `harness.artifact` só informa que uma nova versão do artefato está disponível. Use `client.harness.attach()` para receber os arquivos.

Streams de eventos locais de uma aplicação ficam fora deste contrato público do hub. Por
exemplo, uma aplicação pode gravar a própria sequência de auditoria num banco de dados.
Isso não acrescenta armazenamento nem replay a `/v1/rooms/:code/events`.

### `llm.request`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | identificador de correlação compartilhado entre `llm.request`, `llm.complete` e `llm.error` |
| `participantId` | `string` | participante escolhido pelo roteamento |
| `model` | `string` | o valor de `model` do corpo da requisição, ou seja, o seletor (`*`, `model:llama3`, um ID de participante) |
| `protocol` | `"openResponses" \| "chatCompletions"` | API que a requisição usou no hub |

### `llm.complete`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | o mesmo de `llm.request` |
| `participantId` | `string` | participante que produziu a resposta |
| `model` | `string` | nome do modelo que o participante serve |
| `protocol` | `"openResponses" \| "chatCompletions"` | API da requisição |
| `metrics` | `Metrics` | veja abaixo |

### `llm.error`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `requestId` | `string` | identificador de correlação |
| `participantId` | `string` | participante escolhido pelo roteamento |
| `nickname` | `string` | apelido do participante |
| `endpoint` | `string` | endpoint do provedor, local ao participante |
| `model` | `string` | o valor de `model` da requisição em erros de `dispatch`; o nome do modelo do participante em erros de `stream` |
| `protocol` | `"openResponses" \| "chatCompletions"` | API da requisição |
| `stage` | `"dispatch" \| "stream"` | `dispatch`: falhou o envio da requisição pelo túnel ou a leitura da resposta. `stream`: uma resposta em streaming quebrou depois de começar. |
| `error` | `string` | mensagem de falha legível por pessoas |

## Métricas

`llm.complete.metrics` traz seis campos:

| Campo | Unidade | Origem | Observações |
| --- | --- | --- | --- |
| `ttftMs` | milissegundos | medido pelo hub | tempo até o primeiro token (streaming) ou até o primeiro byte (sem streaming) |
| `durationMs` | milissegundos | medido pelo hub | tempo total da requisição |
| `inputTokens` | tokens | `usage` do provedor | pode faltar quando o provedor upstream não expõe a contagem de tokens |
| `outputTokens` | tokens | `usage` do provedor | pode faltar em streaming sem relatório de uso |
| `totalTokens` | tokens | `usage` do provedor ou derivado | cai para `inputTokens + outputTokens` quando um dos dois é conhecido |
| `tokensPerSecond` | tokens/segundo | derivado | `outputTokens / durationMs * 1000`; só aparece quando `outputTokens` é conhecido e `durationMs` é maior que zero |

### Com o que você pode contar

- `ttftMs` e `durationMs` sempre aparecem em requisições bem-sucedidas, porque o hub mede esses valores.
- A contagem de tokens depende do provedor upstream. Endpoints de streaming que não incluem um objeto `usage` deixam esses campos vazios.
- O hub mede essas métricas do lado dele. Elas não incluem a latência sentida do lado do cliente da requisição HTTP e não substituem tracing distribuído de ponta a ponta.

## Estado de conexão do participante

Todo payload de gerenciamento que inclui um participante expõe um bloco `connection`:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `kind` | `"tunnel"` | transporte em uso |
| `connected` | `boolean` | se o túnel está aberto agora |
| `lastTunnelSeenAt` | `number \| null` | epoch Unix em milissegundos do frame de túnel mais recente, ou `null` quando não há túnel aberto |

Ele aparece em:

- respostas de `PUT /v1/rooms/:code/participants/:id`
- itens da lista de `GET /v1/rooms/:code/participants`
- payloads SSE de `participant.joined` / `participant.updated`
- `ParticipantSummary` retornado pelo SDK

Combine `connection.connected` com o campo `status` do participante para distinguir "registrado, mas offline" de "ativo e pronto para atender uma requisição".

## Logs estruturados

O hub também emite logs estruturados no console, em paralelo aos eventos SSE:

- `[gambi] llm.request`
- `[gambi] llm.complete`
- `[gambi] llm.error`

Eles servem para quem opera o hub. Programas devem ler o stream SSE.

## O que fica fora do escopo

O hub não oferece:

- armazenamento persistente ou replay de eventos passados
- dashboards agregados (latência p50/p95, taxa de erro ao longo do tempo)
- pipelines de amostragem ou exportação (OpenTelemetry, Prometheus)
- tracing de ponta a ponta entre cliente, hub e participante

Você pode construir qualquer um deles em cima do stream SSE.
