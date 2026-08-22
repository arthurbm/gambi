# Runbook do evento de 23 de agosto de 2026

Este roteiro é para a pessoa facilitadora. O hub e o board confiam na rede
local e não têm login próprio. Não exponha as portas do evento na internet.

## Preparação antes de abrir a sala

Na máquina da facilitação:

```bash
bun install --frozen-lockfile
opencode auth list --pure
claude auth status --json
codex login status
bun run event
```

O último comando imprime o código da sala, o arquivo SQLite, a URL do admin e a
URL do projetor. Guarde esse bloco num arquivo local. Não cole saídas de
autenticação no board, no issue ou no projetor.

Descubra o IP da máquina com `hostname -I`. O público acessa
`http://<IP-DA-FACILITACAO>:3002/`. O admin abre
`http://localhost:3002/admin?token=<BOARD_ADMIN_TOKEN>` numa janela separada.
Libere apenas TCP 3000 e 3002 no firewall da rede local. A porta 3001 fica para
o proxy local do web. Teste a URL pública num telefone antes da chegada das
pessoas.

## Wi-Fi e equipamento

- Todos os aparelhos entram no mesmo SSID.
- Desative isolamento entre clientes no ponto de acesso.
- Desative a VPN de um aparelho se ela impedir acesso ao IP local.
- Teste o IP da facilitação num telefone sem cabo.
- Mantenha a máquina da facilitação no carregador.
- Deixe um cabo de rede e um roteador reserva prontos.
- Desative suspensão de tela e economia de energia durante a atividade.

No projetor, abra somente `/` em tela cheia. Deixe o admin numa janela privada
que não aparece na projeção. Confira a escala do navegador em 100%.

## Roteiro de 60 minutos

1. 0–8 min: lobby, três squads, nomes, claims e steerers.
2. 8–15 min: fundação. Cada squad fecha uma decisão curta.
3. 15–24 min: construção e serviço público.
4. 24–36 min: metrô. Não avance sem duas estações publicadas e a linha visível.
5. 36–46 min: crise entre vizinhos. Faça pelo menos uma devolução com motivo.
6. 46–55 min: festival. Troque o modelo, leia o handoff e peça uma intervenção
   pequena em cada bairro.
7. 55–60 min: finale. Leia as decisões, origens dos drafts e devoluções.

Checkpoint por rodada: desafio publicado, steerer eleito, decisão gravada,
dispatch enviado e revisão registrada. Um tile só entra no projetor depois do
aceite e da publicação da versão válida.

## Corte para 30 minutos

- 0–5 min: lobby.
- 5–10 min: fundação.
- 10–16 min: construção.
- 16–22 min: metrô.
- 22–27 min: festival e troca de modelo.
- 27–30 min: finale.

Pule serviço público e crise primeiro, as rodadas 3 e 5. Preserve o metrô. Se o
overlay falhar, mostre os bairros sem a linha e siga para o festival.

## Fallback manual

Se a automação do orquestrador parar, a pessoa facilitadora lê o desafio
semeado, pergunta as quatro respostas da decisão e copia o dispatch para o
harness designado. As pessoas dos squads digitam diretamente nos terminais dos
próprios harnesses. A facilitação decide se aceita, devolve para rework ou
encerra. Não deixe um loop automático tomar essa decisão.

Se o board ainda estiver disponível, registre decisão e revisão nele. Se não
estiver, crie um arquivo `fallback-AAAA-MM-DD-HHMM.txt` com uma seção por squad:

```text
Squad:
Rodada:
Fazer:
Cortar:
Motivo:
Harness:
Revisão:
```

Guarde o arquivo ao lado do SQLite para lançamento posterior.

## Escada de falhas

1. Board web fora: recarregue `:3002`. Se o servidor do board está vivo, o
   projetor e os RPCs continuam. Se não, envie `SIGUSR1` ao PID impresso pelo
   supervisor e espere `Board restart complete`.
2. Modelo do orquestrador fora: pare as propostas automáticas. Use os desafios
   semeados e faça a orquestração manual descrita acima. Squads e harnesses
   continuam funcionando.
3. Um harness fora: designe outro harness conectado para o squad. Se não houver,
   o squad registra a decisão e trabalha num terminal local, sem dispatch.
4. Hub ou rede fora: não reinicie o board repetidamente. Mantenha o projetor na
   última cidade salva, passe para o log de fallback e faça a dinâmica falada.
   Restaure a rede antes de tentar novos joins.

## Encerramento

Pressione Ctrl+C uma vez no terminal de `bun run event`. Espere web, board,
harnesses e hub encerrarem nessa ordem. Confirme que não existe processo
`opencode acp` hospedado restante. Preserve o caminho SQLite impresso no início
e copie as capturas do projetor antes de desligar a máquina.
