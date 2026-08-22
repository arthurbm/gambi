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
| Harness participant runtime | `bun test packages/core/src/harness-participant-session.test.ts`, then the OpenCode smoke below |
| `@gambi/agents` | `bun test packages/agents/src`, `bun run --cwd packages/agents check-types`, then the tunnel demo below |
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

## Harness participant smoke

The automated test starts the deterministic fake ACP process, negotiates ACP
v1, prompts it through a real hub attach socket, observes its file write, and
checks the artifact snapshot. It does not call a model:

```bash
bun test packages/core/src/harness-participant-session.test.ts
```

Run this once with a logged-in OpenCode before an event release:

```bash
opencode auth list --pure
bun run dev:cli -- join \
  --room <ROOM_CODE> \
  --participant-id opencode-smoke \
  --name "OpenCode smoke" \
  --harness opencode \
  --model <MODEL_LABEL> \
  --format ndjson
```

Check these facts before pressing Ctrl+C:

1. Output contains `registered`, `tunnel_connected`, `harness_spawned`, and `session_opened`.
2. `~/.gambi/workspaces/<ROOM_CODE>/opencode-smoke/` contains the starter files.
3. An attached harness client can send `session/prompt` and receive ACP updates.
4. Editing `README.md` produces `artifact_sent` after about one second.
5. Ctrl+C produces `harness_exited` and `left`, and no `opencode acp` child remains.

Do not copy authentication output into the ticket. Record only the adapter,
model label, operating system, command exit code, and which checks passed.

## Harness dispatch demo

This command starts a real hub and two deterministic fake ACP processes. It
dispatches decided challenges through `client.harness.attach()`, records one
accept and one return, verifies the return stays in the same harness session,
and waits for the resulting second artifact version:

```bash
bun run --cwd packages/agents demo
```

The final NDJSON object has `status: "complete"`, the room code, both dispatch
ids, and the returned session id. No model is called. To smoke the optional
inference-plane model injection, first share a model participant in an existing
room and run:

```bash
bun run --cwd packages/agents demo -- \
  --hub-url http://localhost:3000 \
  --room <ROOM_CODE> \
  --model <MODEL_NAME>
```
