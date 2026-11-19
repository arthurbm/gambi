---
title: Problemas comuns
description: Soluções para problemas comuns com hubs, participantes e harnesses do Gambi.
---

## Participante aparece como offline

Sintomas:

- o participante entrou com sucesso, mas aparece como offline
- as requisições falham porque não há participante disponível

Causas e soluções:

O status de um participante vem só do túnel dele: `offline` significa que o hub não tem nenhum túnel aberto vindo dele.

1. O participante está reconectando.
   - Depois de uma queda, o runtime do participante tenta de novo sozinho, esperando 1 segundo e dobrando até 30. Procure eventos `reconnecting` em `gambi participant join --format ndjson`.
   - Se ele ficar offline por 60 segundos, o hub o remove da sala. O runtime continua tentando, e o próximo registro dele o traz de volta com o mesmo ID.

2. O túnel não consegue abrir.
   - Confira se o processo `gambi participant join` ainda está rodando.
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
- nenhuma sala é descoberta na rede local

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

O hub responde CORS para qualquer origem, nas duas APIs.

1. Um proxy customizado está removendo os headers de CORS.
2. Um proxy customizado também está removendo os headers de upgrade para WebSocket necessários aos túneis dos participantes.

## A requisição vai para o participante errado

Sintomas:

- uma requisição é roteada para um participante diferente do esperado

Causas e soluções:

1. `gambi.model("llama3")` roteia para o primeiro participante disponível com esse modelo.
   - Use `gambi.participant("worker-1")` para pedir um participante. Ele não é um alvo exato: quando `worker-1` está ocupado ou offline, outro participante disponível que sirva um modelo chamado `worker-1` receberia a requisição. Dê aos participantes IDs que não sejam nomes de modelo.

2. O participante pretendido está offline ou ocupado. Só participantes `online` são escolhidos.

3. Um valor simples de `model` que não é ID de participante é tratado como nome de modelo. Se nenhum participante disponível tiver o ID enviado, o hub roteia para o primeiro participante disponível que serve um modelo com esse nome. Veja [Roteamento de modelos](/pt-br/reference/api/#roteamento-de-modelo).

## Participante entra e é recusado

Sintomas:

- `gambi participant join` sai com código `4` antes de ficar online
- um runtime customizado construído sobre `createParticipantSession()` rejeita com um `ParticipantError`

Leia o nome do erro (`--format json` o coloca em `error.name`) ou o `code`:

1. `VersionMismatch` / `VERSION_MISMATCH`: o participante roda outra minor do Gambi, diferente da do hub. A mensagem indica a versão que o hub espera. Instale uma versão dessa minor no participante, ou atualize o hub e o participante para a versão mais recente, para que os dois fiquem na mesma minor (qualquer `0.8.x` com qualquer outra `0.8.x`). `gambi self update` sempre instala a versão mais recente.
2. `RoomNotFound` / `ROOM_NOT_FOUND`: confira o código da sala com `gambi room list`.
3. `InvalidPassword` / `INVALID_PASSWORD`: passe a senha da sala com `--password`.

Já o código de saída `3` significa que o participante não conseguiu alcançar algo de que depende: o hub (`HubUnreachable`, `NotAHub`), o provedor dele (`EndpointUnreachable`, `ModelNotOnEndpoint`), o túnel (`TunnelOpenFailed`) ou o harness dele. A mensagem diz qual.

## Participante para depois que o hub reinicia

Sintomas:

- o processo do hub reiniciou, e o `gambi participant join` termina com `left` e `reason: "refused"`, mostrando `RoomNotFound` e saindo com código `4`
- o `session.ended` de um runtime customizado resolve com `reason: "refused"`

As salas vivem na memória do hub, e os códigos de sala são aleatórios. Um hub reiniciado volta sem as salas, então um participante que tenta voltar ouve que a sala não existe e para de propósito. Crie a sala de novo, compartilhe o novo código e entre outra vez.

O participante só volta sozinho quando o hub ficou inacessível por um tempo (o Wi-Fi piscou, o notebook dormiu) e retorna com as salas dele.

## Participante termina com `replaced`

Sintomas:

- `gambi participant join` termina com `left` e `reason: "replaced"`, com código de saída `4`
- o `session.ended` de um runtime customizado resolve com `reason: "replaced"`

Outro runtime entrou na mesma sala com o mesmo participant ID, e o hub ficou com o mais novo. O runtime substituído não tenta de novo, então os dois nunca tomam o túnel um do outro. Dê a cada participante rodando o próprio ID.

## Um participante que você removeu volta

Quando `gambi participant leave` remove um participante conectado, o hub fecha o túnel com `4002`. O `participant join` emite `left` com `reason: "removed"` e termina com código `4`.

Se alguém remover o participante enquanto o runtime espera entre tentativas de reconexão, não há túnel aberto ou em abertura para receber o `4002`. Na próxima tentativa, ele se registra de novo. Rode `participant leave` quando ele estiver online ou encerre o `participant join` com Ctrl+C na máquina dele.

## Requisição de streaming termina com `consumer_too_slow`

O app leu uma resposta em streaming devagar demais, e mais de 8 Mi caracteres dela se acumularam no hub. O hub cancela a requisição no participante e encerra o stream com esse erro. Leia o stream conforme ele chega, ou peça uma resposta que não seja stream.

## Requisição falha com `inference_timeout`

O participante não enviou nada por 5 minutos, antes do primeiro chunk ou entre dois chunks. O hub cancelou a requisição no participante. Um provedor que demora mais que isso para começar a responder (um modelo muito grande carregando, por exemplo) precisa ser aquecido antes.

## Latência alta

Sintomas:

- as requisições demoram bem mais que o esperado
- o streaming parece lento

Causas e soluções:

1. Latência de rede entre o participante e o hub.
2. Provedor ou modelo lento.
3. Requisições demais para participantes de menos.

Acompanhe os eventos da sala e olhe `llm.complete.metrics` para inspecionar:

- `ttftMs`
- `durationMs`
- `tokensPerSecond`

## Participante harness não inicia ou é rejeitado

Sintomas e soluções para `gambi participant join --harness`:

1. Código de saída `3` antes do registro, com uma mensagem pedindo para instalar ou fazer login.
   - O binário do harness ou o adaptador ACP dele não está instalado, ou não há login local. Rode o comando que a CLI imprime, por exemplo `opencode auth login`, `claude auth login` ou `codex login`, e tente de novo. Veja [Traga seu harness](/pt-br/guides/bring-your-harness/#instale-e-autentique-seu-harness).

2. Código de saída `2` e um erro dizendo que as flags `cannot be used with --harness`.
   - Remova `--endpoint`, `--header` e `--header-env`. O harness usa o próprio login local.

3. `Claude Code cannot run as a Gambi-hosted harness for third parties.`
   - Uma aplicação chamou `createHarnessParticipantSession()` com `harness: "claude-code"` e `hosted: true`. O SDK rejeita essa combinação. Cada pessoa precisa rodar o Claude Code com o próprio login.

4. Uma requisição de inferência retorna HTTP `400` com o código `inference_not_supported`.
   - O valor de `model` aponta para um participante harness. Participantes harness não aceitam requisições compatíveis com OpenAI. Use `client.harness.attach()` no lugar.

5. `artifact_skipped` com `cause: "tooLarge"`.
   - O snapshot do workspace passa de 8 MiB, por isso não foi enviado. Tire os arquivos grandes do workspace.

6. Um processo de harness continua rodando depois que o participante sumiu.
   - Se o `gambi participant join` (ou o seu programa) foi morto com `kill -9`, ele não conseguiu parar o harness. Um harness que não observa a entrada padrão continua rodando. Encontre-o e pare-o na mão. Ctrl+C e `SIGTERM` param o harness normalmente.

## Ainda com problemas?

1. Confira a saída do hub. `gambi hub serve` escreve as linhas de log no stderr (`--log-level debug` mostra mais), e `gambi events watch --room <code>` mostra os eventos da sala. Um erro da CLI ou do SDK pode trazer um `requestId`; procure por ele no log do hub.

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
