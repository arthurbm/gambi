---
title: Usando o Gambi com ferramentas de IA
description: Use uma sala do Gambi como backend de modelos compatível com OpenAI em editores, SDKs e scripts.
---

Toda sala do Gambi é uma API compatível com OpenAI. Qualquer ferramenta ou biblioteca que permita definir uma base URL customizada da OpenAI consegue enviar requisições para os participantes de modelo de uma sala. Participantes harness (Claude Code, Codex, OpenCode) não atendem essas requisições; os apps falam com eles pelo [canal de attach do harness](#gerenciamento-programático).

## Detalhes de conexão

Toda sala do Gambi expõe uma base URL compatível com OpenAI:

| Configuração | Valor |
| --- | --- |
| Base URL | `http://<hub-ip>:<port>/rooms/<ROOM_CODE>/v1` |
| Chave de API | qualquer string não vazia (o hub ignora) |
| Modelo | `*`, `model:<name>` ou `<participant-id>` |

Protocolos suportados:

- Responses API: padrão e preferido
- Chat Completions: caminho de compatibilidade

## Pré-requisitos

```bash
# 1. Suba o hub
gambi hub serve --port 3000

# 2. Crie uma sala
gambi room create --name "My Room"

# 3. Entre como participante
gambi participant join --room ABC123 --participant-id bot-1 --model llama3
```

## Editores e apps de chat

Qualquer ferramenta que aceite um endpoint customizado compatível com OpenAI pode apontar para o Gambi:

- Base URL: `http://<hub-ip>:3000/rooms/<CODE>/v1`
- Chave de API: `gambi`
- Modelo: `*` ou `model:<name>`

Isso funciona para ferramentas que enviam as requisições da sua máquina ou da sua rede, como o Cline ou um Open WebUI self-hosted. Produtos hospedados que chamam o modelo a partir dos próprios servidores não alcançam um hub numa rede privada, e o hub não deve ser exposto à internet sem uma camada de autenticação sua na frente.

## Exemplo em Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.100:3000/rooms/ABC123/v1",
    api_key="not-needed",
)

response = client.responses.create(
    model="*",
    input="Hello!",
)

print(response.output_text)
```

## Exemplo em TypeScript

```ts
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({
  roomCode: "ABC123",
  hubUrl: "http://192.168.1.100:3000",
});

const result = await generateText({
  model: gambi.any(),
  prompt: "Explain recursion briefly",
});

console.log(result.text);
```

Use `defaultProtocol: "chatCompletions"` só se as suas ferramentas ou participantes exigirem isso explicitamente.

## Exemplo com o SDK da OpenAI

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://192.168.1.100:3000/rooms/ABC123/v1",
  apiKey: "not-needed",
});

const response = await client.responses.create({
  model: "*",
  input: "Hello!",
});

console.log(response.output_text);
```

## Exemplo com curl

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "input": "Hello!"
  }'
```

Exemplo de compatibilidade com Chat Completions:

```bash
curl -X POST http://localhost:3000/rooms/ABC123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Gerenciamento programático

```ts
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });

const created = await client.rooms.create({ name: "My Room" });
console.log(created.data.room.code);

const participants = await client.participants.list(created.data.room.code);
console.log(participants.data);
```

Participantes harness são gerenciados separadamente da inferência compatível com OpenAI. Faça attach em um deles quando um app precisar do stream ACP ou dos artefatos dele:

```ts
const channel = await client.harness.attach({
  roomCode: created.data.room.code,
  participantId: "harness-1",
});

for await (const frame of channel.messages) {
  console.log(frame.type, frame.sessionId);
}
```

Eles ficam de fora do roteamento de inferência por `*`, `model:<name>` e participant-id.

Veja a [referência do SDK](/pt-br/reference/sdk/) e a [referência da API](/pt-br/reference/api/) para os contratos completos.
