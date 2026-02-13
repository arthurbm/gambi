# TUI - Terminal User Interface

Interactive terminal interface for Gambiarra using OpenTUI (React reconciler for terminal).

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | OpenTUI (`@opentui/react`) | React-based terminal rendering |
| Server State | TanStack Query | API calls, caching, background refetch |
| Client State | Zustand | Navigation, session, hub URL |
| Real-time | SSE (Server-Sent Events) | Live room updates |
| Validation | Zod | API responses, SSE events |

## Directory Structure

```
src/
├── index.tsx           # Entry point, QueryClient setup
├── app.tsx             # Screen router, global keyboard handlers
├── types.ts            # Zod schemas, design tokens (colors, icons)
├── screens/            # Full-page views
│   ├── main-menu.tsx
│   ├── create-room.tsx
│   ├── join-room.tsx
│   ├── list-rooms.tsx
│   ├── monitor.tsx
│   └── serve-hub.tsx
├── components/         # Reusable UI pieces
│   ├── footer.tsx
│   ├── form.tsx        # useFormFocus hook
│   ├── input-field.tsx
│   ├── table.tsx
│   └── ...
├── hooks/
│   ├── use-navigation.ts
│   ├── use-hub-api.ts
│   ├── use-sse.ts
│   ├── use-rooms.ts
│   ├── use-participant-session.ts
│   └── queries/        # TanStack Query hooks
└── store/
    ├── app-store.ts
    └── session-store.ts
```

---

## OpenTUI Skill

> **IMPORTANTE**: Ao trabalhar com componentes OpenTUI no Claude Code, **sempre use a skill via integração** (`/opentui`) ao invés de ler os arquivos da skill diretamente.

### Invocação

```
/opentui [descrição da tarefa]
```

**Exemplos:**
- `/opentui criar um select com keyboard navigation`
- `/opentui debugar problema de layout flexbox`
- `/opentui como fazer animação de loading`
- `/opentui input não está recebendo foco`

### Por que usar via integração?

1. **Carrega contexto automaticamente** - Não precisa ler múltiplos arquivos
2. **Decision trees integrados** - O skill guia para a referência correta
3. **Menos tokens** - Evita carregar documentação desnecessária
4. **Sempre atualizado** - Usa a versão mais recente da skill

### Quando Usar

| Situação | Usar Skill? |
|----------|-------------|
| Criar novo componente UI | `/opentui` |
| Layout não funcionando | `/opentui` |
| Keyboard events | `/opentui` |
| Animações | `/opentui` |
| SSE/API logic | Não precisa |
| State management | Não precisa |
| Navigation | Não precisa (ver seção abaixo) |

### Decision Trees

O skill inclui decision trees para:
- **"I need user input"** → input, textarea, select, tab-select
- **"I need layout"** → flexbox patterns, centering, responsive
- **"I need to debug"** → gotchas comuns, terminal cleanup

### Referências Carregadas

O skill carrega automaticamente quando invocado:
- `references/react/api.md` - Componentes e hooks
- `references/react/gotchas.md` - Problemas comuns
- `references/components/*.md` - Documentação de componentes

---

## State Management

### Server State (TanStack Query)

Data que vive no servidor. Query hooks cuidam de caching, background refetch e loading states.

```typescript
// hooks/queries/use-rooms-query.ts
const { data, isLoading, error, refetch } = useListRoomsQuery();
```

**Quando usar:** API data (rooms, participants, health checks, machine specs).

### Client State (Zustand)

Estado apenas da UI, não precisa sincronizar com servidor.

```typescript
// store/app-store.ts
const hubUrl = useAppStore((s) => s.hubUrl);
const setHubUrl = useAppStore((s) => s.setHubUrl);
```

**Quando usar:** Hub URL, navigation history, session status.

### Local State (useState)

Estado específico do componente.

**Quando usar:** Form inputs, focus index, toggles.

---

## Navigation

Screen-based routing via `useNavigation` hook. Mantém history stack para back navigation.

```typescript
const { screen, params, navigate, goBack, canGoBack } = useNavigation({
  initialScreen: "menu",
});

// Navegar com params tipados
navigate("join", { roomCode: "ABC123" });
navigate("monitor", { roomCodes: ["ABC123", "XYZ789"] });
```

### Adicionar Nova Screen

1. Adicionar nome em `Screen` type em `use-navigation.ts`
2. Adicionar interface de params em `ScreenParams`
3. Criar componente em `screens/`
4. Adicionar routing case em `app.tsx`

---

## Component Patterns

### Screen Layout

Toda screen segue esta estrutura:

```tsx
export function MyScreen({ onNavigate, onBack, canGoBack }: Props) {
  useKeyboard((key) => {
    if (key.name === "escape") onBack();
    // ... screen-specific keys
  }, { release: false });

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <box padding={1}>
        <text fg={colors.primary}>Screen Title</text>
      </box>

      {/* Content */}
      <box flexDirection="column" flexGrow={1} padding={2}>
        {/* ... */}
      </box>

      {/* Footer */}
      <Footer
        canGoBack={canGoBack}
        shortcuts={[{ key: "Enter", description: "Submit" }]}
      />
    </box>
  );
}
```

### Form Focus Management

Use `useFormFocus` hook ou state manual:

```tsx
const [focusedField, setFocusedField] = useState(0);
const totalFields = 4;

useKeyboard((key) => {
  if (key.name === "tab") {
    if (key.shift) {
      setFocusedField((i) => (i - 1 + totalFields) % totalFields);
    } else {
      setFocusedField((i) => (i + 1) % totalFields);
    }
  }
}, { release: false });

<input focused={focusedField === 0} ... />
<input focused={focusedField === 1} ... />
```

### Keyboard Handling

Sempre use `{ release: false }` para handler apenas keydown:

```typescript
useKeyboard((key) => {
  // key.name: "return", "escape", "tab", "up", "down", etc.
  // key.shift: boolean para Shift+key combos
}, { release: false });
```

---

## SSE Event Handling

Updates real-time via pure event handler functions em `use-rooms.ts`.

```typescript
// Pure function pattern - fácil de testar
export function handleParticipantJoinedEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSEParticipantJoinedEvent.safeParse(data);
  if (!parsed.success) return { room };

  const newParticipants = new Map(room.participants);
  newParticipants.set(parsed.data.id, parsed.data);

  return {
    room: { ...room, participants: newParticipants },
    log: { type: "join", participantId: parsed.data.id, ... },
  };
}
```

### SSE Events

| Event | Handler | Description |
|-------|---------|-------------|
| `connected` | `handleConnectedEvent` | SSE connection established |
| `room:created` | `handleRoomCreatedEvent` | Room name updated |
| `participant:joined` | `handleParticipantJoinedEvent` | New participant |
| `participant:left` | `handleParticipantLeftEvent` | Participant removed |
| `participant:offline` | `handleParticipantOfflineEvent` | Heartbeat timeout |
| `llm:request` | `handleLlmRequestEvent` | LLM request started |
| `llm:complete` | `handleLlmCompleteEvent` | LLM request finished |
| `llm:error` | `handleLlmErrorEvent` | LLM request failed |

---

## Design Tokens

Use colors e icons de `types.ts`:

```typescript
import { colors, statusIndicators } from "../types";

<text fg={colors.primary}>Header</text>
<text fg={colors.success}>{statusIndicators.online} Online</text>
```

### Colors

| Name | Hex | Usage |
|------|-----|-------|
| `primary` | `#00FFFF` | Headers, focus, interactive |
| `success` | `#00FF00` | Online, joins, success |
| `warning` | `#FFAA00` | Busy, processing |
| `error` | `#FF5555` | Offline, errors |
| `muted` | `#666666` | Secondary text |
| `metrics` | `#FF79C6` | Performance numbers |
| `surface` | `#333333` | Selected item background |

### Status Indicators

| Name | Icon | Usage |
|------|------|-------|
| `online` | `●` | Participant online |
| `busy` | `◐` | Processing request |
| `offline` | `○` | Participant offline |
| `complete` | `✓` | Request completed |
| `error` | `✗` | Request failed |

---

## Testing

Testes focam em pure functions extraídas dos hooks. Sem testes de renderização de componentes.

```bash
bun test                    # Rodar todos os testes
bun test use-rooms          # Rodar arquivo específico
```

### Test Files

- `use-sse.test.ts` - SSE buffer parsing
- `use-rooms.test.ts` - Event handler logic
- `use-hub-api.test.ts` - API validation (fetchJson)
- `types.test.ts` - Zod schema validation
- `session-store.test.ts` - State transitions

### Test Factories

Em `__tests__/factories.ts`:

```typescript
import { createRoom, createParticipant } from "../__tests__/factories";

const room = createRoom({ connected: true });
const participant = createParticipant("p1", "Bot1", { status: "busy" });
```

---

## Gotchas

### Stale Closures em useCallback

Ao verificar state após operação async, o valor capturado pode estar desatualizado:

```typescript
// ERRADO - session.status é capturado, não atualiza após await
const handleJoin = useCallback(async () => {
  await session.join(...);
  if (session.status === "joined") { ... } // Sempre stale!
}, [session]);

// CERTO - retornar sucesso da função async
const handleJoin = useCallback(async () => {
  const success = await session.join(...);
  if (success) { ... }
}, [session]);
```

### Password Masking

Use o valor mascarado para display:

```typescript
const displayValue = type === "password" ? "•".repeat(value.length) : value;
<input value={displayValue} ... />
```

### React Keys em Tables

Nunca use array index como key fallback. Gere keys estáveis do conteúdo:

```typescript
const getRowKey = (item: T, index: number): string => {
  if (item.id) return item.id;
  return columns.slice(0, 3).map(col => getCellValue(item, col)).join("-");
};
```

### Keyboard Handler Cleanup

`useKeyboard` do OpenTUI faz cleanup automático. Não adicione cleanup manual.

---

## Linting & Formatting

**IMPORTANTE**: Ultracite só funciona quando executado da **raiz do monorepo**.

**WORKFLOW**: Rode `ultracite check` e `ultracite fix` apenas ao **final de cada EPIC**, não após cada task individual. Isso evita interrupções frequentes durante o desenvolvimento.

```bash
# Da raiz do monorepo (OBRIGATÓRIO)
cd /path/to/gambiarra
bun x ultracite check    # Verificar problemas
bun x ultracite fix      # Corrigir automaticamente

# Type checking
bun run check-types      # Roda em todos os packages
```

---

## Running Locally

```bash
# Da raiz do monorepo
bun run --filter tui dev

# Ou de apps/tui
bun run dev
```

A TUI conecta em `http://localhost:3000` por padrão. Inicie um hub primeiro:

```bash
bun run --filter @gambiarra/cli serve
```
