# Agent Commands and Validation

Full command reference for the `gambi` monorepo plus the validation matrix agents should run after touching each area.

## Root scripts

```bash
bun install                          # install workspaces
bun run dev                          # hub (alias: dev:hub)
bun run dev:cli -- --help            # CLI entrypoint with any subcommand
bun run dev:tui                      # apps/tui (alias: dev:monitor)
bun run dev:docs                     # Astro Starlight docs site
bun run build                        # turbo build
bun run check-types                  # turbo check-types across the monorepo
bun x ultracite check                # lint
bun x ultracite fix                  # auto-fix
```

Notes:

- `bun run dev` and `bun run dev:hub` both invoke `gambi hub serve`.
- `bun run dev:monitor` is an alias for the TUI; there is no flat `monitor` subcommand on the CLI.
- Do not reintroduce root scripts that wrap removed flat commands (`serve`, `create`, `join`, `list`, `update`, `monitor`) without a resource namespace. The agent-first redesign deliberately enforces resource-oriented subcommands.

## Workspace-scoped commands

```bash
# Core
bun run --cwd packages/core check-types

# CLI
bun run --cwd packages/cli dev
bun run --cwd packages/cli dev -- --help
bun run --cwd packages/cli build
bun run --cwd packages/cli check-types

# SDK
bun run --cwd packages/sdk build
bun run --cwd packages/sdk check-types

# TUI
bun run --cwd apps/tui dev
bun run --cwd apps/tui build
bun run --cwd apps/tui test

# Docs
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
```

## Validation matrix

Run this after touching each area:

| Area touched | Validation |
|---|---|
| `packages/core` | `bun test packages/core/src` and `bun run --cwd packages/core check-types` |
| `packages/cli` | run the affected subcommand, validate `--help`, `bun run --cwd packages/cli check-types`. If you touched distribution or build, also `bun run --cwd packages/cli build`. |
| `packages/sdk` | `bun test packages/sdk/src` and `bun run --cwd packages/sdk check-types` |
| SDK discovery helpers | review `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/architecture.md` |
| `apps/tui` | `bun run --cwd apps/tui test` |
| HTTP contracts or public types | quick test of affected endpoint(s); see `docs/agents/docs-update.md` for required doc updates |
| Tunnel protocol | `bun test packages/core/src` (tunnel tests); see `docs/agents/docs-update.md` |
| Distribution / release | `bun run --cwd packages/cli check-types`, `bun run --cwd packages/cli build`, `npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi`, `node ./packages/cli/dist/npm/gambi/bin/gambi --version` |

## Quick validation set

```bash
bun run check-types
bun run --cwd apps/tui test
```

## Targeted test runs

```bash
bun test packages/core/src
bun test packages/sdk/src
bun run --cwd apps/tui test
```

## Environment notes

- Tests in `core` and `sdk` start a hub on fixed ports (e.g., 3998 / 3999) and may fail if the port is busy. Report this as an environmental failure, not a product failure.
- `packages/core/src/endpoint-capabilities.test.ts` has a historically-flaky test (`probeEndpoint > does not detect protected endpoints without auth headers`). Pre-existing; not introduced by recent work.
- No Docker, database, or external service is required — all state is in-memory.
