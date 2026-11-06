---
title: Referência do SDK
description: Referência do provedor, do cliente de gerenciamento, do runtime de sessão de participante e dos helpers de descoberta do SDK do Gambi.
---

O SDK do Gambi tem cinco pontos de entrada:

- `createGambi()` para inferência pelas rotas compatíveis com OpenAI, escopadas por sala
- `createClient()` para operações de gerenciamento na API nativa `/v1`
- `createParticipantSession()` para rodar um participante de modelo por um túnel
- `createHarnessParticipantSession()` para rodar um participante de harness por um túnel
- helpers de descoberta para encontrar hubs e salas na rede local

## Instalação

```bash
npm install gambi-sdk
# ou
bun add gambi-sdk
```

## Pontos de entrada

| Ponto de entrada | Uso principal | Transporte |
| --- | --- | --- |
| `createGambi()` | inferência da aplicação | `/rooms/:code/v1/*` |
| `createClient()` | controle operacional | `/v1/*` |
| `createParticipantSession()` | runtime de participante | API de gerenciamento + túnel do participante |
| `createHarnessParticipantSession()` | runtime de participante de harness | API de gerenciamento + túnel do participante |
| helpers de descoberta | resolução de salas e hubs na rede local | mDNS + API de gerenciamento |

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
| `gambi.participant(id)` | o participante com esse id | você precisa de um alvo exato (afinidade, depuração, benchmark) |

Um participante só está disponível quando o túnel dele está conectado, ele não está offline e não está atendendo outra requisição. Participantes de harness nunca são selecionados. Quando nenhum participante está disponível, a requisição falha com HTTP `404`; então uma rajada de chamadas `any()` concorrentes maior que o número de participantes livres recebe algumas respostas `404`. Veja [Roteamento de modelo](/pt-br/reference/api/#roteamento-de-modelo) e [Erros de inferência](/pt-br/reference/api/#erros-de-inferência).

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

### Streaming

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

Você também pode chamar a API de inferência diretamente com `fetch` e `stream: true` em `${gambi.baseURL}/responses` ou `${gambi.baseURL}/chat/completions`.

### `gambi.listModels()`

Busca `GET /rooms/:code/v1/models` e retorna um array simples, com uma entrada por participante de modelo disponível:

```ts
const models = await gambi.listModels();
// [{ id, nickname, model, endpoint, capabilities }, ...]

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

A lista deixa de fora participantes de harness e participantes offline ou sem túnel conectado. Ela não exclui participantes ocupados. Em uma resposta fora da faixa 2xx, lança um `Error` simples. Para o estado do túnel, use `gambi.listParticipants()`.

### `gambi.listParticipants()`

Retorna os resumos de participante do plano de gerenciamento (management plane) para a sala.

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

Todos os métodos de gerenciamento retornam envelopes `{ data, meta }`.

### Namespaces

| Namespace | Métodos |
| --- | --- |
| `client.rooms` | `create`, `get`, `list` |
| `client.participants` | `upsert`, `list`, `remove`, `heartbeat` |
| `client.events` | `watchRoom` |
| `client.harness` | `attach` |

### `client.rooms.create(input)`

```ts
const created = await client.rooms.create({
  name: "Demo",
  password: "secret",
  defaults: { temperature: 0.4 },
});

console.log(created.data.room.code);
console.log(created.data.hostId);
```

### `client.rooms.get(roomCode)`

```ts
const { data } = await client.rooms.get("ABC123");
console.log(data.participantCount, data.passwordProtected);
```

### `client.rooms.list()`

```ts
const { data } = await client.rooms.list();
for (const room of data) {
  console.log(room.code, room.name, room.participantCount);
}
```

### `client.participants.upsert(roomCode, participantId, input)`

Cria ou atualiza o registro de um participante.

```ts
const result = await client.participants.upsert("ABC123", "worker-1", {
  nickname: "worker-1",
  model: "llama3",
  endpoint: "http://localhost:11434",
  capabilities: {
    openResponses: "supported",
    chatCompletions: "supported",
  },
});

console.log(result.data.tunnel.url);
```

Campos de entrada:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nickname` | `string` | sim | nome de exibição |
| `model` | `string` | sim | nome do modelo |
| `endpoint` | `string` | para participantes de modelo | URL do endpoint local ao participante |
| `harness` | `object` | para participantes de harness | `id` do harness mais os metadados opcionais `model` e `hosted` |
| `password` | `string` | não | senha da sala |
| `specs` | `object` | não | specs da máquina |
| `config` | `RuntimeConfig` | não | padrões de runtime do participante |
| `capabilities` | `object` | não | resumo das capacidades de protocolo |

Campos de retorno:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `participant` | `ParticipantSummary` | estado público do participante |
| `roomId` | `string` | identificador interno da sala |
| `tunnel` | `TunnelBootstrap` | bootstrap do túnel, de uso único |

Este método é seguro para retentativas porque a rota de gerenciamento por trás dele é idempotente. O bootstrap token do túnel é de uso único e tem vida curta.

### `client.participants.list(roomCode)`

```ts
const { data } = await client.participants.list("ABC123");
for (const participant of data) {
  console.log(participant.id, participant.status, participant.connection);
}
```

### `client.participants.heartbeat(roomCode, participantId)`

Envia um heartbeat. Chame este método a cada dez segundos enquanto o seu próprio runtime de participante estiver vivo. O hub marca um participante como offline depois de trinta segundos sem heartbeat.

```ts
setInterval(() => {
  client.participants.heartbeat("ABC123", "worker-1").catch(console.error);
}, 10_000);
```

A cadência e o timeout vêm de `HEALTH_CHECK_INTERVAL` e `PARTICIPANT_TIMEOUT` em `@gambi/core`. Se você usa `createParticipantSession()`, ele gerencia esse loop para você.

### `client.participants.remove(roomCode, participantId)`

```ts
await client.participants.remove("ABC123", "worker-1");
```

### `client.events.watchRoom({ roomCode, signal? })`

Observa os eventos da sala como um async iterable.

```ts
const controller = new AbortController();

for await (const event of client.events.watchRoom({
  roomCode: "ABC123",
  signal: controller.signal,
})) {
  console.log(event.type, event.data);
}
```

Tipos de evento:

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

Veja [Observabilidade](/pt-br/reference/observability/) para o formato dos payloads dos eventos `llm.*`.

### `client.harness.attach({ roomCode, participantId, signal? })`

Conecta-se a um participante de harness pelo WebSocket de gerenciamento e recebe os frames de relay validados dele.

```ts
const channel = await client.harness.attach({
  roomCode: "ABC123",
  participantId: "harness-1",
});

channel.send({
  type: "tunnel.harness.control",
  sessionId: "session-1",
  action: "open",
  cwd: "/workspace",
});

for await (const frame of channel.messages) {
  if (frame.type === "tunnel.harness.message") {
    console.log(frame.message);
  }
}

channel.close();
```

`send()` aceita `tunnel.harness.message` e `tunnel.harness.control`. `messages` produz frames de mensagem, de artefato e de status. Abortar `signal` ou chamar `close()` encerra o canal. O hub trata o objeto ACP `message` como opaco.

Este canal faz parte do cliente de gerenciamento. Participantes de harness não aparecem no roteamento de modelo e não podem receber chamadas de inferência do `createGambi()`. Veja [Traga seu harness](/pt-br/guides/bring-your-harness/) para configurar o participante.

## `createParticipantSession(options)`

Cria e gerencia um runtime de participante apoiado em túnel.

```ts
import { createParticipantSession } from "gambi-sdk";

const session = await createParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "worker-1",
  nickname: "worker-1",
  endpoint: "http://localhost:11434",
  model: "llama3",
  authHeaders: {
    Authorization: `Bearer ${process.env.PROVIDER_TOKEN}`,
  },
});

await session.waitUntilClosed();
```

O que ele faz:

1. Sonda o endpoint local.
2. Registra o participante pela API de gerenciamento.
3. Abre o túnel do participante.
4. Encaminha as requisições do túnel para o endpoint do provedor local.
5. Continua enviando heartbeats de gerenciamento a cada dez segundos e pings pelo túnel na mesma cadência.

Os `authHeaders` ficam locais ao runtime do participante. Eles só são aplicados quando o runtime conversa com o endpoint do provedor.

Para um passo a passo, veja [Runtime de participante customizado](/pt-br/guides/custom-participant/).

### Formato de retorno da sessão

| Campo | Descrição |
| --- | --- |
| `participant` | resumo do participante registrado |
| `roomId` | identificador da sala |
| `tunnel` | detalhes do bootstrap do túnel |
| `close()` | para a sessão e remove o registro (melhor esforço) |
| `waitUntilClosed()` | resolve com o evento de fechamento |

Motivos de fechamento:

- `"closed"`: `close()` foi chamado. O SDK não instala handlers de sinal; conecte-os você mesmo.
- `"heartbeat_failed"`: uma requisição de heartbeat de gerenciamento falhou. Uma falha basta para fechar a sessão.
- `"tunnel_closed"`: o túnel WebSocket fechou ou deu erro, de qualquer um dos lados. A sessão não reconecta e não remove o registro; o hub marca o participante como offline assim que o túnel fecha.

Em `"closed"` e `"heartbeat_failed"`, a sessão tenta remover o participante da sala antes de resolver.

## `createHarnessParticipantSession(options)`

Roda um harness local como participante de uma sala a partir da sua própria aplicação,
por exemplo para hospedar harnesses para quem não trouxe um. É o mesmo
runtime que `gambi participant join --harness` usa, e roda em Node e Bun.

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type Workspace,
} from "gambi-sdk";

const local = createLocalDirectoryWorkspace();

// Opcional: crie um conteúdo inicial antes de o harness iniciar.
const workspace: Workspace = {
  async prepare(context) {
    const prepared = await local.prepare(context);
    await writeFile(join(prepared.path, "README.md"), "# Brief\n");
    return prepared;
  },
};

const session = await createHarnessParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "hosted-opencode-1",
  nickname: "Hosted OpenCode",
  harnessId: "opencode",
  hosted: true,
  workspace,
});

console.log(session.workspacePath);
await session.waitUntilClosed();
```

Opções além das compartilhadas `hubUrl`, `roomCode`, `participantId`, `nickname`,
`password`, `specs` e `config`:

| Opção | Descrição |
| --- | --- |
| `harnessId` | `opencode`, `claude-code`, `codex` ou `fake` |
| `model` | rótulo opcional exibido com o participante |
| `hosted` | marca um harness que o host da sala roda para outras pessoas. Rejeitado para `claude-code`. |
| `workspace` | onde o harness roda; o padrão é `createLocalDirectoryWorkspace()` |
| `gambiHome` | diretório base do workspace padrão (`~/.gambi`) |
| `adapter` | substitui o comando e a verificação de prontidão do `harnessId` |
| `onEvent` | eventos de ciclo de vida: `harness_spawned`, `session_opened`, `artifact_sent`, `harness_exited` |
| `artifactDebounceMs` | tempo de espera após a última mudança de arquivo antes de enviar um artefato (padrão `1000`) |

Um binário ou login ausente lança `HarnessDependencyError` antes de qualquer
registro. A sessão adiciona `processPid`, `sessionId`, `workspacePath` e
`harnessExited` ao formato da sessão de participante, além do motivo de fechamento
`"harness_exited"`.

### Workspace

Um `Workspace` é a pasta na máquina do participante onde o harness
roda. `prepare(context)` retorna um workspace preparado com `path`,
`watch(onChange, onError)` e `collect()`; o runtime observa o workspace e envia um
snapshot completo como cada nova versão de artefato. `createLocalDirectoryWorkspace({ path? })`
usa `path` ou uma pasta vazia em `~/.gambi/workspaces/<room>/<participant>/`.
Ele escreve apenas `.gambi.json`, que nunca aparece em um artefato.

### Testando sem um modelo

`runFakeAcpAgent()` roda um processo de harness determinístico que não chama nenhum modelo. Ele responde a cada prompt com
`Fake ACP response: <prompt>` e escreve `fake-output.txt` no workspace.
Como um SDK empacotado não consegue localizar o próprio script, envolva-o em um script seu e
aponte o adapter para ele:

```ts
// scripts/fake-acp-agent.ts
import { runFakeAcpAgent } from "gambi-sdk";
await runFakeAcpAgent();
```

```ts
import { createFakeHarnessAdapter } from "gambi-sdk";

await createHarnessParticipantSession({
  // ...
  harnessId: "fake",
  adapter: createFakeHarnessAdapter({
    command: process.execPath,
    args: ["scripts/fake-acp-agent.ts"],
  }),
});
```

## Helpers de descoberta

A descoberta é opcional. `createGambi()` e `createClient()` nunca descobrem nada por conta própria; passe a URL do hub para eles.

Helpers disponíveis:

- `discoverHubs(options?)`
- `discoverRooms(options?)`
- `resolveGambiTarget(options?)`

Opções comuns (`DiscoveryOptions`):

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `hubUrl` | `string` | pula o mDNS e consulta este hub diretamente |
| `timeoutMs` | `number` | quanto tempo esperar pelas respostas mDNS |
| `fetchFn` | `typeof fetch` | fetch customizado (testes, proxies) |
| `browseServices` | `BrowseServicesLike` | browser mDNS customizado |

`resolveGambiTarget()` também aceita `roomCode` e `roomName` para escolher uma única sala.

### Exemplo

```ts
import { createGambi, resolveGambiTarget } from "gambi-sdk";

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

## Exports de baixo nível

A maioria das aplicações não precisa deles. Eles existem para testes, embedding e runtimes customizados.

| Export | Descrição |
| --- | --- |
| `hub.create(options)` | inicia um hub no processo atual, o mesmo hub que `gambi hub serve` roda. Opções: `port` (padrão `3000`), `hostname` (padrão `0.0.0.0`), `mdns`. Retorna `{ server, url, mdnsName?, close() }`. Requer Bun. |
| `rooms` | acesso direto ao registro de salas em processo de um hub iniciado com `hub.create()` no mesmo processo. Não conversa com um hub remoto; para isso, use `createClient()`. |
| `participants` | helpers que montam registros de participante e mesclam a config de runtime, usados pelo hub. |
| `getHarnessAdapter(id)` | o adapter embutido para `opencode`, `claude-code`, `codex` ou `fake`: o comando que ele roda e a verificação de prontidão dele. Use-o como base quando passar um `adapter` customizado. |
| `defaultWorkspacePath({ roomCode, participantId }, gambiHome?)` | a pasta padrão do workspace, `~/.gambi/workspaces/<room>/<participant>`. |

## Erros

As operações de gerenciamento lançam `ClientError`.

Campos:

- `status`: status HTTP
- `code`: código de erro do Gambi, como `ROOM_NOT_FOUND`
- `hint`: próximo passo legível para o operador
- `details`: payload estruturado opcional vindo do hub
- `requestId`: correlaciona com os logs do hub e os eventos SSE

```ts
import { ClientError } from "gambi-sdk";

try {
  await client.rooms.get("ZZZZZZ");
} catch (error) {
  if (error instanceof ClientError && error.code === "ROOM_NOT_FOUND") {
    console.warn(error.hint);
    return;
  }
  throw error;
}
```
