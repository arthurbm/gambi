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

As duas APIs respondem CORS para qualquer origem, então um app de navegador em outra origem pode chamá-las.

## API de gerenciamento

A API de gerenciamento é definida como um único contrato, e um hub em execução serve o documento OpenAPI dela:

```bash
curl http://localhost:3000/v1/openapi.json
```

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
    "message": "Room 'ABC123' was not found.",
    "hint": "List the rooms of this hub to see the codes that exist.",
    "details": { "roomCode": "ABC123" }
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

`details` guarda os campos estruturados do erro. `meta.requestId` é o id da requisição no log do hub.

Códigos de erro:

| Código | Status | Significado |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | `404` | o código da sala não existe |
| `PARTICIPANT_NOT_FOUND` | `404` | a sala não tem participante com esse ID |
| `PARTICIPANT_OF_ANOTHER_RUNTIME` | `409` | o participante pertence a outro runtime. `details` traz `roomCode` e `participantId` |
| `INVALID_PASSWORD` | `401` | a sala tem senha e a requisição não trouxe nenhuma, ou trouxe a errada |
| `VERSION_MISMATCH` | `409` | o participante roda outra minor do Gambi que não a do hub; `details` tem `hubVersion` e `participantVersion` |
| `TUNNEL_TOKEN_INVALID` | `401` | o upgrade do túnel chegou sem um bootstrap token válido |
| `NOT_A_HARNESS_PARTICIPANT` | `409` | o participante compartilha um endpoint de modelo, não um harness |
| `PARTICIPANT_UNREACHABLE` | `409` | o túnel do participante não está aberto agora |
| `HARNESS_SESSION_NOT_OPEN` | `409` | a mensagem foi enviada a uma sessão de harness que não está aberta |
| `HARNESS_SESSION_OUTSIDE_WORKSPACE` | `403` | pediram para a sessão de harness rodar fora do workspace do participante |
| `HARNESS_FAILED` | `502` | o harness não respondeu, recusou ou encerrou; `details.reason` diz qual |
| `INVALID_REQUEST` | `400` | a requisição não segue o contrato; `details.issues` lista cada problema com o `path` dele |
| `ROUTE_NOT_FOUND` | `404` | não há rota de gerenciamento para esse método e caminho |
| `INTERNAL_ERROR` | `500` | um bug no hub; procure o `requestId` no log dele |

### GET /v1/health

Verifica se o hub está rodando.

```bash
curl http://localhost:3000/v1/health
```

A resposta é `{ "status": "ok", "timestamp": ... }` dentro do envelope.

### GET /v1/rooms

Lista os resumos das salas.

```bash
curl http://localhost:3000/v1/rooms
```

Os resumos de sala incluem:

- `id`
- `code`: seis caracteres de `0-9A-Z`
- `name`
- `hostId`
- `createdAt`
- `passwordProtected`
- `participantCount`
- `defaults` (quando a sala tem padrões), com o texto das instruções trocado por `hasInstructions`

### POST /v1/rooms

Cria uma sala. Responde `201` com `{ "room", "hostId" }`.

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
- `runtimeId` (ID público do runtime que detém o participante)
- `nickname`
- `model`
- `endpoint` (só participantes de modelo)
- `harness` (só participantes de harness)
- `status`: `offline`, `online` ou `busy`
- `joinedAt`
- `updatedAt`
- `specs`
- `config`
- `capabilities`

`status` vem apenas do túnel do participante:

| Status | Significado |
| --- | --- |
| `offline` | registrado, mas com o túnel fechado; não recebe requisições |
| `online` | túnel aberto e ocioso; o único status que recebe novas requisições de inferência |
| `busy` | atendendo uma requisição |

Um participante que fica `offline` por 60 segundos é removido da sala.

Um participante de harness não tem `endpoint`. O objeto `harness` dele contém `id` (`opencode`, `claude-code`, `codex` ou `fake`) e os campos opcionais `model` e `hosted`.

### PUT /v1/rooms/:code/participants/:id

Cria ou atualiza o registro de um participante. Os runtimes de participante (a CLI, a entrada `gambi-sdk/participant` do SDK) chamam esta rota por você; raramente você a chama à mão.

Quando o registro dá certo, o hub responde `200`. Registrar o mesmo ID de participante atualiza o perfil e mantém o status. Se o participante está `offline`, ele passa a pertencer ao runtime que o registrou. Se o túnel está aberto, o participante só muda de dono quando o novo runtime abre seu túnel. O hub guarda o `endpoint` do participante como metadado e nunca se conecta a ele.

Corpo da requisição:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `runtimeId` | `string` | sim | ID não vazio que o runtime cria uma vez e envia em todo registro, inclusive nas reconexões |
| `nickname` | `string` | sim | nome de exibição mostrado aos operadores |
| `model` | `string` | sim | nome do modelo exposto pelo participante |
| `version` | `string` | sim | versão do Gambi do runtime do participante, como `0.8.0` |
| `endpoint` | `string (URL)` | para participantes de modelo | endpoint do provedor, local ao participante |
| `harness` | `{ id, model?, hosted? }` | para participantes de harness | identidade do harness local e metadados de exibição |
| `password` | `string` | não | senha da sala, obrigatória quando a sala é protegida |
| `specs` | `MachineSpecs` | não | specs opcionais da máquina, veja abaixo |
| `config` | `RuntimeConfig` | não | padrões de runtime do participante, veja abaixo |
| `capabilities` | `ParticipantCapabilities` | não | capacidades de protocolo do participante, veja abaixo |

O hub verifica `version` primeiro: um participante em outra minor (`0.7.x` contra um hub `0.8.x`, por exemplo) é recusado com `409 VERSION_MISMATCH`, cuja mensagem diz a versão que o hub espera. Depois ele verifica a sala e a senha.

Participantes de harness continuam visíveis nas respostas da API de gerenciamento, mas nunca são retornados por `/rooms/:code/v1/models` nem selecionados para inferência por `*`, `any` ou um nome de modelo.

Credenciais do provedor não fazem parte do registro do participante. Um corpo que traz `authHeaders` é recusado com `400 INVALID_REQUEST`. Passe os headers do provedor para o runtime do participante (o `--header` da CLI, ou `authHeaders` em `createParticipantSession()`), para que fiquem na máquina do participante.

Campos de `MachineSpecs` (todos opcionais):

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `cpu` | `string` | descrição da CPU |
| `gpu` | `string` | descrição da GPU |
| `ram` | `number` | RAM do sistema em gigabytes |
| `vram` | `number` | VRAM da GPU em gigabytes |

Campos de `ParticipantCapabilities`. Sem `capabilities`, os dois são `"unknown"`; quando você envia o objeto, informe os dois:

| Campo | Valores | Descrição |
| --- | --- | --- |
| `openResponses` | `"supported" \| "unsupported" \| "unknown"` | se o endpoint do participante fala a OpenAI Responses API |
| `chatCompletions` | `"supported" \| "unsupported" \| "unknown"` | se o endpoint do participante fala OpenAI Chat Completions |

Campos de `RuntimeConfig` (todos opcionais): `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `seed`, `instructions`. Eles funcionam como padrões no nível do participante: vencem os padrões da sala, e os campos da própria requisição vencem os dois. As respostas da API de gerenciamento nunca mostram a string `instructions`, só `hasInstructions`; o hub envia o texto ao provedor quando o padrão se aplica a uma requisição.

```bash
curl -X PUT http://localhost:3000/v1/rooms/ABC123/participants/worker-1 \
  -H "Content-Type: application/json" \
  -d '{
    "runtimeId": "runtime-1",
    "nickname": "worker-1",
    "model": "llama3",
    "version": "0.8.0",
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
      "runtimeId": "runtime-1",
      "nickname": "worker-1",
      "model": "llama3",
      "endpoint": "http://localhost:11434",
      "status": "offline"
    },
    "tunnel": {
      "token": "bootstrap_token",
      "expiresAt": 1763460060000
    }
  },
  "meta": {
    "requestId": "req_789"
  }
}
```

Defina `version` como a versão do seu hub (`gambi --version` na máquina do hub): qualquer outra minor é recusada.

Um participante recém-criado fica `offline` até abrir seu túnel. Se ele nunca abrir o túnel, o hub o remove depois de 60 segundos.

### GET /v1/rooms/:code/participants/:id/tunnel

Abre o túnel do participante usando o bootstrap token retornado pela rota de registro.

```text
GET /v1/rooms/:code/participants/:id/tunnel?token=<token>
```

Esta é uma rota interna para runtimes de participante. Clientes de aplicação devem continuar usando a API HTTP de inferência escopada por sala. Pelo túnel, o hub e o runtime falam o formato de wire da biblioteca Effect RPC, que muda entre minors do Gambi; é por isso que o registro verifica a versão.

Ciclo de vida do token:

- o bootstrap token é de uso único: o hub o consome na primeira requisição, antes do upgrade
- o token expira 60 segundos depois de emitido
- registrar de novo via `PUT /v1/rooms/:code/participants/:id` retorna um token novo

Um token ausente, desconhecido, expirado ou já consumido, um token de outro participante e uma sala desconhecida são todos `401 TUNNEL_TOKEN_INVALID`. Uma requisição com token válido e sem upgrade de WebSocket consome o token e recebe `400 INVALID_REQUEST`.

Se o participante saiu da sala depois do registro, um token ainda válido do runtime removido permite o upgrade para um WebSocket que fecha com `4002`. Quando um novo túnel substitui o anterior, o hub fecha o antigo com `4001`. Antes do primeiro `Welcome`, qualquer um desses códigos faz a entrada falhar com `TunnelOpenFailed`, sem evento `left`. Durante a reconexão, esses códigos encerram o runtime com `left`, mesmo antes de o novo túnel receber `Welcome`.

### DELETE /v1/rooms/:code/participants/:id

Passe na query o `runtimeId` que aparece na listagem de participantes. Com esse valor público, o hub confere se o participante ainda pertence ao mesmo runtime. Se o valor faltar ou estiver vazio, o hub responde `400 INVALID_REQUEST`. Se o dono for outro, responde `409 PARTICIPANT_OF_ANOTHER_RUNTIME` e mantém o participante na sala.

```bash
curl -X DELETE "http://localhost:3000/v1/rooms/ABC123/participants/worker-1?runtimeId=runtime-1"
```

Quando a remoção dá certo, o hub responde `200` com `{ participantId }` dentro do envelope. A sala recebe `participant.removed` com `reason: "left"`. O hub fecha o túnel do dono com o código `4002`. Se o runtime já entrou na sala, ao receber esse código ele emite `left` com `reason: "removed"` e para de tentar reconectar.

### GET /v1/rooms/:code/events

Assina os eventos da sala como Server-Sent Events.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/events
```

Cada evento repete o tipo dele na linha `event:` e traz um objeto JSON em `data:`:

```text
event: participant.online
data: {"type":"participant.online","roomCode":"ABC123","timestamp":1763460000000,"participant":{...},"previousStatus":"offline"}
```

Todo evento tem `type`, `roomCode` e `timestamp` no nível de cima, ao lado dos campos próprios. O primeiro evento de toda conexão é `room.snapshot`. O hub escreve um comentário `: keepalive` a cada 15 segundos enquanto o stream está quieto.

| Evento | Campos |
| --- | --- |
| `room.snapshot` | `room`, `participants` |
| `participant.joined` | `participant` |
| `participant.updated` | `participant` |
| `participant.online` | `participant`, `previousStatus` |
| `participant.busy` | `participant`, `previousStatus` |
| `participant.offline` | `participant`, `previousStatus` |
| `participant.removed` | `participantId`, `reason` (`left` ou `reconnectDeadlinePassed`) |
| `llm.request` | `requestId`, `participantId`, `model`, `protocol`, `modelSelector` |
| `llm.complete` | `requestId`, `participantId`, `model`, `protocol`, `status`, `metrics` |
| `llm.error` | `requestId`, `participantId`, `model`, `protocol`, `stage`, `code`, `error` |

Os eventos não têm ID e não são reenviados. O hub guarda até 256 eventos para um assinante que lê devagar e descarta os mais antigos além disso; reconecte para receber um `room.snapshot` novo. Veja [Observabilidade](/pt-br/reference/observability/) para os campos de `llm.*`.

### Attach de harness

Um cliente de gerenciamento controla um participante de harness com um stream de eventos e três requisições. O cliente chama o hub; o hub nunca se conecta ao participante. Qualquer número de clientes pode fazer attach no mesmo participante.

| Método | Caminho | Corpo | Sucesso |
| --- | --- | --- | --- |
| `GET` | `/v1/rooms/:code/participants/:id/harness/events` | | stream SSE de eventos de attach |
| `PUT` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | `{ "cwd"? }` | `{ "sessionId" }` |
| `POST` | `/v1/rooms/:code/participants/:id/harness/messages` | `{ "sessionId", "message" }` | `202` `{ "sessionId" }` |
| `DELETE` | `/v1/rooms/:code/participants/:id/harness/sessions/:sessionId` | | `{ "sessionId" }` |

- O cliente escolhe o ID da sessão. Abrir uma sessão que já está aberta a deixa como está. `cwd` precisa ser uma pasta dentro do workspace do participante; o padrão é o próprio workspace.
- `message` é um objeto JSON-RPC do ACP v1, passado ao harness como está. O `202` significa que o harness o recebeu; a resposta dele chega pelo stream de eventos.
- Todo cliente conectado lê todos os eventos do participante, inclusive as respostas a outros clientes. Filtre `harness.message` por `sessionId` e associe as respostas às suas requisições pelo `id` do JSON-RPC. Dê a cada cliente o próprio ID de sessão: dois clientes que dividem uma sessão e usam os mesmos IDs de requisição não conseguem distinguir as respostas.
- Estas rotas respondem `NOT_A_HARNESS_PARTICIPANT` para um participante de modelo, e as três requisições respondem `PARTICIPANT_UNREACHABLE` enquanto o túnel do participante está fora do ar.

```bash
curl -N http://localhost:3000/v1/rooms/ABC123/participants/arthur-opencode/harness/events
```

Os eventos de attach usam o mesmo formato SSE dos eventos da sala:

| Evento | Campos | Significado |
| --- | --- | --- |
| `harness.connected` | | o hub está recebendo o harness; primeiro evento quando o participante está conectado, e de novo depois de cada reconexão |
| `harness.disconnected` | `reason`, `message` | o hub não o está recebendo; `reason` é `NoTunnel` quando o participante não tinha túnel no momento do attach |
| `harness.message` | `sessionId`, `message` | uma mensagem ACP v1 do harness |
| `harness.session` | `sessionId`, `status` (`opened`, `closed`, `error`), `message` | uma sessão de harness mudou |
| `harness.artifact` | `sessionId`, `version`, `reason` (`watch`, `final`), `files` | um snapshot do workspace do participante |
| `harness.dropped` | `count` | este cliente leu devagar demais e perdeu `count` eventos aqui |
| `harness.detached` | `reason` (`left`, `reconnectDeadlinePassed`) | o participante saiu da sala; último evento |

Nada é reenviado para um cliente que faz attach depois. Cada artefato é o workspace inteiro, e cada arquivo tem `path`, `encoding` (`utf8` ou `base64`) e `content`. Um workspace maior que 8 MiB não envia artefato.

## API de inferência

A API de inferência é escopada por sala e compatível com OpenAI.

URL base:

```text
http://localhost:3000/rooms/ABC123/v1/
```

O hub lê só `model` (uma string não vazia) e `stream` (um booleano, ou `null` para sem stream) do corpo da requisição. Todo outro campo vai para o provedor do participante como chegou, depois que o hub preenche o que a requisição deixou de fora com a config do participante e os padrões da sala. O hub troca `model` pelo modelo do participante.

### Roteamento de modelo

O campo `model` controla o roteamento:

| Valor | Comportamento |
| --- | --- |
| `*` ou `any` | um participante disponível aleatório |
| `model:<name>` | o primeiro participante disponível cujo modelo é `<name>` |
| qualquer outro valor | o participante disponível com esse ID; senão, o primeiro participante disponível cujo modelo tem esse nome; senão, `participant_busy` ou `participant_offline` quando existe um participante com esse ID, mas ele não está disponível |

Com `model:<name>`, nenhum ID de participante entra em jogo: quando ninguém serve o modelo, a resposta é `model_not_found`. Um valor puro também pode responder `participant_busy` ou `participant_offline`, quando existe um participante com esse ID. Então `"model": "llama3"` se comporta como `model:llama3`, a menos que um participante tenha o ID `llama3`, e um ID de participante não é um alvo exato: quando esse participante está ocupado ou offline, outro que sirva um modelo com o mesmo nome pode receber a requisição.

Um participante só está disponível quando está `online`: o túnel dele está aberto e ele não está atendendo outra requisição. Participantes de harness nunca são escolhidos por `*`, `any` ou um nome de modelo.

### Cancelamento e timeouts

- Fechar a requisição HTTP (abortar o `fetch`, parar o stream) cancela a requisição no provedor do participante, e o participante volta a ficar disponível.
- Se o participante não enviar nada por 5 minutos, antes do primeiro chunk ou entre dois, o hub cancela a requisição e responde `inference_timeout`.
- Se o seu app lê um stream tão devagar que mais de 8 Mi caracteres dele ficam esperando, o hub cancela a requisição e encerra o stream com `consumer_too_slow`.
- Uma resposta que não é stream fica retida no hub até estar completa, até 32 Mi caracteres.

### Erros de inferência

As rotas de inferência não usam o envelope da API de gerenciamento. Os erros usam o formato de erro da OpenAI:

```json
{
  "error": {
    "message": "Participant 'worker-1' is already handling another request.",
    "type": "invalid_request_error",
    "param": null,
    "code": "participant_busy"
  }
}
```

`type` é `invalid_request_error` para um `4xx` e `api_error` para um `5xx`. Diferencie os erros por `code`:

| Status | `code` | Condição |
| --- | --- | --- |
| `400` | `invalid_request` | o corpo não é um objeto JSON, `model` não é uma string não vazia, ou `stream` não é ausente, booleano nem `null` |
| `400` | `inference_not_supported` | o seletor aponta para um participante de harness |
| `400` | `request_not_translatable` | o provedor não tem Responses API e a requisição usa algo que Chat Completions não consegue levar |
| `404` | `room_not_found` | o código da sala não existe |
| `404` | `model_not_found` | nenhum participante disponível corresponde ao seletor |
| `404` | `response_not_found` | o hub não conhece nenhuma Response com esse ID na sala |
| `408` | `consumer_too_slow` | o app leu um stream devagar demais. Só é enviado como o último evento de um stream, cujo status HTTP já foi enviado |
| `409` | `participant_busy` | o seletor aponta para um participante ocupado |
| `501` | `response_not_stored` | a Response foi respondida via Chat Completions e não pode ser lida de volta, apagada nem cancelada |
| `501` | `responses_not_supported` | o provedor não fala nem a Responses API nem Chat Completions |
| `502` | `participant_disconnected` | o túnel do participante caiu antes de a resposta terminar |
| `502` | `provider_unreachable` | o provedor do participante não respondeu |
| `502` | `provider_response_interrupted` | a resposta do provedor quebrou no meio |
| `502` | `provider_response_too_large` | uma resposta que não é stream passou do que o hub retém |
| `503` | `participant_offline` | o seletor aponta para um participante cujo túnel não está aberto |
| `504` | `inference_timeout` | nada chegou do participante por 5 minutos |
| `500` | `internal_error` | um bug no hub |

Um erro que acontece depois que um stream começou chega como o último evento do stream, e nenhum `[DONE]` vem depois dele:

```text
event: error
data: {"type":"error","code":"participant_disconnected","message":"...","param":null,"error":{"message":"...","type":"api_error","param":null,"code":"participant_disconnected"}}
```

Os SDKs da OpenAI o lançam como erro, tanto na Responses API quanto em Chat Completions.

### GET /rooms/:code/v1/models

Lista os participantes de modelo disponíveis na sala, no formato de lista da OpenAI. O `id` de cada entrada é o ID do participante, então você pode passá-lo de volta como `model`. Participantes de harness e participantes offline ficam de fora.

```bash
curl http://localhost:3000/rooms/ABC123/v1/models
```

Cada modelo retornado inclui uma extensão do Gambi em `gambi` com:

- `nickname`
- `model`
- `endpoint`
- `capabilities`
- `status` (`online` ou `busy`)

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

Quando o provedor do participante não tem Responses API, o hub cria a Response via Chat Completions e traduz a resposta.

Endpoints adicionais de ciclo de vida:

- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`

Para uma Response armazenada pelo provedor, essas rotas chegam ao runtime que a criou, mesmo quando ele está ocupado. Enquanto o dono está offline, respondem `participant_offline`. Se outro runtime tomar seu lugar, o hub responde `404 response_not_found`. Para uma Response que o hub traduziu de Chat Completions e ainda mantém no registro, ele responde `501 response_not_stored`, inclusive após a substituição. O hub lembra até 10 000 Responses. Ao atingir o limite, ele descarta a entrada usada há mais tempo para dar lugar à próxima. Quando esquece uma entrada, essas rotas respondem `404 response_not_found`.

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

Para cada campo que uma requisição deixa de fora ou envia como `null`, o hub usa:

1. a config do participante, quando ela define o campo
2. senão, os padrões da sala

Os campos que a requisição define com um valor sempre vencem. Na Responses API, `max_tokens` preenche `max_output_tokens` e `stop` preenche `stop_sequences`. As `instructions` padrão viram uma mensagem `system` no início em Chat Completions (a menos que a requisição já tenha uma) e preenchem `instructions` na Responses API. Configurações sensíveis são ocultadas dos payloads públicos da API de gerenciamento.
