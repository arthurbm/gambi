# Plano: TUI como Cliente Completo do Gambi

## Resumo Executivo

Transformar a TUI de ferramenta de monitoramento para **cliente completo** do Gambi, implementando todas as funcionalidades do core. A TUI será o ponto de entrada padrão quando o usuário executar `gambi` sem subcomando.

## Decisões Tomadas

- **Beads**: Criar epics e tasks via `bd create` com estrutura hierárquica
- **Serve Hub**: Embutir no processo da TUI (simples, hub fecha quando TUI fecha)
- **Detalhamento**: Tasks com acceptance criteria, arquivos envolvidos e exemplos

---

## Invocação: TUI vs CLI

**Regra clara de invocação:**

| Comando | O que abre |
|---------|------------|
| `gambi` | **TUI** - Interface interativa com todas as funcionalidades |
| `gambi serve` | CLI - Inicia hub (scripting) |
| `gambi create` | CLI - Cria room (scripting) |
| `gambi join` | CLI - Join como participante (scripting) |
| `gambi list` | CLI - Lista rooms (scripting) |

**A TUI é acessada APENAS via `gambi` (sem subcomando).**

Subcomandos (`serve`, `create`, `join`, `list`) são responsabilidade da CLI e existem para automação/scripting. Usuários interativos usam a TUI.

---

## Estrutura de Issues no Beads

```
EPIC: gambi-xxxx "TUI Full Client"
├── gambi-xxxx.1 "Documentar filosofia"
├── gambi-xxxx.2 "Sistema de navegação" (EPIC filho)
│   ├── gambi-xxxx.2.1 "Hook use-navigation"
│   ├── gambi-xxxx.2.2 "Refatorar app.tsx"
│   └── gambi-xxxx.2.3 "Footer dinâmico"
├── gambi-xxxx.3 "Menu principal"
├── gambi-xxxx.4 "Listagem de rooms" (EPIC filho)
│   ├── ...
└── ...
```

---

## Épicos e Tasks Detalhados

### EPIC 1: Documentação da Filosofia

**Título**: Documentar filosofia de paridade de features

**Descrição**:
Registrar no docs/architecture.md a filosofia de que todas as pontas (SDK, CLI, TUI) devem implementar todas as funcionalidades do core.

#### Task 1.1: Adicionar seção "Design Philosophy" em architecture.md

**Arquivo**: `docs/architecture.md`

**Acceptance Criteria**:
- [ ] Nova seção "Design Philosophy" após "Overview"
- [ ] Explicar que SDK, CLI e TUI têm paridade de features
- [ ] Descrever o papel de cada ponta:
  - SDK: Integração programática para aplicações JS/TS (compatível com Vercel AI SDK)
  - CLI: Scripts e automação
  - TUI: Uso interativo humano
- [ ] Mencionar que `gambi` sem subcomando abre a TUI

**Exemplo de conteúdo**:
```markdown
## Design Philosophy

Gambi follows the principle of **feature parity across all endpoints**:

- **SDK**: Programmatic integration for JavaScript/TypeScript applications (compatible with Vercel AI SDK)
- **CLI**: Scripting and automation for CI/CD and power users
- **TUI**: Interactive interface for human operators

All three endpoints implement the complete core functionality. Users can:
- Create and manage rooms
- Join as participants
- Monitor activity
- Start hub servers (CLI and TUI only)

Running `gambi` without a subcommand opens the TUI interface.
```

---

### EPIC 2: Sistema de Navegação

**Título**: Implementar sistema de navegação entre telas

**Descrição**:
Criar infraestrutura de navegação com state machine, histórico e passagem de parâmetros entre telas da TUI.

#### Task 2.1: Criar hook use-navigation.ts

**Arquivo**: `apps/tui/src/hooks/use-navigation.ts`

**Acceptance Criteria**:
- [ ] Definir tipo `Screen`: `"menu" | "serve" | "create" | "list" | "join" | "monitor"`
- [ ] Estado: `currentScreen`, `screenParams`, `history`
- [ ] Funções: `navigate(screen, params?)`, `goBack()`, `canGoBack()`
- [ ] Histórico limitado a 10 itens
- [ ] Hook retorna `{ screen, params, navigate, goBack, canGoBack }`

**Exemplo de uso**:
```tsx
const { screen, params, navigate, goBack } = useNavigation()

// Navegar para monitor com room codes
navigate("monitor", { roomCodes: ["ABC123"] })

// Voltar para tela anterior
if (canGoBack()) goBack()
```

**Dependências**: Nenhuma

---

#### Task 2.2: Refatorar app.tsx para usar router

**Arquivo**: `apps/tui/src/app.tsx`

**Acceptance Criteria**:
- [ ] Remover lógica atual de `screen` state
- [ ] Importar e usar `useNavigation()`
- [ ] Renderizar componente baseado em `screen`:
  - "menu" → MainMenu
  - "serve" → ServeHub
  - "create" → CreateRoom
  - "list" → ListRooms
  - "join" → JoinRoom
  - "monitor" → Monitor
- [ ] Passar `params` para cada tela

**Dependências**: Task 2.1

---

#### Task 2.3: Criar Footer dinâmico

**Arquivo**: `apps/tui/src/components/footer.tsx`

**Acceptance Criteria**:
- [ ] Receber prop `shortcuts: Array<{key: string, label: string}>`
- [ ] Sempre incluir `[q] Quit`
- [ ] Incluir `[←] Back` quando `canGoBack()` for true
- [ ] Renderizar shortcuts em layout horizontal
- [ ] Manter design visual atual

**Dependências**: Task 2.2

---

### EPIC 3: Tela de Menu Principal

**Título**: Criar menu principal com todas as opções

**Descrição**:
Implementar tela inicial da TUI com navegação para todas as funcionalidades disponíveis.

#### Task 3.1: Criar screens/main-menu.tsx

**Arquivo**: `apps/tui/src/screens/main-menu.tsx`

**Acceptance Criteria**:
- [ ] Header com logo GAMBI (usar `LOGO_COMPACT` do core)
- [ ] Input para Hub URL (editável, default: http://localhost:3000)
- [ ] Lista de opções usando `<select>`:
  1. Serve Hub - Start a local hub server
  2. Create Room - Create a new room
  3. List Rooms - View available rooms
  4. Join Room - Join as LLM participant
  5. Monitor - Monitor room activity
- [ ] Navegação com setas + Enter
- [ ] Tecla `q` para sair
- [ ] Passar hubUrl para próximas telas via `navigate(screen, { hubUrl })`

**Dependências**: Task 2.2

---

#### Task 3.2: Atualizar index.tsx para iniciar no menu

**Arquivo**: `apps/tui/src/index.tsx`

**Acceptance Criteria**:
- [ ] Aceitar `--hub <url>` para pré-configurar URL
- [ ] Sem flags → iniciar no menu principal
- [ ] Atualizar `StartTUIOptions` para incluir novas opções

**Dependências**: Task 3.1

---

### EPIC 4: Cliente HTTP do Hub

**Título**: Implementar cliente HTTP para interações com hub

**Descrição**:
Criar hook que encapsula todas as chamadas HTTP ao hub para ser usado pelas telas.

#### Task 4.1: Criar hook use-hub-api.ts

**Arquivo**: `apps/tui/src/hooks/use-hub-api.ts`

**Acceptance Criteria**:
- [ ] Receber `hubUrl` como parâmetro
- [ ] Implementar funções (todas retornam Promise):
  - `listRooms()` → GET /rooms
  - `createRoom(name, password?)` → POST /rooms
  - `joinRoom(code, participantData)` → POST /rooms/:code/join
  - `leaveRoom(code, participantId)` → DELETE /rooms/:code/leave/:id
  - `healthCheck(code, participantId)` → POST /rooms/:code/health
  - `getParticipants(code)` → GET /rooms/:code/participants
  - `checkHub()` → GET /health
- [ ] Cada função retorna `{ data, error, loading }`
- [ ] Tratamento de erros de rede
- [ ] Usar `fetch` nativo (Bun)

**Exemplo**:
```tsx
const api = useHubApi("http://localhost:3000")

const { data: rooms, error } = await api.listRooms()
if (error) console.log("Failed:", error)
```

**Dependências**: Nenhuma

---

### EPIC 5: Tela de Listagem de Rooms

**Título**: Implementar listagem de rooms disponíveis

**Descrição**:
Criar tela que mostra rooms do hub em formato de tabela com ações.

#### Task 5.1: Criar componente Table genérico

**Arquivo**: `apps/tui/src/components/table.tsx`

**Acceptance Criteria**:
- [ ] Props: `columns`, `data`, `selectedIndex`, `onSelect`, `onAction`
- [ ] Renderizar headers com cores distintas
- [ ] Navegação com setas (up/down)
- [ ] Enter para selecionar
- [ ] Scroll automático quando muitos itens
- [ ] Highlight da linha selecionada

**Dependências**: Nenhuma

---

#### Task 5.2: Criar screens/list-rooms.tsx

**Arquivo**: `apps/tui/src/screens/list-rooms.tsx`

**Acceptance Criteria**:
- [ ] Usar `useHubApi` para buscar rooms
- [ ] Mostrar tabela com colunas: Code, Name, Participants, Created
- [ ] Loading state enquanto busca
- [ ] Error state se falhar
- [ ] Ações via keyboard:
  - Enter → detalhes da room
  - `m` → navegar para monitor dessa room
  - `j` → navegar para join dessa room
  - `r` → refresh lista
  - `←` → voltar ao menu
- [ ] Mostrar "No rooms found" se lista vazia

**Dependências**: Task 4.1, Task 5.1

---

### EPIC 6: Tela de Criação de Room

**Título**: Implementar criação de rooms na TUI

**Descrição**:
Criar tela com formulário para criar novas rooms no hub.

#### Task 6.1: Criar componente InputField padronizado

**Arquivo**: `apps/tui/src/components/input-field.tsx`

**Acceptance Criteria**:
- [ ] Props: `label`, `value`, `onChange`, `placeholder`, `required`, `type`, `error`
- [ ] Type "password" oculta caracteres com `*`
- [ ] Mostrar asterisco vermelho se `required`
- [ ] Mostrar mensagem de erro abaixo se `error`
- [ ] Usar `<input>` do OpenTUI
- [ ] Suporte a `focused` prop

**Dependências**: Nenhuma

---

#### Task 6.2: Criar componente Form genérico

**Arquivo**: `apps/tui/src/components/form.tsx`

**Acceptance Criteria**:
- [ ] Gerenciar focus entre campos filhos
- [ ] Tab/Shift+Tab para navegar campos
- [ ] Enter no último campo submete
- [ ] Prop `onSubmit` chamado com valores
- [ ] Prop `onCancel` para Escape

**Dependências**: Task 6.1

---

#### Task 6.3: Criar screens/create-room.tsx

**Arquivo**: `apps/tui/src/screens/create-room.tsx`

**Acceptance Criteria**:
- [ ] Campos:
  - Name (obrigatório)
  - Password (opcional)
- [ ] Validação: name não pode ser vazio
- [ ] Ao submeter:
  1. Chamar `api.createRoom(name, password)`
  2. Mostrar código gerado
  3. Oferecer: "Monitor this room" ou "Back to menu"
- [ ] Loading state durante criação
- [ ] Error state se falhar

**Dependências**: Task 4.1, Task 6.2

---

### EPIC 7: Tela de Join Room

**Título**: Implementar join como participante LLM

**Descrição**:
Criar tela que permite usuário entrar em uma room expondo seu endpoint LLM.

#### Task 7.1: Criar hook use-machine-specs.ts

**Arquivo**: `apps/tui/src/hooks/use-machine-specs.ts`

**Acceptance Criteria**:
- [ ] Adaptar código de `packages/cli/src/utils/specs.ts`
- [ ] Detectar: CPU, RAM (GB), GPU (se disponível), VRAM (se disponível)
- [ ] Cachear resultado após primeira detecção
- [ ] Retornar `{ specs, loading, error, refresh }`
- [ ] Funcionar em Linux, macOS, Windows

**Dependências**: Nenhuma

---

#### Task 7.2: Criar screens/join-room.tsx

**Arquivo**: `apps/tui/src/screens/join-room.tsx`

**Acceptance Criteria**:
- [ ] Campos:
  - Room Code (obrigatório, pré-preenchido se veio de listagem)
  - LLM Endpoint (default: http://localhost:11434)
  - Model (obrigatório, com auto-detect)
  - Nickname (opcional, gera automático tipo "user-a3f8")
  - Password (se room protegida)
  - Checkbox "Share machine specs"
- [ ] Mostrar specs detectadas se checkbox marcado
- [ ] Botão para detectar models do endpoint
- [ ] Ao submeter:
  1. Chamar `api.joinRoom(code, data)`
  2. Iniciar health check loop
  3. Navegar para monitor mostrando status de participante
- [ ] Validações:
  - Code não vazio
  - Model selecionado
  - Endpoint válido

**Dependências**: Task 4.1, Task 6.2, Task 7.1

---

#### Task 7.3: Implementar health check loop

**Arquivo**: `apps/tui/src/hooks/use-participant-session.ts`

**Acceptance Criteria**:
- [ ] Iniciar loop de health check a cada 10s após join
- [ ] Usar `AbortController` para cleanup
- [ ] Chamar `api.healthCheck(code, participantId)`
- [ ] Se falhar 3x seguidas, marcar como desconectado
- [ ] Expor `leave()` para sair manualmente
- [ ] Retornar `{ joined, participantId, status, leave }`

**Dependências**: Task 4.1

---

### EPIC 8: Tela de Serve Hub

**Título**: Implementar inicialização de hub server na TUI

**Descrição**:
Criar tela que permite iniciar um hub server diretamente da TUI.

#### Task 8.1: Criar hook use-hub-server.ts

**Arquivo**: `apps/tui/src/hooks/use-hub-server.ts`

**Acceptance Criteria**:
- [ ] Wrapper para `createHub()` de `@gambi/core/hub`
- [ ] Funções: `start(options)`, `stop()`
- [ ] Estado: `running`, `url`, `mdnsName`, `error`
- [ ] Cleanup automático quando componente desmonta
- [ ] Retornar `{ running, url, mdnsName, start, stop, error }`

**Dependências**: Nenhuma

---

#### Task 8.2: Criar screens/serve-hub.tsx

**Arquivo**: `apps/tui/src/screens/serve-hub.tsx`

**Acceptance Criteria**:
- [ ] Campos (editáveis apenas quando parado):
  - Port (default: 3000)
  - Host (default: 0.0.0.0)
  - Toggle mDNS (default: off)
- [ ] Botão Start/Stop toggle
- [ ] Quando rodando, mostrar:
  - Status: ● Running (verde)
  - URL: http://host:port
  - Health: http://host:port/health
  - mDNS Service: gambi-{port} (se ativo)
- [ ] Quando parado:
  - Status: ○ Stopped (cinza)
- [ ] Warning ao sair: "Hub will stop when you leave this screen"
- [ ] Keyboard: Enter para toggle start/stop

**Dependências**: Task 8.1, Task 6.1

---

### EPIC 9: Refatorar Monitor

**Título**: Integrar monitor existente no novo sistema

**Descrição**:
Mover lógica atual do dashboard para nova estrutura de telas.

#### Task 9.1: Criar screens/monitor.tsx

**Arquivo**: `apps/tui/src/screens/monitor.tsx`

**Acceptance Criteria**:
- [ ] Mover componentes de `app.tsx` atual para esta tela
- [ ] Receber `roomCodes` via params de navegação
- [ ] Se nenhum room code, mostrar RoomSelector
- [ ] Manter toda funcionalidade atual:
  - Multi-room tabs
  - Participant list
  - Activity log
  - Real-time SSE updates
- [ ] Adicionar ação `a` para adicionar room (já existe)
- [ ] Adicionar ação `c` para criar room (navegar para create)

**Dependências**: Task 2.2

---

#### Task 9.2: Mostrar status de participante no monitor

**Arquivo**: `apps/tui/src/screens/monitor.tsx`

**Acceptance Criteria**:
- [ ] Se usuário está joined em uma room, mostrar badge no header
- [ ] Destacar próprio participante na lista com ícone ◉
- [ ] Mostrar botão/ação `l` para leave se está joined
- [ ] Integrar com `useParticipantSession`

**Dependências**: Task 7.3, Task 9.1

---

### EPIC 10: Integração CLI

**Título**: Fazer gambi sem subcomando abrir TUI

**Descrição**:
Modificar CLI para que `gambi` abra a TUI por padrão.

#### Task 10.1: Modificar cli.ts para default TUI

**Arquivo**: `packages/cli/src/cli.ts`

**Acceptance Criteria**:
- [ ] Sem subcomando → chamar `startTUI({})`
- [ ] Remover comando `monitor` (agora é via TUI)
- [ ] `gambi serve/create/join/list` → mantém CLI
- [ ] Detectar se é TTY, se não for, mostrar help

**Dependências**: Task 3.2

---

### EPIC 11: Polish e UX (P1 - Pode ser feito depois)

**Título**: Melhorias de experiência do usuário

#### Task 11.1: Confirmações antes de sair

- Confirmar quit se serve hub ativo
- Confirmar leave se joined em room

#### Task 11.2: Persistência de preferências

- Salvar último hub URL usado
- Salvar último endpoint LLM
- Usar arquivo `~/.gambi/config.json`

---

## Ordem de Execução

```
1. Epic 1 (Doc)           ──┐
                            ├── Paralelo
2. Epic 4.1 (Hub API)     ──┘
        │
        ▼
3. Epic 2 (Navegação)     ── Sequencial: 2.1 → 2.2 → 2.3
        │
        ▼
4. Epic 3 (Menu)          ── Sequencial: 3.1 → 3.2
        │
        ▼
5. Epic 5 (List)          ── Sequencial: 5.1 → 5.2
        │
        ├── 6. Epic 6 (Create)   ── 6.1 → 6.2 → 6.3
        │
        ├── 7. Epic 7 (Join)     ── 7.1 → 7.2 → 7.3
        │
        └── 8. Epic 8 (Serve)    ── 8.1 → 8.2
                │
                ▼
        9. Epic 9 (Monitor)      ── 9.1 → 9.2
                │
                ▼
        10. Epic 10 (CLI)
                │
                ▼
        11. Epic 11 (Polish)
```

---

## Arquivos a Criar

| Arquivo | Epic |
|---------|------|
| `apps/tui/src/hooks/use-navigation.ts` | 2 |
| `apps/tui/src/hooks/use-hub-api.ts` | 4 |
| `apps/tui/src/hooks/use-machine-specs.ts` | 7 |
| `apps/tui/src/hooks/use-participant-session.ts` | 7 |
| `apps/tui/src/hooks/use-hub-server.ts` | 8 |
| `apps/tui/src/screens/main-menu.tsx` | 3 |
| `apps/tui/src/screens/list-rooms.tsx` | 5 |
| `apps/tui/src/screens/create-room.tsx` | 6 |
| `apps/tui/src/screens/join-room.tsx` | 7 |
| `apps/tui/src/screens/serve-hub.tsx` | 8 |
| `apps/tui/src/screens/monitor.tsx` | 9 |
| `apps/tui/src/components/input-field.tsx` | 6 |
| `apps/tui/src/components/form.tsx` | 6 |
| `apps/tui/src/components/table.tsx` | 5 |

## Arquivos a Modificar

| Arquivo | Epic |
|---------|------|
| `docs/architecture.md` | 1 |
| `apps/tui/src/index.tsx` | 3 |
| `apps/tui/src/app.tsx` | 2, 9 |
| `apps/tui/src/components/footer.tsx` | 2 |
| `packages/cli/src/cli.ts` | 10 |

---

## Verificação

### Smoke Test Manual

```bash
# 1. Sem subcomando abre TUI
gambi
# → Deve abrir menu principal

# 2. Serve Hub
# Selecionar "Serve Hub" → Start
# → Hub deve iniciar na porta 3000

# 3. Create Room (outro terminal)
gambi
# Selecionar "Create Room" → Nome: "Test" → Create
# → Deve mostrar código gerado

# 4. List Rooms
# Selecionar "List Rooms"
# → Deve mostrar room criada

# 5. Join Room (outro terminal)
gambi
# Selecionar "Join Room" → Código → Endpoint → Model
# → Deve entrar e manter health check

# 6. Monitor
# Selecionar "Monitor" → Selecionar room
# → Deve mostrar participante ativo
# → Eventos devem aparecer em tempo real
```

---

## Comandos Beads para Criação

**IMPORTANTE**: Sempre usar `-d` ou `--description` para adicionar descrição detalhada às issues. A description deve conter:
- Contexto e objetivo da task
- Acceptance criteria
- Arquivos envolvidos
- Dependências (se houver)

```bash
# Epic principal
bd create "TUI Full Client: Implementar todas funcionalidades do core" -t epic -p 1 \
  -d "Transformar a TUI de ferramenta de monitoramento para cliente completo do Gambi.
A TUI será o ponto de entrada padrão (gambi sem subcomando).

Acceptance Criteria:
- Menu principal com todas as opções
- Telas: Serve Hub, Create Room, List Rooms, Join Room, Monitor
- Navegação entre telas com histórico
- gambi sem subcomando abre TUI"

# Epic 1 - Doc
bd create "Documentar filosofia de paridade de features" -t epic --parent <main-epic> \
  -d "Registrar no docs/architecture.md a filosofia de que todas as pontas (SDK, CLI, TUI)
devem implementar todas as funcionalidades do core."

bd create "Adicionar seção Design Philosophy em architecture.md" --parent <epic-1> \
  -d "Arquivo: docs/architecture.md

Acceptance Criteria:
- Nova seção 'Design Philosophy' após 'Overview'
- Explicar paridade de features entre SDK, CLI e TUI
- Descrever papel de cada ponta
- Mencionar que gambi sem subcomando abre TUI"

# Epic 2 - Navegação
bd create "Sistema de navegação entre telas" -t epic --parent <main-epic> \
  -d "Criar infraestrutura de navegação com state machine, histórico e passagem de parâmetros."

bd create "Criar hook use-navigation.ts" --parent <epic-2> \
  -d "Arquivo: apps/tui/src/hooks/use-navigation.ts

Acceptance Criteria:
- Tipo Screen: menu | serve | create | list | join | monitor
- Estado: currentScreen, screenParams, history
- Funções: navigate(screen, params?), goBack(), canGoBack()
- Histórico limitado a 10 itens"

bd create "Refatorar app.tsx para usar router" --parent <epic-2> \
  -d "Arquivo: apps/tui/src/app.tsx

Acceptance Criteria:
- Remover lógica atual de screen state
- Usar useNavigation() hook
- Renderizar componente baseado em screen
- Passar params para cada tela

Depende de: task use-navigation.ts"

bd create "Criar Footer dinâmico" --parent <epic-2> \
  -d "Arquivo: apps/tui/src/components/footer.tsx

Acceptance Criteria:
- Prop shortcuts: Array<{key, label}>
- Sempre incluir [q] Quit
- [←] Back quando canGoBack()
- Manter design visual atual

Depende de: task refatorar app.tsx"

bd dep add <task-2.2> <task-2.1>
bd dep add <task-2.3> <task-2.2>

# ... continuar para demais épicos com descrições detalhadas
```

---

## Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Serve Hub bloqueia processo | Médio | Aceitar limitação - hub fecha com TUI |
| Detecção de specs falha | Baixo | Fallback para valores vazios |
| SSE + Join simultâneos | Médio | State machine clara no useParticipantSession |
