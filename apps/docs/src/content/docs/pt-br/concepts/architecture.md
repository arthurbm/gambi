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

O hub e os participantes dele precisam rodar a mesma minor do Gambi. Um hub recusa no registro um participante de outra minor, com uma mensagem que informa a versão esperada.

## Fluxo de registro

1. O runtime do participante testa localmente o endpoint do provedor. Um participante de harness, em vez disso, verifica se o harness está instalado e com login feito.
2. Ele cria um `runtimeId` público e o envia em todo registro (`PUT /v1/rooms/:code/participants/:id`), inclusive ao reconectar.
3. O hub confere a versão do participante e a senha da sala, e retorna `{ participant, tunnel }` com um token de uso único.
4. O runtime abre `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
5. O hub aceita o túnel, marca o participante como `online` e envia a ele uma chamada de boas-vindas. A partir daí, o hub chama o participante pelo túnel.
6. Quando o túnel cai, o runtime se registra de novo e abre um novo túnel com o mesmo ID de participante. Quando alguém remove o participante, o hub fecha o túnel com `4002` e o runtime termina.

## Fluxo de requisição

1. Um app envia `POST /rooms/:code/v1/responses` ou `POST /rooms/:code/v1/chat/completions`.
2. O hub escolhe um participante `online` por ID de participante, nome de modelo, `model:<name>` ou `*`. Veja [Roteamento de modelo](/pt-br/reference/api/#roteamento-de-modelo).
3. O hub encaminha a requisição pelo túnel do participante.
4. O runtime do participante a encaminha para o endpoint real do provedor.
5. O runtime faz o streaming da resposta do provedor de volta pelo túnel.
6. O hub devolve a resposta ao cliente do app.

Se o app encerrar a requisição, ou se o participante não enviar nada por 5 minutos, o hub cancela a chamada no túnel e o runtime aborta a requisição ao provedor.

```mermaid title="Uma requisição de inferência. As credenciais do provedor são aplicadas na máquina do participante."
sequenceDiagram
  participant App as Seu app
  participant Hub
  participant RT as Runtime do participante
  participant P as Provedor
  App->>Hub: POST /rooms/:code/v1/responses
  Note over Hub: roteia por id do participante, nome do modelo ou *
  Hub->>RT: chamada Infer
  RT->>P: requisição HTTP com os próprios headers de auth
  P-->>RT: stream da resposta
  RT-->>Hub: status, depois chunks do corpo
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
- evita pedir que os participantes publiquem endpoints na rede só para entrar em uma sala
- carrega mensagens ACP v1 opacas e artefatos para participantes de harness
- permite que clientes de gerenciamento se conectem pelo hub sem que o hub inicie nenhuma conexão com o participante
- cancela uma requisição e aplica timeout a ela de ponta a ponta

### SSE para observabilidade

- um stream de eventos da sala em mão única basta para monitoramento
- alimenta a TUI e os clientes operacionais
- mantém a visibilidade operacional separada do transporte de inferência

Apps opcionais podem construir coordenação acima desses contratos com o
`gambi-sdk`: conectar-se a participantes de harness, hospedar os próprios e manter
o próprio estado. Os streams deles não são o stream da sala do hub e não mudam a
API pública do hub.

## Regras de roteamento

O campo `model` de uma requisição de inferência seleciona o participante: um ID de participante, um nome de modelo, `model:<name>` ou `*`. Um participante só está disponível quando está `online`: o túnel dele está aberto e ele não está atendendo outra requisição. Participantes de harness nunca são selecionados por `*` nem por um nome de modelo. A [referência da API](/pt-br/reference/api/#roteamento-de-modelo) traz as regras completas, incluindo o fallback para um ID de participante desconhecido.

## Protocolo do túnel

O túnel é um WebSocket que o runtime do participante abre até o hub. Por ele, os papéis se invertem: o participante atende chamadas tipadas e o hub as faz, usando a biblioteca de RPC do [Effect](https://effect.website). Toda chamada vai do hub para o participante:

- uma chamada de boas-vindas quando o túnel abre, que avisa ao runtime que ele está `online` e com que frequência o hub faz ping
- uma chamada em streaming por requisição de inferência: o runtime envia a requisição ao provedor e devolve o status e o corpo em streaming. Interromper a chamada aborta a requisição ao provedor.
- para um participante de harness, um stream de longa duração que o hub abre junto com o túnel. Tudo o que o harness produz (mensagens ACP, status da sessão, snapshots do workspace) sobe como partes desse stream.
- para um participante de harness, chamadas para enviar uma mensagem ACP, abrir uma sessão de harness e fechar uma sessão

O hub faz ping no túnel a cada 5 segundos e o derruba depois de um ping perdido. O runtime derruba um túnel cujo hub ficou 15 segundos sem dizer nada, o que detecta um hub travado. Nos dois casos, o participante fica `offline` e o runtime se reconecta.

O formato dessas chamadas na rede pertence à biblioteca de RPC e não tem versão própria. Por isso o hub e os participantes dele precisam rodar a mesma minor do Gambi.

Clientes de gerenciamento fazem attach em um participante de harness pelo hub, com um stream de Server-Sent Events e requisições HTTP comuns. Um cliente conectado continua conectado enquanto o túnel do participante está fora do ar, e recebe `harness.connected` quando o participante volta.

## Adaptação de protocolo entre Responses e Chat Completions

O protocolo padrão é o Responses. O Chat Completions continua disponível por compatibilidade.

Quando um cliente usa Responses e o provedor do participante só fala Chat Completions, o hub cria a Response por meio do Chat Completions e traduz a resposta. Duas consequências:

- um cliente usando Responses consegue alcançar um participante que só expõe Chat Completions
- a tradução carrega mensagens e function tools; uma requisição que precisa de uma conversa armazenada (`previous_response_id`, por exemplo) ou de uma tool que não é uma função falha com `request_not_translatable`, e uma Response traduzida não pode ser lida, apagada nem cancelada depois

Um cliente usando Chat Completions alcança o Chat Completions do provedor sem mudanças.

Integrações novas devem preferir o Responses. Recorra ao Chat Completions só quando precisar de compatibilidade explícita com uma ferramenta existente.

## Status do participante

Um participante tem um único status, derivado do túnel dele: `offline` (registrado, sem túnel aberto), `online` (túnel aberto e ocioso) ou `busy` (atendendo uma requisição). Só participantes `online` recebem requisições. Um participante que fica `offline` por 60 segundos é removido da sala. Depois de uma queda curta, o runtime se reconecta bem antes disso: ele espera 1 segundo e dobra a espera até 30.

As salas vivem na memória do hub. Se o hub reinicia, as salas dele somem, e os participantes que tentam voltar terminam com "room not found". Crie a sala de novo e entre outra vez.

## Observabilidade

O hub emite um snapshot da sala quando você começa a acompanhá-la, um evento para cada mudança de status de um participante, e `llm.request`, `llm.complete` e `llm.error` para inferência. O `llm.complete` traz métricas de tempo e de tokens. Veja [Observabilidade](/pt-br/reference/observability/) para os campos.

## O que o Gambi não faz

- Ele não hospeda modelos.
- O hub não tem autenticação embutida. Rode-o em uma rede confiável, ou atrás do seu próprio proxy e camada de autenticação.
- O hub não orquestra modelos nem harnesses. Os apps podem coordenar o trabalho pelo SDK sem levar essa política para dentro do hub.

Para saber onde a coordenação acima do hub está sendo explorada, veja [O que vem por aí](/pt-br/concepts/whats-next/).
