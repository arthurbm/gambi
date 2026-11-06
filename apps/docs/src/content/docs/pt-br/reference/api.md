---
title: Referência da API
description: Referência das APIs HTTP de gerenciamento e de inferência do Gambi.
---

O hub do Gambi expõe dois contratos HTTP:

- API de gerenciamento: rotas nativas do Gambi em `/v1`
- API de inferência: rotas compatíveis com OpenAI, escopadas por sala, em `/rooms/:code/v1/*`

O protocolo padrão do plano de inferência (inference plane) é a OpenAI Responses API. Chat Completions continua disponível para compatibilidade.

## URLs base

Gerenciamento:

```text
http://<hub-host>:<port>/v1/
```

Inferência:

```text
http://<hub-host>:<port>/rooms/<ROOM_CODE>/v1/
```

## Autenticação

O hub não tem autenticação embutida. Rode-o apenas em uma rede confiável, ou atrás do seu próprio proxy e camada de autenticação. A senha da sala protege só o registro de participantes; as rotas de inferência não a verificam.

## API de gerenciamento

### Contrato do envelope

As respostas de sucesso da API de gerenciamento usam:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

Os erros da API de gerenciamento usam:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Room 'ABC123' not found.",
    "hint": "Create the room first or verify the room code."
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

Códigos de erro que o hub retorna:

- `ROOM_NOT_FOUND`
- `PARTICIPANT_NOT_FOUND`
- `INVALID_REQUEST`
- `INVALID_PASSWORD`
- `INTERNAL_ERROR`

O enum de códigos de erro também declara `ENDPOINT_NOT_REACHABLE`, `PARTICIPANT_CONFLICT`, `PARTICIPANT_BUSY`, `PARTICIPANT_TUNNEL_NOT_CONNECTED` e `MODEL_NOT_FOUND`. O hub não os retorna hoje; trate-os como reservados. O SDK usa `PARTICIPANT_TUNNEL_NOT_CONNECTED` como erro do lado do cliente quando você envia algo por um canal de harness fechado.

### GET /v1/health

Verifica se o hub está rodando.

```bash
curl http://localhost:3000/v1/health
```

### GET /v1/rooms

Lista os resumos das salas.

```bash
curl http://localhost:3000/v1/rooms
```

### POST /v1/rooms

Cria uma sala.

```bash
curl -X POST http://localhost:3000/v1/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo",
    "password": "secret",
    "defaults": {
      "temperature": 0.4
    }
  }'
```

### GET /v1/rooms/:code

Busca o resumo de uma sala pelo código.

```bash
curl http://localhost:3000/v1/rooms/ABC123
```

### GET /v1/rooms/:code/participants

Lista os participantes de uma sala.

```bash
curl http://localhost:3000/v1/rooms/ABC123/participants
```

Os resumos de participante incluem:

- `id`
- `nickname`
- `model`
- `endpoint`
- `status`
- `joinedAt`
- `updatedAt`
- `lastSeen`
- `specs`
- `config`
- `capabilities`
- `connection`
- `harness` (só para participantes de harness)

`endpoint` não aparece em um participante de harness. O objeto `harness` dele contém `id` (`opencode`, `claude-code`, `codex`, `pi` ou `fake`) e os campos opcionais `model` e `hosted`.

`connection` tem hoje:

- `kind = "tunnel"`
- `connected`
- `lastTunnelSeenAt`

### PUT /v1/rooms/:code/participants/:id

Cria ou atualiza o registro de um participante.

Esta rota é idempotente e é o caminho canônico de registro. O hub guarda o `endpoint` do participante como metadado e nunca se conecta a ele.

Corpo da requisição:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nickname` | `string` | sim | nome de exibição mostrado aos operadores |
| `model` | `string` | sim | nome do modelo exposto pelo participante |
| `endpoint` | `string (URL)` | para participantes de modelo | endpoint do provedor, local ao participante |
| `harness` | `{ id, model?, hosted? }` | para participantes de harness | identidade do harness local e metadados de exibição |
| `password` | `string` | não | senha da sala, obrigatória quando a sala é protegida |
| `specs` | `MachineSpecs` | não | specs opcionais da máquina, veja abaixo |
| `config` | `RuntimeConfig` | não | padrões de runtime do participante, veja abaixo |
| `capabilities` | `ParticipantCapabilities` | não | capacidades de protocolo do participante, veja abaixo |

Quando `harness` está presente, `endpoint` pode ser omitido e `capabilities` é ignorado. Participantes de harness continuam visíveis nas respostas da API de gerenciamento, mas nunca são retornados por `/rooms/:code/v1/models` nem selecionados para inferência.

Credenciais do provedor não fazem parte do registro do participante. Não envie `authHeaders` para esta rota; passe-os para `createParticipantSession()` ou para o runtime da CLI, para que fiquem locais ao participante.

Campos de `MachineSpecs` (todos opcionais):

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `cpu` | `string` | descrição da CPU |
| `gpu` | `string` | descrição da GPU |
| `ram` | `number` | RAM do sistema em gigabytes |
| `vram` | `number` | VRAM da GPU em gigabytes |

Campos de `ParticipantCapabilities` (cada um tem `"unknown"` como padrão):

| Campo | Valores | Descrição |
| --- | --- | --- |
| `openResponses` | `"supported" \| "unsupported" \| "unknown"` | se o endpoint do participante fala a OpenAI Responses API |
| `chatCompletions` | `"supported" \| "unsupported" \| "unknown"` | se o endpoint do participante fala OpenAI Chat Completions |

Campos de `RuntimeConfig` (todos opcionais): `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`, `instructions`. Eles funcionam como padrões no nível do participante e são mesclados abaixo dos padrões da sala e acima dos overrides da requisição. A string `instructions` é privada ao runtime do participante. As respostas da API de gerenciamento mostram apenas `hasInstructions`.

```bash
curl -X PUT http://localhost:3000/v1/rooms/ABC123/participants/worker-1 \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "worker-1",
    "model": "llama3",
    "endpoint": "http://localhost:11434",
    "capabilities": {
      "openResponses": "supported",
      "chatCompletions": "supported"
    }
  }'
```

Exemplo de resposta:

```json
{
  "data": {
    "participant": {
      "id": "worker-1",
      "nickname": "worker-1",
      "model": "llama3",
      "endpoint": "http://localhost:11434",
      "status": "offline",
      "connection": {
        "kind": "tunnel",
        "connected": false,
        "lastTunnelSeenAt": null
      }
    },
    "roomId": "room_123",
    "tunnel": {
      "url": "ws://localhost:3000/v1/rooms/ABC123/participants/worker-1/tunnel",
      "token": "bootstrap_token"
    }
  },
  "meta": {
    "requestId": "req_789"
  }
}
```

Comportamento:

- `201` quando o participante é criado
- `200` quando o participante já existe e é atualizado ou fica inalterado

Runtimes de participante, como a CLI ou o `createParticipantSession()` do SDK, usam o bootstrap `tunnel` retornado para abrir o túnel.

### GET /v1/rooms/:code/participants/:id/tunnel

Abre o túnel do participante usando o bootstrap token retornado pela rota de registro.

```text
GET /v1/rooms/:code/participants/:id/tunnel?token=<token>
```

Esta é uma rota operacional interna para runtimes de participante. Clientes de aplicação devem continuar usando a API HTTP de inferência escopada por sala.

Ciclo de vida do token:

- o bootstrap token é de uso único: um upgrade bem-sucedido o consome
- o token expira 60 segundos depois de emitido
- registrar de novo via `PUT /v1/rooms/:code/participants/:id` retorna um token novo

Respostas de erro:

| Status | Código | Condição |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | o parâmetro de query `token` está ausente |
| `401` | `INVALID_REQUEST` | o token é desconhecido, expirou ou está vinculado a outro participante |
| `404` | `ROOM_NOT_FOUND` | o código da sala não existe |
| `404` | `PARTICIPANT_NOT_FOUND` | o participante não está registrado na sala |

### GET /v1/rooms/:code/participants/:id/harness

Conecta um cliente de gerenciamento a um participante de harness registrado, por meio de um upgrade para WebSocket. O cliente inicia essa conexão; o hub nunca se conecta ao participante.

Os clientes enviam frames `tunnel.harness.message` e `tunnel.harness.control`. Eles recebem frames `tunnel.harness.message`, `tunnel.harness.artifact` e `tunnel.harness.status`. Todo frame inclui `sessionId`; o JSON-RPC do ACP vai no campo opaco `message`. Vários clientes podem se conectar. Os sockets deles continuam abertos se o túnel do participante fechar e o participante depois abrir um novo; frames que um cliente envia enquanto nenhum túnel está aberto são descartados. O hub fecha os sockets conectados quando o participante sai da sala.

A rota retorna `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` ou `INVALID_REQUEST` quando o alvo não é um participante de harness.

### DELETE /v1/rooms/:code/participants/:id

Remove um participante de uma sala.

```bash
curl -X DELETE http://localhost:3000/v1/rooms/ABC123/participants/worker-1
```

### POST /v1/rooms/:code/participants/:id/heartbeat

Envia um heartbeat de um participante.

```bash
curl -X POST http://localhost:3000/v1/rooms/ABC123/participants/worker-1/heartbeat
```

Um participante registrado, mas com o túnel desconectado, continua na sala e não recebe roteamento. Veja [Intervalos de verificação de saúde](#intervalos-de-verificação-de-saúde).

### Intervalos de verificação de saúde

Duas constantes em `packages/core/src/types.ts` controlam a detecção de atividade:

- `HEALTH_CHECK_INTERVAL = 10_000` ms: a frequência com que os runtimes de participante enviam um heartbeat e um ping pelo túnel.
- `PARTICIPANT_TIMEOUT = 30_000` ms: depois desse tempo sem heartbeat, o hub marca o participante como offline. O hub também fecha um túnel que ficou em silêncio por esse tempo.

Um runtime de participante customizado precisa respeitar essas janelas. O `createParticipantSession()` faz isso por você.

### GET /v1/rooms/:code/events

Assina os eventos da sala via SSE.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/events
```

`GET /rooms/:code/events` serve o mesmo stream. Prefira o caminho `/v1`.

Cada bloco `data:` do SSE contém um evento JSON com:

- `type`
- `timestamp`
- `roomCode`
- `data`

Tipos de evento atuais:

- `connected`
- `room.created`
- `participant.joined`
- `participant.updated`
- `participant.left`
- `participant.offline`
- `llm.request`
- `llm.complete`
- `llm.error`
- `harness.session.opened`
- `harness.session.closed`
- `harness.artifact`

Eventos de observabilidade:

- `llm.request` inclui `requestId`, `participantId`, `model` e `protocol`
- `llm.complete` inclui os mesmos campos mais `metrics`
- `llm.error` inclui a identidade da requisição, informações do participante, protocolo, etapa e texto do erro
- eventos de sessão de harness incluem `participantId` e `sessionId`; `harness.artifact` adiciona `version` e omite o conteúdo dos arquivos

`metrics` pode incluir:

- `ttftMs`
- `durationMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `tokensPerSecond`

## API de inferência

A API de inferência é escopada por sala e compatível com OpenAI.

URL base:

```text
http://localhost:3000/rooms/ABC123/v1/
```

### Roteamento de modelo

O campo `model` controla o roteamento:

| Valor | Comportamento |
| --- | --- |
| `*` ou `any` | um participante disponível aleatório |
| `model:<name>` | o primeiro participante disponível cujo modelo é `<name>` |
| `<participant-id>` | esse participante, se estiver disponível |

Se o valor não for um seletor `*`, `any` ou `model:` e nenhum participante disponível tiver esse ID, o hub trata o valor como nome de modelo e escolhe o primeiro participante disponível que o sirva. Então `"model": "llama3"` se comporta como `model:llama3`, a menos que haja um participante registrado com o ID `llama3`.

Um participante só está disponível quando:

- o túnel dele está conectado
- ele não está offline
- ele não está atendendo outra requisição
- ele é um participante de modelo (participantes de harness nunca recebem requisições de inferência)

### Erros de inferência

As rotas de inferência não usam o envelope da API de gerenciamento. Os erros são um objeto JSON com uma string `error` e sem código:

```json
{ "error": "Participant tunnel is not connected." }
```

| Status | `error` | Condição |
| --- | --- | --- |
| `400` | `Harness participants do not serve inference requests; attach through the management harness channel instead.` | o seletor aponta para um participante de harness |
| `404` | `Room not found` | o código da sala não existe |
| `404` | `No available participant for the requested model` | nenhum participante disponível corresponde ao seletor |
| `409` | `Participant is already handling another request.` | o seletor aponta para um participante ocupado |
| `503` | `Participant tunnel is not connected.` | o seletor aponta para um participante com o túnel fechado |
| `502` | `Failed to proxy request: …` | a requisição pelo túnel falhou depois que um participante foi selecionado |

### GET /rooms/:code/v1/models

Lista os participantes de modelo disponíveis na sala, no formato de lista da OpenAI. O `id` de cada entrada é o ID do participante, então você pode passá-lo de volta como `model`. Participantes de harness, participantes offline e participantes sem túnel conectado ficam de fora.

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

Cada modelo retornado inclui uma extensão do Gambi em `gambi` com:

- `nickname`
- `model`
- `endpoint`
- `capabilities`
- `connection`

### POST /rooms/:code/v1/responses

Faz proxy da OpenAI Responses API.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "input": "Hello!",
    "stream": false
  }'
```

Endpoints adicionais de ciclo de vida:

- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`

### POST /rooms/:code/v1/chat/completions

Faz proxy de Chat Completions compatível com OpenAI.

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

Use esta rota quando uma ferramenta exigir Chat Completions. Em integrações novas, prefira `/responses`.

## Padrões de runtime

O hub mescla os padrões de runtime nesta ordem:

1. padrões da sala
2. padrões do participante
3. overrides da requisição

Configurações sensíveis são ocultadas dos payloads públicos da API de gerenciamento.
