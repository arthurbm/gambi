# Validation Matrix

What to run after touching each area of the monorepo, plus the known test gotchas.

For the day-to-day command set (install, dev, build, check-types, lint), see the root `AGENTS.md`. Per-workspace scripts live in each `package.json`.

## Matrix

| Area touched | Validation |
|---|---|
| `packages/core` | `bun test packages/core/src` and `bun run --cwd packages/core check-types` |
| `packages/cli` | run the affected subcommand, validate `--help`, `bun run --cwd packages/cli check-types`. If you touched distribution or build, also `bun run --cwd packages/cli build`. |
| `packages/sdk` | `bun test packages/sdk/src` and `bun run --cwd packages/sdk check-types` |
| SDK discovery helpers | review `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/reference/architecture.md` |
| `apps/tui` | `bun run --cwd apps/tui test` |
| HTTP contracts or public types | quick test of affected endpoint(s); see `docs/reference/docs-update.md` for required doc updates |
| Tunnel protocol | `bun test packages/core/src` (tunnel tests); see `docs/reference/docs-update.md` |
| Distribution / release | `bun run --cwd packages/cli check-types`, `bun run --cwd packages/cli build`, `npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi`, `node ./packages/cli/dist/npm/gambi/bin/gambi --version` |

## Quick validation set

```bash
bun run check-types
bun run --cwd apps/tui test
```

## Environment notes

- Tests in `core` and `sdk` start a hub on fixed ports (e.g., 3998 / 3999) and may fail if the port is busy. Report this as an environmental failure, not a product failure.
- `packages/core/src/endpoint-capabilities.test.ts` has a historically-flaky test (`probeEndpoint > does not detect protected endpoints without auth headers`). Pre-existing; not introduced by recent work.
- No Docker, database, or external service is required — all state is in-memory.
