# TUI - Terminal User Interface

Interactive terminal interface for Gambi using OpenTUI (React reconciler for terminal).

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | OpenTUI (`@opentui/react`) | React-based terminal rendering |
| Hub access | `createClient` from `gambi-sdk` | Rooms, participants and room events, derived from the management contract |
| Server State | TanStack Query | Calls of the client, caching, background refetch |
| Client State | Zustand | Navigation, session, hub URL |
| Real-time | `client.events.watch` | Live room updates |
| Hosting | `createHub` from `gambi-sdk/hub`, `createParticipantSession` from `gambi-sdk/participant` | The hub and the participant runtime the TUI runs in its own process |
| Validation | Zod | Local form validation only |

## Directory Structure

```
src/
├── index.tsx           # Entry point, QueryClient setup, quit
├── app.tsx             # Screen router, global keyboard handlers
├── types.ts            # Hub types re-exported from gambi-sdk, design tokens
├── hub-client.ts       # hubClient(hubUrl): the one way to reach a hub
├── rooms/
│   ├── room-state.ts   # applyRoomEvent: what each room event changes
│   └── watch-rooms.ts  # watchRooms: watched rooms, with reconnection
├── session/
│   └── participant-session.ts  # join, follow the runtime, leave
├── screens/            # Full-page views
├── components/         # Reusable UI pieces
├── hooks/              # Thin React wrappers over the modules above
│   └── queries/        # TanStack Query hooks
└── store/
    ├── app-store.ts
    ├── hub-store.ts
    └── session-store.ts
```

## Talking to a hub

Read the section "The TUI" of [`docs/reference/effect-conventions.md`](../../docs/reference/effect-conventions.md) first.

- Every call to a hub goes through `hubClient(hubUrl)` (`src/hub-client.ts`), the management client of `gambi-sdk`. Never call `fetch` on a hub, never read an event stream by hand, never declare the shape of a hub answer: the types come from `gambi-sdk` (re-exported in `types.ts`).
- The hub and the participant the TUI hosts come from the hosting entries of `gambi-sdk` (`gambi-sdk/hub` in `store/hub-store.ts`, `gambi-sdk/participant` in `session/participant-session.ts` and in the endpoint test). No file of the TUI imports `effect` or `@gambi/core` outside its tests.
- A form leaves an empty optional field as `undefined`. The client and the hosting entries take that for a field not given, so the forms pass their data as it is.
- A participant has one status, `online`, `busy` or `offline`, and the hub is its only source. Do not derive it from anything else (there is no heartbeat and no `connection` field).
- React stays out of the logic. `watchRooms`, `joinAsParticipant` and the hub store are plain modules; the hooks only subscribe to them. That is what lets the tests run them against a real hub.

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
| Hub client, room events | Não precisa |
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

**Quando usar:** API data (rooms, the health of the hosted hub, machine specs).

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

## Room events

`watchRooms` (`src/rooms/watch-rooms.ts`) keeps each watched room up to date from `client.events.watch(roomCode)`. When the stream of a room ends, whether it failed or just ended (the hub closed), the room shows as not connected and is watched again after 3 seconds. The `room.snapshot` that opens every stream replaces what was known, so nothing has to be fetched first.

`applyRoomEvent` (`src/rooms/room-state.ts`) is a pure function and the only place that reads a room event. Its `switch` is exhaustive over `RoomEvent`: a new event of the contract stops it from compiling.

| Event | What it changes |
|-------|-----------------|
| `room.snapshot` | Replaces the room's name and participants; marks it connected |
| `participant.joined` | Adds the participant (`offline`); logs "joined" |
| `participant.updated` | Replaces the participant |
| `participant.online` | Replaces the participant; logs "online" when it was `offline` |
| `participant.busy` | Replaces the participant |
| `participant.offline` | Replaces the participant; logs "offline" |
| `participant.removed` | Removes the participant; logs "left" or "removed (did not reconnect)" |
| `llm.request` | Marks the participant as answering; logs the request |
| `llm.complete` | Unmarks it; logs the metrics |
| `llm.error` | Unmarks it; logs the error |

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

```bash
bun run --cwd apps/tui test   # from the repo root, as CI runs it
```

The tests run the plain modules against a real hub on a free port (`layerHub` from `@gambi/core/testing/hub`), with a real participant runtime and a fake provider. They never replace `fetch`. See "A hub in a test" in `docs/reference/effect-conventions.md`.

| File | Covers |
|------|--------|
| `rooms/watch-rooms.test.ts` | Watched rooms against a real hub: statuses, requests, reconnection |
| `rooms/room-state.test.ts` | `applyRoomEvent`, one event at a time |
| `store/hub-store.test.ts` | The hub the TUI hosts: start, stop, a port in use |
| `session/participant-session.test.ts` | Join, leave, a hub that goes away, a replaced session, a participant taken out of the room |
| `hub-client.test.ts` | The client per hub; a form with empty optional fields |
| `components/participant-card.test.tsx` | What a participant card shows, rendered with `testRender` |
| `store/session-store.test.ts`, `types.test.ts` | State transitions, local schemas |

A test waits for what it expects to show (`shown(...)` subscribes to the store or the watcher), never for a duration.

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

### Quitting

`index.tsx` unmounts the React tree before it destroys the renderer. A state update that is still pending when the renderer is destroyed is rendered into it and aborts the process ("Nodes with measure functions cannot have children", exit code 1). Unmounting is also what stops the watched rooms, which would keep the process alive. Do not call `renderer.destroy()` from a component.

### `tsc` and `dist/`

`tsconfig.json` excludes `dist/`: the built bundle is JavaScript and embeds Effect, and the compiler overflows its stack on it.

### Input `onChange`

An OpenTUI `<input>` does not call `onChange` on each key. Seen in the running TUI: what was typed reaches the form's state once the field loses focus (Tab), and Enter pressed straight after typing submits the value from before.

### Keyboard Handler Cleanup

`useKeyboard` do OpenTUI faz cleanup automático. Não adicione cleanup manual.

---

## Linting & Formatting

**IMPORTANTE**: Ultracite só funciona quando executado da **raiz do monorepo**.

**WORKFLOW**: Rode `ultracite check` e `ultracite fix` apenas ao **final de cada EPIC**, não após cada task individual. Isso evita interrupções frequentes durante o desenvolvimento.

```bash
# Da raiz do monorepo (OBRIGATÓRIO)
cd /path/to/gambi
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
bun run --filter @gambi/cli serve
```
