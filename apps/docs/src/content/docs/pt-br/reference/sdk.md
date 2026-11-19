---
title: Referência do SDK
description: Referência do provedor, do cliente de gerenciamento, das entradas de hospedagem e dos helpers de descoberta do SDK do Gambi.
---

O SDK do Gambi (`gambi-sdk`) tem quatro entradas. Cada uma é um arquivo separado, então importar uma nunca carrega outra:

| Entrada | Exports | Roda em |
| --- | --- | --- |
| `gambi-sdk` | `createGambi()`, `createClient()`, `ClientError` | Node e Bun |
| `gambi-sdk/discovery` | `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`, `DiscoveryError` | Node e Bun |
| `gambi-sdk/hub` | `createHub()`, `HubError` | só Bun |
| `gambi-sdk/participant` | `createParticipantSession()`, `createHarnessParticipantSession()`, `createLocalDirectoryWorkspace()`, `probeProvider()`, `runFakeAcpAgent()`, `MAX_ARTIFACT_BYTES`, `ParticipantError` | só Bun |

Toda função retorna uma `Promise` (ou um async iterable), e toda entrada exporta os tipos TypeScript do que retorna. As duas entradas de hospedagem rodam um hub ou um participante dentro do seu próprio processo. Elas precisam do Bun e, quando carregadas no Node, lançam um erro que diz isso.

## Instalação

```bash
npm install gambi-sdk
# ou
bun add gambi-sdk
```

Um participante hospedado com `gambi-sdk/participant` e o hub em que ele entra precisam rodar a mesma minor do Gambi. Um hub recusa um participante de outra minor com `VERSION_MISMATCH`. Atualize o `gambi-sdk` e o hub juntos.

## `createGambi(options)`

Cria uma instância de provedor para inferência da aplicação.

```ts
import { createGambi } from "gambi-sdk";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://localhost:3000",
});
```

| Opção | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `roomCode` | `string` | nenhum (obrigatório) | código da sala à qual se conectar |
| `hubUrl` | `string` | `http://localhost:3000` | URL do hub |
| `defaultProtocol` | `"openResponses" \| "chatCompletions"` | `"openResponses"` | protocolo padrão dos helpers de roteamento de nível superior |

### Roteamento de modelo

O provedor oferece três helpers de roteamento. Cada um retorna um `LanguageModelV3`, a interface de modelo do AI SDK 6, então passe o resultado para `generateText()`, `streamText()` e as outras funções do AI SDK 6. O pacote declara `ai` como peer dependency opcional (`^4 || ^5 || ^6`) e é compilado e testado com o AI SDK 6.

```ts
import { generateText } from "ai";

await generateText({ model: gambi.any(), prompt: "..." });
await generateText({ model: gambi.model("llama3"), prompt: "..." });
await generateText({ model: gambi.participant("worker-1"), prompt: "..." });
```

| Helper | Seleciona | Use quando |
| --- | --- | --- |
| `gambi.any()` | um participante disponível aleatório | qualquer participante disponível serve |
| `gambi.model(name)` | o primeiro participante disponível que expõe `name` | você precisa de um modelo específico, mas não de uma máquina específica |
| `gambi.participant(id)` | o participante com esse id, quando ele está disponível | você quer uma máquina específica (afinidade, depuração, benchmark) |

Um participante só está disponível quando está `online`: o túnel dele está aberto e ele não está atendendo outra requisição. `any()` e `model()` nunca selecionam participantes de harness. `gambi.participant(id)` envia o ID como seletor de modelo, então não é um alvo exato: quando esse participante está ocupado ou offline e outro participante disponível serve um modelo com o mesmo nome, esse outro recebe a requisição. Quando nenhum participante pode atender uma requisição de `any()` ou `model()`, ela falha com HTTP `404` e o código `model_not_found`; então uma rajada de chamadas `any()` concorrentes maior que o número de participantes livres recebe algumas respostas `404`. Uma requisição de `participant(id)` cujo participante está ocupado ou offline, sem outro participante servindo um modelo com esse nome, falha com `409 participant_busy` ou `503 participant_offline`. Veja [Roteamento de modelo](/pt-br/reference/api/#roteamento-de-modelo) e [Erros de inferência](/pt-br/reference/api/#erros-de-inferência).

### Seleção de protocolo

O provedor usa `openResponses` por padrão.

```ts
gambi.any();
gambi.model("llama3");
gambi.participant("worker-1");

gambi.openResponses.any();
gambi.chatCompletions.any();
```

Use `chatCompletions` só quando precisar de compatibilidade explícita. Integrações novas devem preferir o caminho padrão, a Responses API.

### Streaming e cancelamento

O streaming funciona pelo AI SDK como com qualquer outro provedor.

```ts
import { streamText } from "ai";

const result = streamText({
  model: gambi.any(),
  prompt: "Write a haiku about local-first infrastructure.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

Abortar a requisição (com o `abortSignal` do AI SDK ou saindo do stream) cancela a geração na máquina do participante, e o participante fica livre para a próxima requisição. Uma requisição que não recebe nada do participante por 5 minutos falha com `inference_timeout`.

Você também pode chamar a API de inferência diretamente com `fetch` e `stream: true` em `${gambi.baseURL}/responses` ou `${gambi.baseURL}/chat/completions`.

### `gambi.listModels()`

Busca `GET /rooms/:code/v1/models` e retorna um array simples, com uma entrada por participante de modelo disponível:

```ts
const models = await gambi.listModels();
// [{ id, nickname, model, endpoint, capabilities, status }, ...]

for (const m of models) {
  console.log(m.id, m.model);
}
```

| Campo | Descrição |
| --- | --- |
| `id` | ID do participante; passe-o para `gambi.participant(id)` |
| `nickname` | nome de exibição do participante |
| `model` | nome do modelo que o participante serve |
| `endpoint` | endpoint do provedor, local ao participante (informativo; o hub nunca o chama) |
| `capabilities` | suporte a `openResponses` e `chatCompletions` |
| `status` | `online` ou `busy` |

A lista deixa de fora participantes de harness e participantes offline. Ela inclui os ocupados. Ela rejeita com um `ClientError`: `ROOM_NOT_FOUND`, `HUB_UNREACHABLE` ou `NOT_A_HUB`.

### `gambi.listParticipants()`

Retorna os resumos de participante do plano de gerenciamento (management plane) para a sala. Rejeita com um `ClientError`, como o cliente de gerenciamento.

### `gambi.baseURL`

Retorna a URL base compatível com OpenAI, escopada pela sala.

## `createClient(options)`

Cria o cliente de gerenciamento.

```ts
import { createClient } from "gambi-sdk";

const client = createClient({
  hubUrl: "http://localhost:3000",
});
```

O padrão de `hubUrl` é `http://localhost:3000`. Os métodos retornam o próprio valor, sem o envelope `{ data, meta }` da API HTTP, e rejeitam com um [`ClientError`](#erros) quando a chamada ao hub falha.

### Namespaces

| Namespace | Métodos |
| --- | --- |
| `client.hub` | `health` |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `register`, `list`, `remove` |
| `client.events` | `watch` |
| `client.harness` | `attach`, `openSession`, `send`, `closeSession` |

`client.close()` encerra as observações abertas, cancela as chamadas em andamento e recusa chamadas novas; esses métodos em `Promise` rejeitam com um `Error` simples (`The client is closed.`), não com um `ClientError`, e um novo `events.watch()` ou `harness.attach()` lança esse `Error` na hora. Ele é opcional: um cliente que nunca é fechado não segura nada depois que as observações dele terminam. O cliente também funciona com `await using`.

### `client.hub.health()`

```ts
const health = await client.hub.health();
// { status: "ok", timestamp }
```

### `client.rooms.create(input)`

```ts
const created = await client.rooms.create({
  name: "Demo",
  password: "secret",
  defaults: { temperature: 0.4 },
});

console.log(created.room.code);
console.log(created.hostId);
```

### `client.rooms.get(roomCode)`

```ts
const room = await client.rooms.get("ABC123");
console.log(room.participantCount, room.passwordProtected);
```

### `client.rooms.list()`

```ts
const rooms = await client.rooms.list();
for (const room of rooms) {
  console.log(room.code, room.name, room.participantCount);
}
```

### `client.participants.list(roomCode)`

```ts
const participants = await client.participants.list("ABC123");
for (const participant of participants) {
  console.log(participant.id, participant.status);
}
```

`status` é `offline`, `online` ou `busy`, derivado do túnel do participante.

### `client.participants.register(roomCode, participantId, input)`

Cria ou atualiza o registro de um participante. Recebe os mesmos campos da [rota de registro](/pt-br/reference/api/#put-v1roomscodeparticipantsid) e preenche `version` com a versão do próprio SDK quando você a omite. Resolve com `{ participant, tunnel: { token, expiresAt } }`.

Só o registro não deixa um participante online: para isso é preciso um túnel, e um participante que nunca abre um é removido depois de 60 segundos. Para rodar um participante, use [`createParticipantSession()`](#createparticipantsessionoptions-gambi-sdkparticipant-só-bun); `register` serve para testes e automação.

### `client.participants.remove(roomCode, participantId)`

Tira um participante da sala. Resolve com `{ participantId }`.

```ts
await client.participants.remove("ABC123", "worker-1");
```

### `client.events.watch(roomCode, { signal? })`

Observa os eventos da sala como um async iterable.

```ts
const controller = new AbortController();

for await (const event of client.events.watch("ABC123", {
  signal: controller.signal,
})) {
  console.log(event.type);
}
```

- Nada é requisitado até o loop pedir o primeiro evento, que é sempre `room.snapshot`.
- Os eventos são puxados um de cada vez; um loop lento não os acumula no seu processo.
- O loop termina sem erro quando o hub fecha o stream, quando `signal` aborta ou quando o cliente é fechado. Sair do loop com `break` cancela a requisição. Para continuar observando depois de um restart do hub, chame `watch` de novo.
- O loop lança `ROOM_NOT_FOUND` no primeiro evento de uma sala que não existe, e `HUB_UNREACHABLE` ou `NOT_A_HUB` quando a conexão cai ou o hub envia algo que não é um evento.

Tipos de evento: `room.snapshot`, `participant.joined`, `participant.updated`, `participant.online`, `participant.busy`, `participant.offline`, `participant.removed`, `llm.request`, `llm.complete`, `llm.error`. O tipo `RoomEvent` é uma união em `type`. Veja [Observabilidade](/pt-br/reference/observability/) para os campos de cada um.

### `client.harness`

Faz attach a um participante de harness: lê o que o harness dele diz, abre e fecha sessões de harness e envia mensagens ACP. Essas chamadas vão para o hub, que as repassa pelo túnel do participante; o seu programa nunca se conecta ao participante.

```ts
const room = "ABC123";
const participant = "arthur-opencode";
const sessionId = "session-1"; // você escolhe

await client.harness.openSession(room, participant, sessionId);

let sent = false;
for await (const event of client.harness.attach(room, participant)) {
  // O stream não repete nada: envie quando ele estiver aberto.
  if (event.type === "harness.connected" && !sent) {
    sent = true;
    await client.harness.send(room, participant, sessionId, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/prompt",
      params: {
        sessionId,
        prompt: [{ type: "text", text: "Write a README for this project." }],
      },
    });
  }
  if (event.type === "harness.message" && event.sessionId === sessionId) {
    const { message } = event;
    if (message.id === 1 && ("result" in message || "error" in message)) {
      break; // a resposta ao prompt: o turno acabou
    }
    console.log(message); // atualizações enquanto o harness trabalha
  }
  if (event.type === "harness.artifact") {
    console.log(event.version, event.files.length);
  }
}

await client.harness.closeSession(room, participant, sessionId);
```

Todo cliente conectado a um participante lê todos os eventos desse participante, inclusive as respostas a outros clientes. Filtre `harness.message` por `sessionId`, associe as respostas às suas requisições pelo `id` do JSON-RPC e dê a cada cliente o próprio ID de sessão: dois clientes que dividem uma sessão e usam os mesmos IDs de requisição não conseguem distinguir as respostas. Sair do loop com `break` fecha o stream.

| Método | Resolve com | Descrição |
| --- | --- | --- |
| `attach(roomCode, participantId, { signal? })` | `AsyncIterable<HarnessAttachEvent>` | os eventos do participante de harness, com as mesmas regras de `events.watch` |
| `openSession(roomCode, participantId, sessionId, { cwd? }?)` | `{ sessionId }` | abre uma sessão de harness com um ID que você escolhe; `cwd` precisa estar dentro do workspace do participante |
| `send(roomCode, participantId, sessionId, message)` | `{ sessionId }` | entrega uma mensagem JSON-RPC ACP v1 ao harness; a resposta chega pelo `attach` |
| `closeSession(roomCode, participantId, sessionId)` | `{ sessionId }` | fecha uma sessão de harness |

Eventos de attach: `harness.connected`, `harness.disconnected`, `harness.message`, `harness.session`, `harness.artifact`, `harness.dropped`, `harness.detached`. Veja [Attach de harness](/pt-br/reference/api/#attach-de-harness) para os campos deles. Nada é reenviado para um cliente que faz attach tarde, e um cliente que lê devagar demais recebe `harness.dropped` com o número de eventos que perdeu. O hub trata o objeto ACP `message` como opaco.

Participantes de harness não aparecem no roteamento de modelo e não podem receber chamadas de inferência do `createGambi()`. Veja [Traga seu harness](/pt-br/guides/bring-your-harness/) para configurar o participante.

## `createHub(options)` (`gambi-sdk/hub`, só Bun)

Inicia um hub no processo atual: o mesmo hub que `gambi hub serve` roda.

```ts
import { createHub, HubError } from "gambi-sdk/hub";

const hub = await createHub({ port: 0, hostname: "127.0.0.1" });
console.log(hub.url); // "http://127.0.0.1:41233"

await hub.close();
```

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `hostname` | `0.0.0.0` | interface em que escutar |
| `port` | `3000` | porta em que escutar; `0` pega qualquer porta livre |
| `mdns` | `false` | anuncia o hub por mDNS |
| `inferenceIdleTimeoutMs` | 5 minutos | quanto tempo uma requisição pode esperar pelo próximo pedaço de uma resposta |
| `reconnectDeadlineMs` | 60 segundos | quanto tempo um participante pode ficar offline antes de ser removido |
| `onLog` | nenhum | recebe cada linha de log do hub; sem ele, o hub não registra log em lugar nenhum |

O hub tem `url`, `port` (a porta real), `mdnsName` (quando `mdns` está ligado) e `close()`, que fecha os túneis e os streams de eventos, retira o anúncio mDNS e libera a porta. As salas terminam com ele. Ele também funciona com `await using`.

`createHub` só rejeita com `HubError`, cujo `code` é `PORT_IN_USE` (`details.port` e `details.hostname`), `LISTEN_FAILED` ou `MDNS_ANNOUNCE_FAILED`. Quando ele rejeita, nada fica rodando.

## `createParticipantSession(options)` (`gambi-sdk/participant`, só Bun)

Entra em uma sala com um endpoint de modelo desta máquina e permanece nela.

```ts
import { createParticipantSession } from "gambi-sdk/participant";

const session = await createParticipantSession({
  hubUrl: "http://192.168.1.10:3000",
  roomCode: "ABC123",
  participantId: "worker-1",
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
  authHeaders: {
    Authorization: `Bearer ${process.env.PROVIDER_TOKEN}`,
  },
  onLifecycle: (event) => console.log(event.type),
});

const { reason } = await session.ended;
```

A promise resolve assim que o participante está `online` e rejeita com um [`ParticipantError`](#erros) quando a entrada falha; nesse caso, nada fica rodando.

O que ela faz:

1. Sonda o endpoint para descobrir as APIs que ele fala, a menos que você passe `capabilities`.
2. Registra o participante pela API de gerenciamento.
3. Abre o túnel até o hub e espera o hub aceitá-lo.
4. Atende cada requisição que o hub envia pelo túnel chamando o provedor local com `authHeaders`.
5. Quando o túnel cai, volta sozinha com o mesmo `participantId`.

Os `authHeaders` ficam neste processo. Eles só são aplicados quando o runtime chama o endpoint do provedor, e o hub nunca os vê.

A sessão não verifica se o provedor serve `model`. Se quiser, use `probeProvider(endpoint, authHeaders?)` antes: ele resolve com `{ reachable, models, capabilities }`.

Opções compartilhadas pelas duas sessões de participante:

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `hubUrl` | `http://localhost:3000` | URL do hub |
| `roomCode` | obrigatório | código da sala |
| `participantId` | obrigatório | ID estável; reutilize-o para voltar como o mesmo participante |
| `password` | nenhum | senha da sala |
| `reconnect` | `true` | volta quando o túnel cai; com `false`, a sessão termina na primeira queda |
| `leaveTimeoutMs` | `3000` | quanto tempo `leave()` espera pelo hub |
| `onLifecycle` | nenhum | recebe cada evento de ciclo de vida, em ordem |
| `onLog` | nenhum | recebe cada linha de log; sem ele, o runtime não registra log em lugar nenhum |

Opções da sessão de endpoint: `nickname`, `model` e `endpoint` (obrigatórias), `authHeaders`, `capabilities`, `specs`, `config`.

### Eventos de ciclo de vida

| `type` | Campos | Quando |
| --- | --- | --- |
| `connected` | `attempt`, `hubVersion` | o túnel está aberto; `attempt` é `0` na entrada |
| `reconnecting` | `attempt`, `delayMillis`, `reason` | o túnel caiu e o runtime tenta de novo em `delayMillis` (1 segundo, dobrando até 30) |
| `left` | `reason`, `error` | o runtime terminou; é sempre o último evento |

`reconnecting.reason` é `tunnelDropped`, `hubSilent` (o hub parou de responder aos pings), `hubUnreachable`, `tunnelOpenFailed` ou `hubError`. `left.reason` é:

- `stopped`: o seu programa chamou `leave()` ou `stop()`
- `refused`: o hub recusou a volta, e `error` traz o `name` e a `message` dele. Um hub que reiniciou não tem salas, então uma sessão que tenta voltar para ele termina aqui com `RoomNotFound`.
- `replaced`: outro runtime entrou na sala com o mesmo `participantId`, e o hub ficou com aquele
- `tunnelDropped`: o túnel caiu e a sessão roda com `reconnect: false`

Os callbacks nunca são aguardados, e um erro lançado ou rejeitado por um deles nunca para a sessão.

### Formato da sessão

| Campo | Descrição |
| --- | --- |
| `participant` | o participante como o hub o registrou |
| `ended` | resolve com `{ reason, error? }` quando o runtime terminou e não vai tentar de novo. Nunca rejeita |
| `leave()` | tira o participante da sala e para. Nunca rejeita, e desiste do hub depois de `leaveTimeoutMs` |
| `stop()` | para sem avisar o hub; a sala mostra o participante `offline` e o remove depois de 60 segundos |
| `[Symbol.asyncDispose]` | o mesmo que `leave()`, para `await using` |

O SDK não instala handlers de sinal. Para sair com Ctrl+C, chame `leave()` no seu próprio handler.

Para um passo a passo, veja [Runtime de participante customizado](/pt-br/guides/custom-participant/).

## `createHarnessParticipantSession(options)` (`gambi-sdk/participant`, só Bun)

Roda um harness local como participante de uma sala a partir da sua própria aplicação,
por exemplo para hospedar harnesses para quem não trouxe um. É o mesmo
runtime que `gambi participant join --harness` usa.

```ts
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type Workspace,
} from "gambi-sdk/participant";

const local = createLocalDirectoryWorkspace();

// Opcional: crie um conteúdo inicial antes de o harness iniciar.
const workspace: Workspace = {
  async prepare(context) {
    const prepared = await local.prepare(context);
    await Bun.write(`${prepared.path}/README.md`, "# Brief\n");
    return prepared;
  },
};

const session = await createHarnessParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "hosted-opencode-1",
  nickname: "Hosted OpenCode",
  harness: "opencode",
  hosted: true,
  workspace,
  onArtifact: (event) => console.log(event.type, event.sessionId),
});

console.log(session.harness.workspacePath);
await session.ended;
```

Opções além das compartilhadas:

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `nickname` | obrigatório | nome de exibição |
| `harness` | obrigatório | `opencode`, `claude-code`, `codex` ou `fake` |
| `model` | o ID do harness | rótulo opcional do modelo em que o harness roda |
| `hosted` | `false` | marca um harness que o host da sala roda para outras pessoas. Rejeitado para `claude-code` |
| `workspace` | `createLocalDirectoryWorkspace()` | onde o harness roda |
| `onArtifact` | nenhum | recebe os eventos `artifactSent` e `artifactSkipped` |
| `artifacts` | | `{ settleTimeMs, finalTimeoutMs, maxBytes }`: quanto tempo o workspace precisa ficar sem mudanças antes de um snapshot (1 segundo), quanto tempo o snapshot final pode levar no fechamento e o maior snapshot (8 MiB) |
| `harnessStopTimeoutMs` | `2000` | quanto tempo o harness tem para sair antes de ser morto |
| `fakeAgentCommand` | | o comando que roda o harness fake; veja abaixo |
| `specs`, `config` | | como na sessão de endpoint |

Um harness que não está instalado ou não está logado rejeita com `HARNESS_NOT_READY`, cuja mensagem diz como resolver, antes de qualquer registro.

A sessão adiciona `harness` ao formato da sessão:

| Campo | Descrição |
| --- | --- |
| `harness.pid` | ID do processo do harness |
| `harness.sessionId` | a sessão de harness que o runtime abriu no início; os artefatos a carregam |
| `harness.workspacePath` | a pasta em que o harness roda |
| `harness.notes` | mensagens para a pessoa, como o aviso sobre os termos do Claude Code |
| `harness.warning` | definido quando uma verificação de prontidão não conseguiu confirmar algo |
| `harness.exited` | resolve com `{ message, exitCode?, detail? }` se o harness sair por conta própria. Isso não encerra a sessão: decidir o que fazer cabe a você |

`leave()` primeiro tira um snapshot final enquanto o harness e o túnel ainda estão rodando (melhor esforço, até `artifacts.finalTimeoutMs`, 2 segundos por padrão), depois fecha o túnel, para o harness e tira o participante da sala.

Limites conhecidos:

- `artifactSent` significa que o snapshot entrou na fila para o hub, não que chegou. Um snapshot na fila quando o túnel cai se perde.
- Um snapshot maior que 8 MiB não é enviado: `onArtifact` recebe `artifactSkipped` com `cause: "tooLarge"`.
- Se o seu processo for morto com `kill -9`, um harness que não observa a própria entrada padrão pode continuar rodando.

### Workspace

Um `Workspace` é a pasta na máquina do participante onde o harness
roda. `prepare(context)` recebe `{ roomCode, participantId, harness, model }`
e retorna um workspace preparado:

| Campo | Descrição |
| --- | --- |
| `path` | caminho absoluto de uma pasta que existe |
| `collect()` | resolve com os arquivos de um snapshot: `{ path, encoding, content }` |
| `watch(onChange, onError)` | chama `onChange` quando algo mudou; retorna a função que para a observação. É chamado uma vez, antes de o harness iniciar |
| `dispose()` | opcional; chamado uma vez quando a sessão termina |

O runtime envia um snapshot completo como cada nova versão de artefato.
`createLocalDirectoryWorkspace({ path? })` usa `path` ou uma pasta em
`~/.gambi/workspaces/<room>/<participant>/`, criada vazia quando ainda não existe e
reaproveitada como está nos outros casos. Ele escreve apenas `.gambi.json`, que nunca aparece em um artefato, e deixa de fora `.git`, `node_modules` e links simbólicos.
Um `collect()` customizado para um workspace grande demais deve rejeitar com
`new ParticipantError({ code: "WORKSPACE_TOO_LARGE", message })`.

### Testando sem um modelo

O harness `fake` é um processo determinístico que não chama nenhum modelo. Ele responde a cada prompt com
`Fake ACP response: <prompt>` e escreve `fake-output.txt` no workspace.
Com o `gambi-sdk` instalado, `harness: "fake"` funciona como está.

Um programa que empacota o SDK no próprio arquivo não consegue rodar o harness fake
a partir do pacote. Envolva `runFakeAcpAgent()` em um script seu e passe o comando dele:

```ts
// scripts/fake-acp-agent.ts
import { runFakeAcpAgent } from "gambi-sdk/participant";
await runFakeAcpAgent();
```

```ts
await createHarnessParticipantSession({
  // ...
  harness: "fake",
  fakeAgentCommand: { command: "bun", args: ["scripts/fake-acp-agent.ts"] },
});
```

## Helpers de descoberta (`gambi-sdk/discovery`)

A descoberta é opcional. `createGambi()` e `createClient()` nunca descobrem nada por conta própria; passe a URL do hub para eles.

Helpers disponíveis:

- `discoverHubs(options?)`
- `discoverRooms(options?)`
- `resolveGambiTarget(options?)`

Opções comuns (`DiscoveryOptions`):

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `hubUrl` | `string` | um hub para consultar além dos que o mDNS encontra (padrão `http://localhost:3000`) |
| `timeoutMs` | `number` | quanto tempo esperar pelas respostas mDNS |
| `fetchFn` | `typeof fetch` | fetch customizado (testes, proxies) |
| `browseServices` | `BrowseServicesLike` | browser mDNS customizado |

`resolveGambiTarget()` também aceita `roomCode` e `roomName` para escolher uma única sala.

### Exemplo

```ts
import { createGambi } from "gambi-sdk";
import { resolveGambiTarget } from "gambi-sdk/discovery";

const target = await resolveGambiTarget({
  roomCode: "ABC123",
  timeoutMs: 1500,
});

const gambi = createGambi({
  hubUrl: target.hubUrl,
  roomCode: target.roomCode,
});
```

### `DiscoveryError`

Lançado quando a descoberta não consegue produzir um alvo único.

Códigos:

- `NO_HUBS_FOUND`
- `NO_ROOMS_FOUND`
- `ROOM_NOT_FOUND`
- `AMBIGUOUS_ROOM_MATCH` (inspecione `error.matches`)

## Erros

Cada entrada rejeita com a própria classe de erro, e `code` distingue os casos.

`ClientError` (de `gambi-sdk`) tem:

- `code`: um código de erro do hub, como `ROOM_NOT_FOUND`, ou um que o próprio cliente detecta
- `status`: status HTTP, ausente quando nada respondeu
- `hint`: próximo passo legível para o operador
- `details`: os campos estruturados do erro, como `roomCode` ou `hubVersion`
- `requestId`: correlaciona com o log do hub; definido quando o hub respondeu

| `code` | Significado |
| --- | --- |
| `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` | o que a chamada nomeou não existe |
| `INVALID_PASSWORD` | a sala tem senha e a chamada não trouxe nenhuma, ou trouxe a errada |
| `VERSION_MISMATCH` | o participante e o hub estão em minors diferentes |
| `INVALID_REQUEST` | a chamada não corresponde à API de gerenciamento; verificado antes de enviar qualquer coisa, quando possível |
| `INTERNAL_ERROR` | um bug no hub |
| `NOT_A_HARNESS_PARTICIPANT` | o participante compartilha um endpoint de modelo, então não há harness ao qual fazer attach |
| `PARTICIPANT_UNREACHABLE` | o túnel do participante não está aberto agora |
| `HARNESS_FAILED` | o harness não respondeu, recusou ou saiu; `details.reason` diz qual |
| `HARNESS_SESSION_NOT_OPEN` | a mensagem foi enviada a uma sessão de harness que não está aberta |
| `HARNESS_SESSION_OUTSIDE_WORKSPACE` | a sessão foi pedida para rodar fora do workspace do participante |
| `HUB_UNREACHABLE` | nada respondeu na URL do hub |
| `NOT_A_HUB` | algo respondeu, mas não como um hub do Gambi desta versão: outro servidor, um proxy ou um hub de outra versão |

```ts
import { ClientError } from "gambi-sdk";

try {
  await client.rooms.get("ZZZZZZ");
} catch (error) {
  if (error instanceof ClientError && error.code === "ROOM_NOT_FOUND") {
    console.warn(error.hint);
  } else {
    throw error;
  }
}
```

`HubError` (de `gambi-sdk/hub`) tem `code` (`PORT_IN_USE`, `LISTEN_FAILED`, `MDNS_ANNOUNCE_FAILED`) e `details`.

`ParticipantError` (de `gambi-sdk/participant`) tem `code` e `details`. Os códigos dele são `ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `VERSION_MISMATCH`, `INVALID_REQUEST`, `INTERNAL_ERROR`, `HUB_UNREACHABLE` e `TUNNEL_OPEN_FAILED` para qualquer sessão, mais `HARNESS_NOT_READY`, `HARNESS_START_FAILED`, `HARNESS_FAILED`, `WORKSPACE_FAILED` e `WORKSPACE_TOO_LARGE` para uma sessão de harness.
