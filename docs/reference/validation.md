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
| Harness participant runtime | `bun test packages/core/src/harness-adapters.test.ts packages/core/src/harness-participant-session.test.ts`, then the installed-adapter smokes below |
| `@gambi/agents` | `bun test packages/agents/src`, `bun run --cwd packages/agents check-types`, then the tunnel demo below |
| `apps/board` | `bun test apps/board/src`, `bun run --cwd apps/board check-types`, then the event board rehearsal below |
| `apps/board-web` | `bun run --cwd apps/board-web check-types`, `bun run --cwd apps/board-web build`, then desktop and mobile browser checks |
| Event supervisor | `bun test scripts/event.test.ts`, `bun run board:e2e`, one `SIGUSR1` board restart, then one Ctrl+C cleanup check |
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

Run the applicable check for each locally installed adapter before an event
release. These commands stop before a paid model prompt:

```bash
opencode auth list --pure
claude auth status --json
codex login status
claude-agent-acp --help
codex-acp --help
```

Then run one full-round smoke only for the harnesses budgeted for the event.
OpenCode example:

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

For Claude Code, also confirm that the join prints the terms warning. Never run
Claude Code as a hosted harness for third parties; every end user runs the
unmodified binary with their own local authentication. For Codex, confirm that
the registered participant and the board `/me` response contain
`harness.id: "codex"` (and the optional model label when supplied).

## Full event board rehearsal

Run this after `bun install --frozen-lockfile`. It exercises the complete event
path without calling a paid model. Do not add Playwright. Use the browser tool
available to the implementer and keep admin, member, and steerer identities in
separate browser profiles or origins.

1. Run `bun run board:e2e`. Wait for the ready block and record its room code,
   database path, admin URL, projector URL, and board-only restart command.
2. Open admin at `http://localhost:3002/admin?token=<token>` with a 1440×900
   viewport. Set three squads and two hosted fake harnesses. Save. Capture the
   configured admin state.
3. Open member at `http://127.0.0.1:3002/me` and steerer at the facilitator LAN
   URL. These origins keep separate `gambi.board.person-id` values. Register two
   people in squad 1. Select `Fake de ensaio` for the member, run the copied
   command with `GAMBI_NO_INTERACTIVE=1`, and confirm `Conectado`. Capture `/me`
   at 390×844.
4. Claim a hosted harness as the steerer. Advance to round 1. On
   `/squad/squad-1`, assign the hosted harness and elect the steerer. The member
   may observe but must not prompt. Register one person in each remaining squad
   from two more isolated browser origins.
5. For rounds 1 through 3, select the orchestrator steerer, publish the seeded
   challenges, record at least one four-answer decision, dispatch it, and
   accept its review. Round 3 may be skipped, but still verify the phase change.
6. In round 4, assign one connected fake to every squad and dispatch all three
   decisions. Edit each fake workspace with valid `manifest.json`, `index.html`,
   and `README.md`. Give two manifests different station coordinates and leave
   one station `null`. Accept the artifacts, publish the accepted versions, and
   confirm the metro joins only live stations. Capture `/` at 1440×900 and
   390×844.
7. In round 5, confirm every challenge names its neighbor. Return squad 1 with
   a reason, verify the rework uses the same session ID, then accept it. Capture
   the neighbor, return reason, and session ID at 1280×720.
8. In round 6, confirm model discovery lists the two fixture model participants
   and no harnesses. Swap model A to model B. Verify the handoff lists squads,
   prior decisions, and pending work. Capture `/orchestrator` at 1280×720.
9. Send `SIGUSR1` with the exact PID printed by the supervisor. Do not use
   `SIGKILL`. Wait for `Board restart complete`, reload every role, and confirm
   phase, identities, claims, assignments, connected hosted participants, live
   tiles, decisions, return count, selected model, and handoff.
10. Advance to `finale`. Confirm the metro city, every recorded decision,
    human/harness draft totals, and return totals. At 390×844, assert
    `document.documentElement.scrollWidth <= clientWidth`. Capture desktop and
    mobile finale screenshots.
11. Press Ctrl+C once at the supervisor. Confirm ports 3000, 3001, 3002, 3101,
    and 3102 are free, and no fake ACP child remains.

Store the eight screenshots under
`docs/product/gambiarra-2026-08-23/evidence/issue-79/`. Its README records the
browser, viewport, command, restart result, and pass/fail facts without the
admin token.

### One-round OpenCode smoke

Run this only after the deterministic rehearsal and automated checks pass. It
spends one model round, exactly once.

1. Run `opencode auth list --pure`. Record only whether a login exists. Never
   copy its output into an issue or log.
2. Start `bun run event`, register one browser identity, and copy its OpenCode
   join command.
3. Run the command with `GAMBI_NO_INTERACTIVE=1` and `--format ndjson`. Confirm
   `registered`, `tunnel_connected`, `harness_spawned`, and `session_opened`.
4. Publish one round, make one decision, send one dispatch, and stop. Do not
   send a second model prompt. Confirm an `artifact_sent` event and accept one
   valid tile.
5. Press Ctrl+C in the participant and supervisor terminals. Confirm
   `harness_exited`, `left`, exit code 0, and no `opencode acp` child.

Record only adapter, model label, operating system, command exit code, and the
five checks above. If the binary or login is missing, record the readiness
failure and do not substitute credentials or another paid adapter.

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
