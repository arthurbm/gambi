# Gambi board

`@gambi/board` is the local event server. `@gambi/board-web` is its TanStack Router client. The server owns the lobby, squads, phases, audit log, and SQLite recovery. It listens on `0.0.0.0:3001`; Vite listens on `0.0.0.0:3002` and proxies `/rpc`, `/events`, and `/api-reference` to the server.

## Run it

From the repository root:

```bash
bun install
bun run dev
```

The default admin URL is `http://localhost:3002/admin?token=gambi-local-admin`. Set `BOARD_ADMIN_TOKEN` before an event. The browser stores this token in session storage and removes it from the visible URL. SQLite data lives at `apps/board/data/board.db` by default.

Useful checks:

```bash
bun run --cwd apps/board check-types
bun test apps/board/src
bun run --cwd apps/board-web check-types
bun run --cwd apps/board-web build
BOARD_DATABASE_URL=:memory: bun run --cwd apps/board db:migrate
```

## Better-T-Stack provenance

The source scaffold came from Better-T-Stack 3.40.2. It was generated outside this checkout with analytics disabled and dependencies left uninstalled:

```bash
BTS_TELEMETRY_DISABLED=1 bunx create-better-t-stack@3.40.2 create-json --json '{
  "projectName": "/tmp/gambi-bts-issue73-scaffold",
  "frontend": ["tanstack-router"],
  "backend": "hono",
  "runtime": "bun",
  "database": "sqlite",
  "orm": "drizzle",
  "api": "orpc",
  "auth": "none",
  "payments": "none",
  "addons": ["ultracite"],
  "addonOptions": {
    "ultracite": {
      "linter": "biome",
      "editors": [],
      "agents": [],
      "hooks": []
    }
  },
  "examples": ["none"],
  "dbSetup": "none",
  "webDeploy": "none",
  "serverDeploy": "none",
  "packageManager": "bun",
  "git": false,
  "install": false,
  "directoryConflict": "error",
  "renderTitle": false,
  "disableAnalytics": true,
  "manualDb": true,
  "verbose": true
}'
```

The generated layout had `apps/server`, `apps/web`, `packages/api`, `packages/db`, `packages/env`, and `packages/ui`. The transplant flattened it as follows:

| Generated path | Gambi path |
| --- | --- |
| `apps/server` | `apps/board` |
| `apps/web` | `apps/board-web` |
| `packages/api/src` | `apps/board/src/orpc` |
| `packages/db/src/schema` | `apps/board/src/db/schema` |
| `packages/ui/src/components` | `apps/board-web/src/components/ui` |
| `packages/ui/src/lib/utils.ts` | `apps/board-web/src/lib/utils.ts` |

The generated root package, catalog, config package, environment packages, lockfile, and Biome config were not copied. Gambi keeps its existing Bun workspace, `@gambi/config`, TypeScript 5, Ultracite 7.0.7, Biome 2.3.11, and root lockfile.

Package names changed to `@gambi/board` and `@gambi/board-web`. Every transplanted dependency uses a literal version instead of `catalog:` or a range. The main runtime versions are Hono 4.12.32, oRPC 1.14.12, Drizzle ORM 0.45.2, `@libsql/client` 0.17.4, React 19.2.8, TanStack Router 1.170.18, Vite 8.1.5, Tailwind 4.3.3, and TypeScript 5.9.3.

The released scaffold returned a newly constructed Hono response for oRPC and OpenAPI handlers. That mixes Node and Bun stream types under TypeScript 5. This transplant returns the handler's existing `Response` instead.

## Persistence rules

The committed migration creates `board_config`, `people`, `squads`, `memberships`, `rounds`, and `events`. Startup runs the migration, creates the singleton configuration, seeds six stable round records, and makes configured squad rows active. Queries rebuild the board view directly from SQLite. The audit table is append-only; each mutation writes its state change and audit record in one transaction, then publishes an SSE invalidation after commit.

Rounds 3 and 5 are skippable. Admin configuration locks after the lobby. Reducing the squad count also fails while a squad being removed still has members. These rules prevent an operator from hiding active membership or changing the event shape midway through a round.

`hostedHarnessCount` is persisted but does not spawn processes here. Harness spawning, assignment, steerer rotation, `/squad/:id`, and harness streams belong to issue #74.

## shadcn choice

`apps/board-web/components.json` records the `base-lyra` preset with Base UI and Lucide icons. Its square controls and compact type match the approved cadastral field-book comp. The board's semantic CSS tokens supply the survey-paper palette instead of accepting the generator's neutral theme. The UI uses the checked-in component source, so it does not require a runtime registry connection.
