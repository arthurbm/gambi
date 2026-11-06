---
title: Visão geral da arquitetura
description: Como o Gambi funciona por dentro e por que o sistema se divide em superfícies HTTP públicas e túneis de participantes.
---

O Gambi expõe um plano de gerenciamento (management plane) em HTTP, um plano de inferência (inference plane) em HTTP compatível com OpenAI e um túnel de participante entre o hub e cada participante registrado.

## Diagrama do sistema

```mermaid title="Os clientes chamam o hub por HTTP. Os participantes abrem o túnel; o hub nunca inicia conexões."
flowchart LR
  ops["SDK e CLI"]
  apps["Apps e ferramentas de IA"]
  subgraph hub["Hub"]
    mgmt["API de gerenciamento<br/>/v1/* e eventos SSE"]
    inf["API de inferência<br/>/rooms/:code/v1/*"]
    reg["Registro de túneis<br/>e roteamento"]
  end
  subgraph machine["Máquina do participante"]
    rt["Runtime do participante"]
    prov[("Endpoint do modelo")]:::model
    har["Harness, ACP v1"]:::harness
  end
  ops -->|HTTP| mgmt
  apps -->|HTTP| inf
  rt ==>|abre WebSocket| reg
  rt --> prov
  rt --> har
  classDef model stroke-width:1.5px
  classDef harness stroke-width:1.5px
```

## Ideia central

Os apps falam com o Gambi por HTTP padrão, então ferramentas e SDKs no estilo OpenAI funcionam sem mudanças.

Os participantes não publicam um endpoint de provedor acessível pela rede. O runtime do participante abre um túnel até o hub e encaminha as requisições de inferência para o seu provedor local ou remoto. Um participante de harness usa o mesmo túnel para repassar mensagens ACP v1 de um processo de harness na sua máquina.

## Fluxo de registro

1. O runtime do participante testa localmente o endpoint do provedor. Um participante de harness, em vez disso, verifica se o harness está instalado e com login feito.
2. Ele se registra com `PUT /v1/rooms/:code/participants/:id`.
3. O hub retorna `{ participant, roomId, tunnel }`.
4. O runtime abre `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
5. O hub faz o upgrade da conexão e começa a encaminhar as requisições pelo túnel.
6. O runtime continua enviando heartbeats de gerenciamento.

## Fluxo de requisição

1. Um app envia `POST /rooms/:code/v1/responses` ou `POST /rooms/:code/v1/chat/completions`.
2. O hub escolhe um participante por ID de participante, `model:<name>` ou `*`. Veja [Roteamento de modelo](/pt-br/reference/api/#roteamento-de-modelo).
3. O hub encaminha a requisição pelo túnel do participante.
4. O runtime do participante a encaminha para o endpoint real do provedor.
5. O runtime faz o streaming da resposta do provedor de volta pelo túnel.
6. O hub devolve a resposta ao cliente do app.

```mermaid title="Uma requisição de inferência. As credenciais do provedor são aplicadas na máquina do participante."
sequenceDiagram
  participant App as Seu app
  participant Hub
  participant RT as Runtime do participante
  participant P as Provedor
  App->>Hub: POST /rooms/:code/v1/responses
  Note over Hub: roteia por id do participante, model:<name> ou *
  Hub->>RT: tunnel.request
  RT->>P: requisição HTTP com os próprios headers de auth
  P-->>RT: stream da resposta
  RT-->>Hub: tunnel.response.start / chunk / end
  Hub-->>App: stream da resposta
```

## Por que a divisão

### HTTP para apps

- interface padrão compatível com OpenAI
- funciona com SDKs e ferramentas existentes
- dá para depurar com ferramentas HTTP comuns

### WebSocket para o transporte dos participantes

- deixa os provedores ficarem em `localhost`
- mantém as credenciais do provedor no runtime do participante
- evita pedir que os participantes publiquem endpoints na rede só para entrar em uma room
- carrega mensagens ACP v1 opacas e artefatos para participantes de harness
- permite que clientes de gerenciamento se conectem pelo hub sem que o hub inicie nenhuma conexão com o participante

### SSE para observabilidade

- um stream de eventos da room em mão única basta para monitoramento
- alimenta a TUI e os clientes operacionais
- mantém a visibilidade operacional separada do transporte de inferência

Apps opcionais podem construir coordenação acima desses contratos com o
`gambi-sdk`: conectar-se a participantes de harness, hospedar os próprios e manter
o próprio estado. Os streams deles não são o stream da room do hub e não mudam a
API pública do hub.

## Regras de roteamento

O campo `model` de uma requisição de inferência seleciona o participante: um ID de participante, `model:<name>` ou `*`. Um participante só está disponível quando o túnel dele está conectado, ele não está offline e não está atendendo outra requisição. Participantes de harness nunca são selecionados. A [referência da API](/pt-br/reference/api/#roteamento-de-modelo) traz as regras completas, incluindo o fallback para um ID de participante desconhecido.

## Protocolo do túnel

O túnel é um WebSocket entre o hub e o runtime do participante. As mensagens são objetos JSON com um campo `type`.

Do hub para o participante:

- `tunnel.request`: uma requisição de inferência encaminhada. Inclui `requestId`, `operation`, o `method` HTTP, `path`, `headers`, `body`, uma flag `stream` e um `metadata` opcional.
- `tunnel.pong`: resposta a um ping do participante.
- `tunnel.harness.message`: JSON-RPC ACP opaco para um `sessionId`.
- `tunnel.harness.control`: abre ou fecha uma sessão de harness.

Do participante para o hub:

- `tunnel.response.start`: headers da resposta e status HTTP para o `requestId`.
- `tunnel.response.chunk`: um chunk do corpo em streaming para o `requestId`.
- `tunnel.response.end`: o corpo da resposta está completo.
- `tunnel.response.error`: o runtime do participante não conseguiu produzir uma resposta. Inclui um rótulo `stage` e uma `message` legível.
- `tunnel.ping`: keepalive do participante.
- `tunnel.harness.message`: resposta ou atualização JSON-RPC ACP opaca.
- `tunnel.harness.artifact`: arquivos versionados do workspace.
- `tunnel.harness.status`: estado de aberto, fechado ou erro.

A rota de attach de gerenciamento envia a saída do harness para todo cliente conectado. O socket de um cliente conectado é independente do túnel do participante. Se o túnel fecha e o participante abre um novo, os clientes conectados mantêm seus sockets e não precisam se conectar de novo.

Veja `packages/core/src/tunnel-protocol.ts` para os schemas oficiais.

## Adaptação de protocolo entre Responses e Chat Completions

O protocolo padrão é o Responses. O Chat Completions continua disponível por compatibilidade.

Quando o cliente e o participante não falam o mesmo protocolo, o hub faz a adaptação entre eles. Duas consequências:

- um cliente usando Responses consegue alcançar um participante que só expõe Chat Completions, e vice-versa
- o adaptador foca no contrato no nível das mensagens; recursos com estado do Responses, como `previous_response_id`, `store` e `background`, podem ser limitados ou não suportados quando o participante por trás é um endpoint Chat Completions

Integrações novas devem preferir o Responses. Recorra ao Chat Completions só quando precisar de compatibilidade explícita com uma ferramenta existente.

## Intervalos de verificação de saúde

Os runtimes de participante enviam um heartbeat de gerenciamento e um ping no túnel a cada 10 segundos. Depois de 30 segundos sem heartbeat, o hub marca o participante como offline, e depois de 30 segundos sem nenhum frame no túnel, ele fecha o túnel. A [referência da API](/pt-br/reference/api/#intervalos-de-verificação-de-saúde) lista as constantes.

## Observabilidade

O hub emite `llm.request`, `llm.complete` e `llm.error` para inferência, e `harness.session.opened`, `harness.session.closed` e `harness.artifact` para participantes de harness. O `llm.complete` traz métricas de tempo e de tokens. Veja [Observabilidade](/pt-br/reference/observability/) para os campos.

## O que o Gambi não faz

- Ele não hospeda modelos.
- O hub não tem autenticação embutida. Rode-o em uma rede confiável, ou atrás do seu próprio proxy e camada de autenticação.
- O hub não orquestra modelos nem harnesses. Os apps podem coordenar o trabalho pelo SDK sem levar essa política para dentro do hub.

Para saber onde a coordenação acima do hub está sendo explorada, veja [O que vem por aí](/pt-br/concepts/whats-next/).
