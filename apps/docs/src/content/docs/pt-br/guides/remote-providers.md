---
title: Provedores remotos
description: Use provedores de LLM na nuvem, como OpenRouter, Together AI, Groq, Fireworks ou OpenAI, como participantes de uma sala do Gambi.
---

Você não precisa de uma GPU local para participar. Qualquer API na nuvem compatível com OpenAI pode servir como seu endpoint de LLM.

## Como funciona

Quando você entra em uma sala com um provedor remoto, o runtime do participante:

1. sonda o endpoint do provedor localmente
2. se registra no hub
3. abre um túnel de volta até o hub
4. repassa as requisições do túnel para o endpoint do provedor usando headers de autenticação locais

O hub nunca recebe as credenciais do seu provedor, e o endpoint do seu provedor não fica exposto para o resto da rede.

Protocolos suportados:

| Protocolo | Endpoint | Melhor para |
| --- | --- | --- |
| Responses API | `/v1/responses` | padrão preferido quando o provedor suporta |
| Chat Completions | `/v1/chat/completions` | compatibilidade com provedores e ferramentas que ainda exigem esse protocolo |

## Entre pela CLI

Em automações, prefira `--header-env` para que segredos não fiquem no histórico do shell.

```bash
export OPENROUTER_AUTH="Bearer sk-or-..."

gambi participant join --room ABC123 \
  --participant-id my-openrouter \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH
```

Você também pode enviar headers extras específicos do provedor:

```bash
gambi participant join --room ABC123 \
  --participant-id my-openrouter \
  --endpoint https://openrouter.ai/api \
  --model meta-llama/llama-3.1-8b-instruct:free \
  --nickname my-openrouter \
  --header-env Authorization=OPENROUTER_AUTH \
  --header "HTTP-Referer=https://my-app.example"
```

## Entre pelo SDK

Se você está construindo seu próprio runtime de participante, use `createParticipantSession()`:

```ts
import { createParticipantSession } from "gambi-sdk";

await createParticipantSession({
  hubUrl: "http://localhost:3000",
  roomCode: "ABC123",
  participantId: "my-openrouter",
  nickname: "my-openrouter",
  endpoint: "https://openrouter.ai/api",
  model: "meta-llama/llama-3.1-8b-instruct:free",
  authHeaders: {
    Authorization: `Bearer ${process.env.OPENROUTER_TOKEN}`,
  },
});
```

Os `authHeaders` ficam locais no runtime do participante. Eles só são aplicados quando esse runtime fala com o endpoint do provedor.

## Provedores populares

| Provedor | Base URL | Modelos gratuitos? |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api` | sim |
| Together AI | `https://api.together.xyz` | plano gratuito |
| Groq | `https://api.groq.com/openai` | plano gratuito |
| Fireworks | `https://api.fireworks.ai/inference` | plano gratuito |
| OpenAI | `https://api.openai.com` | não |

## Custo

Quando você entra com um provedor na nuvem:

- sua chave de API é usada em toda requisição roteada para você
- você paga pelos tokens consumidos
- os outros participantes não veem as credenciais do seu provedor

Escolha um modelo que você topa pagar, ou use modelos de plano gratuito para experimentar.

## Notas de segurança

- Os headers de autenticação do provedor ficam no runtime do participante.
- O modelo tunnel-first evita publicar o endpoint do provedor ou as credenciais dele para o resto da rede só para participar.
- O hub não tem autenticação embutida. Qualquer pessoa que alcance o hub pode enviar requisições que gastam os créditos do seu provedor. Mantenha-o em uma rede confiável, ou coloque-o atrás de HTTPS e da sua própria camada de autenticação.

## Qual protocolo usar

- Responses API: padrão preferido
- Chat Completions: caminho de compatibilidade

O hub consegue adaptar entre os dois protocolos quando necessário, mas integrações novas devem preferir a Responses API.
