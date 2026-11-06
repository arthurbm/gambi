---
title: Problemas comuns
description: Soluções para problemas comuns com hubs, participantes e harnesses do Gambi.
---

## Participante aparece como offline

Sintomas:

- o participante entrou com sucesso, mas aparece como offline
- as requisições falham porque não há participante disponível

Causas e soluções:

1. As verificações de saúde estão falhando.
   - O participante envia um heartbeat a cada 10 segundos.
   - Se o hub ficar 30 segundos sem recebê-los, o participante é marcado como offline.
   - Confira se o processo `gambi participant join` ainda está rodando.

2. O túnel do participante está desconectado.
   - Um participante só recebe roteamento enquanto o túnel dele está conectado.
   - Reinicie o `gambi participant join`.
   - Confira se um firewall ou proxy está bloqueando o upgrade para WebSocket.

3. O hub está inacessível.

```bash
curl http://hub-ip:3000/v1/health
```

## Timeout de conexão

Sintomas:

- as requisições travam e acabam dando timeout
- aparece `ETIMEDOUT` ou `ECONNREFUSED`

Causas e soluções:

1. O hub não está rodando.

```bash
gambi hub serve --port 3000
```

2. O participante alcança o hub por HTTP, mas o upgrade do túnel está bloqueado.
   - Teste sem um reverse proxy no meio.
   - Se você usa nginx, Caddy ou outro proxy, garanta que os headers de upgrade para WebSocket sejam repassados.

3. A URL do hub configurada está errada.

## Descoberta via mDNS não funciona

Sintomas:

- os helpers de descoberta não encontram nenhum hub
- nenhuma room é descoberta na rede local

Causas e soluções:

1. O mDNS não está ativado.

```bash
gambi hub serve --mdns
```

2. As máquinas estão em segmentos de rede diferentes.

3. A porta UDP 5353 está bloqueada.

## Erros de CORS

Sintomas:

- o console do navegador mostra erros de CORS
- o uso no Node.js funciona, mas no navegador não

Causas e soluções:

1. Um proxy customizado está removendo os headers de CORS.
2. Um proxy customizado também está removendo os headers de upgrade para WebSocket necessários aos túneis dos participantes.

## A requisição vai para o participante errado

Sintomas:

- uma requisição é roteada para um participante diferente do esperado

Causas e soluções:

1. `gambi.model("llama3")` roteia para o primeiro participante disponível com esse modelo.
   - Use `gambi.participant("worker-1")` para mirar num participante exato.

2. O participante pretendido está offline, ocupado ou com o túnel desconectado.

3. Um valor simples de `model` que não é ID de participante é tratado como nome de modelo. Se nenhum participante disponível tiver o ID enviado, o hub roteia para o primeiro participante disponível que serve um modelo com esse nome. Veja [Roteamento de modelos](/pt-br/reference/api/#roteamento-de-modelo).

## Participante informa `tunnel_failed` ou `heartbeat_failed`

Sintomas:

- `gambi participant join --format ndjson` emite um evento `tunnel_failed` e sai
- `gambi participant join --format ndjson` emite um evento `heartbeat_failed` e sai
- um runtime customizado construído sobre `createParticipantSession()` informa o motivo de fechamento `"tunnel_closed"` ou `"heartbeat_failed"`

São falhas diferentes. Diagnostique pelo evento de ciclo de vida ou pelo motivo de fechamento. Nem a CLI nem o SDK reconectam sozinhos: reinicie o participante com o mesmo ID de participante.

### `tunnel_failed` / motivo de fechamento `"tunnel_closed"`

O túnel WebSocket até o hub foi interrompido. Causas comuns:

1. Um proxy entre o participante e o hub está removendo o `Upgrade: websocket`. Teste apontando o participante direto para o hub, sem passar pelo proxy.
2. O processo do hub reiniciou ou caiu. Confira os logs do hub e tente de novo.
3. O bootstrap token expirou antes de o participante terminar o upgrade. O token tem TTL de 60 segundos; uma rede lenta ou travada pode perder essa janela. Rodar `gambi participant join` de novo emite um token novo.
4. O hub derrubou o túnel anterior porque o mesmo ID de participante se reconectou de outro lugar. Decida se você quer mesmo rodar dois runtimes com o mesmo ID e, se não quiser, escolha outro ID.

### `heartbeat_failed`

Uma requisição HTTP de heartbeat de gerenciamento falhou. Uma única falha basta para fechar a sessão. Isso diz respeito ao acesso HTTP a `/v1`, não ao caminho do WebSocket. Causas comuns:

1. A URL do hub está errada ou desatualizada.
2. Um proxy ou firewall está bloqueando `POST /v1/rooms/:code/participants/:id/heartbeat`.
3. A room ou o participante foi apagado do hub enquanto o runtime ainda rodava. Confira com `gambi room get` e rode `gambi participant join` de novo.

Depois de `heartbeat_failed`, o runtime tenta se remover da room. Depois de `tunnel_closed`, não: o registro continua, e o hub marca o participante como offline assim que o túnel fecha. Nos dois casos, reiniciar com o mesmo ID de participante é seguro, porque o registro é idempotente.

## Latência alta

Sintomas:

- as requisições demoram bem mais que o esperado
- o streaming parece lento

Causas e soluções:

1. Latência de rede entre o participante e o hub.
2. Provedor ou modelo lento.
3. Requisições demais para participantes de menos.

Acompanhe os eventos da room e olhe `llm.complete.metrics` para inspecionar:

- `ttftMs`
- `durationMs`
- `tokensPerSecond`

## Participante harness não inicia ou é rejeitado

Sintomas e soluções para `gambi participant join --harness`:

1. Código de saída `3` antes do registro, com uma mensagem pedindo para instalar ou fazer login.
   - O binário do harness ou o adaptador ACP dele não está instalado, ou não há login local. Rode o comando que a CLI imprime, por exemplo `opencode auth login`, `claude auth login` ou `codex login`, e tente de novo. Veja [Traga seu harness](/pt-br/guides/bring-your-harness/#instale-e-autentique-seu-harness).

2. Código de saída `2` e um erro terminando em `cannot be used with --harness`.
   - Remova `--endpoint`, `--header` e `--header-env`. O harness usa o próprio login local.

3. `Claude Code cannot run as a Gambi-hosted harness for third parties.`
   - Uma aplicação chamou `createHarnessParticipantSession()` com `harnessId: "claude-code"` e `hosted: true`. O SDK rejeita essa combinação. Cada pessoa precisa rodar o Claude Code com o próprio login.

4. Uma requisição de inferência retorna HTTP `400` com `Harness participants do not serve inference requests`.
   - O valor de `model` aponta para um participante harness. Participantes harness não aceitam requisições compatíveis com OpenAI. Use `client.harness.attach()` no lugar.

## Ainda com problemas?

1. Confira a saída do hub. O hub imprime linhas `[gambi] llm.request`, `[gambi] llm.complete` e `[gambi] llm.error` no console, e `gambi events watch --room <code>` mostra os eventos da room.

2. Teste o endpoint do provedor diretamente:

```bash
curl http://localhost:11434/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3", "input": "Hi"}'
```

3. Abra uma issue no GitHub com:
   - a mensagem de erro
   - os passos para reproduzir
   - detalhes do ambiente
