# Validation Matrix

What to run after touching each area of the monorepo, plus the known test gotchas.

For the day-to-day command set (install, dev, build, check-types, lint), see the root `AGENTS.md`. Per-workspace scripts live in each `package.json`.

## Matrix

| Area touched | Validation |
|---|---|
| `packages/core` | `bun test packages/core/src` and `bun run --cwd packages/core check-types` |
| `packages/protocol` | `bun run --cwd packages/protocol check-types` and `bun test scripts/effect-foundation.test.ts` (lint keeps platform APIs out of the package). Tests for it use `@gambi/testing/effect`. |
| `packages/testing` (Effect test helper) | `bun test packages/testing/src` and `bun run --cwd packages/testing check-types` |
| `effect` / `@effect/*` version, `bun.lock`, `biome.json` | `bun test scripts/effect-foundation.test.ts` (one exact version, one copy of `effect`) and `bun test packages/cli/src/effect-binary.test.ts` (the new CLI, compiled to a binary, serves a hub, creates a room and reports errors) |
| `packages/cli` | run the affected subcommand, validate `--help`, `bun run --cwd packages/cli check-types`. For the new CLI (`src/cli/`): `bun test packages/cli/src/cli/`, which runs each command as a command, and `bun packages/cli/src/cli/main.ts <subcommand>` to run it by hand. If you touched distribution or build, also `bun run --cwd packages/cli build`. |
| `packages/sdk` | `bun test packages/sdk/src` and `bun run --cwd packages/sdk check-types`. If you touched the build, public types, or dependencies, also `bun run --cwd packages/sdk build && bun run --cwd packages/sdk check:packed-types`: it packs the SDK, installs it in a clean npm project, and type-checks a consumer with `skipLibCheck` off and on. Pass a version (`check:packed-types 0.7.1`) to check a release from npm instead. |
| SDK discovery helpers | review `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/reference/architecture.md` |
| `apps/tui` | `bun run --cwd apps/tui test` |
| HTTP contracts or public types | quick test of affected endpoint(s); see `docs/reference/docs-update.md` for required doc updates |
| Tunnel protocol | `bun test packages/core/src` (tunnel tests); see `docs/reference/docs-update.md` |
| Harness participant runtime | `bun test packages/core/src/harness packages/sdk/src/harness-participant-session.test.ts`, then the installed-adapter smokes below. If you touched `harness-process.ts` or the SDK exports, also run the Node smoke below. |
| `apps/docs` (pages, landing, translations) | `bun run --cwd apps/docs check:i18n` and `bun run --cwd apps/docs build` (the build fails on a broken internal link or `#anchor`). For UI changes, look at the built site: see [Docs site checks](#docs-site-checks). Translations follow [`translation-pt-br.md`](translation-pt-br.md). |
| Distribution / release | `bun test scripts` (publish and verify loop against a fake npm, CLI tarball validation), `bun run scripts/cli-tarballs.ts pack <version>` after a build with that version, `bun run --cwd packages/cli check-types`, `bun run --cwd packages/cli build`, `npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi`, `node ./packages/cli/dist/npm/gambi/bin/gambi --version` |

## Quick validation set

```bash
bun run check-types
bun run --cwd apps/tui test
```

## Environment notes

- Tests in `core` and `sdk` start a hub on fixed ports (e.g., 3998 / 3999) and may fail if the port is busy. Report this as an environmental failure, not a product failure.
- `packages/core/src/endpoint-capabilities.test.ts` has a historically-flaky test (`probeEndpoint > does not detect protected endpoints without auth headers`). Pre-existing; not introduced by recent work.
- No Docker, database, or external service is required — all state is in-memory.
- Effect tests follow [`effect-conventions.md`](effect-conventions.md#tests): `it.effect` with the test clock by default, `it.live` only for a real socket or subprocess, and no real wait.

## Docs site checks

CI (`.github/workflows/ci.yml`) runs `check-types`, the CLI tests, the Effect test helper tests, the release script tests (`bun test scripts`), the packed `gambi-sdk` consumer check, Biome on the changed files, `check:i18n`, and the docs build on every PR.

- The build always prints `[WARN] [content] Entry docs → 404 was not found.` It is pre-existing and harmless.
- `bun run build` rewrites `apps/docs/dist`, which stops a running `bun run preview`. Restart the preview after each build.
- `bun x ultracite check` exits 0 even when it reports errors. To gate on lint, run `bun x biome check <files>`, which uses the same config.
- Look at pages with headless Chrome rather than the T3 preview snapshot, which times out on a hidden tab. Run at most 3 at once:
  `google-chrome --headless=new --user-data-dir=$(mktemp -d) --disable-gpu --hide-scrollbars --virtual-time-budget=4000 --window-size=1440,7000 --screenshot=out.png http://localhost:4321/`
- The head script `src/scripts/locale-redirect.js` redirects by device language. To view `/pt-br/` add `--lang=pt-BR --accept-lang=pt-BR`; to check where a URL lands without a screenshot, use `--dump-dom` and read `<html lang>`.

## PR review bots

Greptile reviews a PR once, when it opens; a later push does not trigger a new review. After fixing its findings, the review on the first commit plus your own proof of the fix is the review gate. The retrigger link at the top of its comment asks for a fresh review if the change grew.

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
opencode auth list
claude auth status --json
codex login status
claude-agent-acp --help
codex-acp --help
```

Then run one full-round smoke only for the harnesses budgeted for the event.
OpenCode example:

```bash
opencode auth list
bun run dev:cli -- participant join \
  --room <ROOM_CODE> \
  --participant-id opencode-smoke \
  --name "OpenCode smoke" \
  --harness opencode \
  --model <MODEL_LABEL> \
  --format ndjson
```

Check these facts before pressing Ctrl+C:

1. Output contains `registered`, `tunnel_connected`, `harness_spawned`, and `session_opened`.
2. `~/.gambi/workspaces/<ROOM_CODE>/opencode-smoke/` exists and holds only `.gambi.json` until the harness writes something.
3. An attached harness client can send `session/prompt` and receive ACP updates.
4. Editing `README.md` produces `artifact_sent` after about one second.
5. Ctrl+C produces `harness_exited` and `left`, and no `opencode acp` child remains.

Do not copy authentication output into the ticket. Record only the adapter,
model label, operating system, command exit code, and which checks passed.

For Claude Code, also confirm that the join prints the terms warning. Never run
Claude Code as a hosted harness for third parties; every end user runs the
unmodified binary with their own local authentication. For Codex, confirm that
the participant returned by `GET /v1/rooms/:code/participants` contains
`harness.id: "codex"` (and the optional model label when supplied).

## Harness runtime under Node

`gambi-sdk` is used from Node as well as Bun. After touching the harness
process code or the SDK harness exports, build the SDK, start a hub with Bun,
and host a fake harness from Node with `createHarnessParticipantSession()`,
passing `createFakeHarnessAdapter({ command: process.execPath, args: [script] })`
where `script` imports `runFakeAcpAgent` from `packages/sdk/dist/index.js` and
awaits it. Confirm the session opens, `close()` resolves with `"closed"`, and
`harnessExited` resolves (143 after SIGTERM).

The event board rehearsal and the orchestration demo moved with the board to
[`arthurbm/gambiarra-lab`](https://github.com/arthurbm/gambiarra-lab).
