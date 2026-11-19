# Validation Matrix

What to run after touching each area of the monorepo, plus the known test gotchas.

For the day-to-day command set (install, dev, build, check-types, lint), see the root `AGENTS.md`. Per-workspace scripts live in each `package.json`.

## Matrix

| Area touched | Validation |
|---|---|
| `packages/core` | `bun test packages/core/src` and `bun run --cwd packages/core check-types`. Hub tests start a real hub on a random port with `layerHub()` from `@gambi/core/testing/hub` and a real participant runtime with `joinParticipant()` from `@gambi/core/testing/participant`. Add a trailing slash to run one folder (`bun test packages/core/src/hub/`), or Bun also matches files whose names start the same way. |
| `packages/protocol` | `bun run --cwd packages/protocol check-types` and `bun test scripts/effect-foundation.test.ts` (lint keeps platform APIs out of the package). The package has no tests of its own: its behavior is tested through the hub (the status table in `packages/core/src/hub/participant-status.test.ts`). |
| `packages/testing` (Effect test helper) | `bun test packages/testing/src` and `bun run --cwd packages/testing check-types` |
| `effect` / `@effect/*` version, `bun.lock`, `biome.json` | `bun test scripts/effect-foundation.test.ts` (one exact version, one copy of `effect`, lint rules) and `bun test packages/cli/src/effect-binary.test.ts` (the CLI, compiled to a binary, serves a hub, creates a room, reports errors, joins a fake harness participant, and updates itself) |
| `packages/cli` | `bun test packages/cli/src`, which runs each command as a command (`runCommand` and `startCommand` in `packages/cli/src/cli/testing.ts`) and the compiled-binary smoke; `bun run --cwd packages/cli check-types`; and `bun packages/cli/src/cli/main.ts <subcommand>` (or `bun run dev:cli -- <subcommand>`) to run it by hand and check `--help`. If you touched distribution or build, also `bun run --cwd packages/cli build`. |
| `packages/sdk` | `bun test packages/sdk/src` (from the repository root, as CI runs it) and `bun run --cwd packages/sdk check-types`. If you touched the build, an entry, public types, or dependencies, also `bun run --cwd packages/sdk build && bun run --cwd packages/sdk check:packed-types`: it packs the SDK, installs it in a clean project, checks that no entry loads another and that the default entry runs in Node, runs a hub, a participant, and a fake harness from the installed package in Bun, and type-checks a consumer in four configurations. Pass a version (`check:packed-types 0.8.0`) to check a release from npm instead. |
| SDK discovery helpers | review `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/reference/architecture.md` |
| `apps/tui` | `bun run --cwd apps/tui test` |
| HTTP contracts or public types | `bun test packages/core/src/hub/`, then `bun test packages/sdk/src` and `bun test packages/cli/src`, whose clients derive from the contract; see `docs/reference/docs-update.md` for required doc updates |
| Tunnel calls | `bun test packages/core/src/hub/ packages/core/src/participant/` (tunnel, reconnection, and cancellation tests); see `docs/reference/docs-update.md` |
| Harness participant runtime | `bun test packages/core/src/harness/ packages/sdk/src/harness-participant.test.ts`, then the installed-adapter smokes below |
| `apps/docs` (pages, landing, translations) | `bun run --cwd apps/docs check:i18n` and `bun run --cwd apps/docs build` (the build fails on a broken internal link or `#anchor`). For UI changes, look at the built site: see [Docs site checks](#docs-site-checks). Translations follow [`translation-pt-br.md`](translation-pt-br.md). |
| Tests, test helpers, dependencies, module state | `bun test scripts`: besides the release scripts, it runs the repository guards (`scripts/real-waits.test.ts`, `scripts/repo-guards.test.ts`, `scripts/effect-foundation.test.ts`) |
| Distribution / release | `bun test scripts` (publish and verify loop against a fake npm, CLI tarball validation), `bun run scripts/cli-tarballs.ts pack <version>` after a build with that version, `bun run --cwd packages/cli check-types`, `bun run --cwd packages/cli build`, `npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi`, `node ./packages/cli/dist/npm/gambi/bin/gambi --version` |

## Quick validation set

```bash
bun run check-types
bun run --cwd apps/tui test
```

## Environment notes

- Tests start every hub on a random free port (`port: 0`), so a busy port on the machine does not fail them.
- Run the suites with `CI=true` too (for example `CI=true bun test packages/core/src`): that is how GitHub Actions runs them, and `bun test` behaves differently under it (reading `test.only` throws).
- No Docker, database, or external service is required — all state is in-memory.
- Effect tests use `@gambi/testing/effect`, a helper over `bun test` that mirrors `@effect/vitest`, and follow [`effect-conventions.md`](effect-conventions.md#tests): `it.effect` with the test clock by default, `it.live` only for a real socket or subprocess, and no real wait. Timeouts, backoff, and the reconnection deadline are tested by moving the test clock.

## Docs site checks

CI (`.github/workflows/ci.yml`) runs `check-types`, the CLI, core, SDK, TUI, and Effect test helper tests, the release script tests (`bun test scripts`), the packed `gambi-sdk` consumer check, Biome on the whole repository (`bun x biome check .`), `check:i18n`, and the docs build on every PR.

- The build always prints `[WARN] [content] Entry docs → 404 was not found.` It is pre-existing and harmless.
- `bun run build` rewrites `apps/docs/dist`, which stops a running `bun run preview`. Restart the preview after each build.
- `bun x ultracite check` exits 0 even when it reports errors. To gate on lint, run `bun x biome check .` (as CI does) or `bun x biome check <files>`, which use the same config.
- Look at pages with headless Chrome rather than the T3 preview snapshot, which times out on a hidden tab. Run at most 3 at once:
  `google-chrome --headless=new --user-data-dir=$(mktemp -d) --disable-gpu --hide-scrollbars --virtual-time-budget=4000 --window-size=1440,7000 --screenshot=out.png http://localhost:4321/`
- The head script `src/scripts/locale-redirect.js` redirects by device language. To view `/pt-br/` add `--lang=pt-BR --accept-lang=pt-BR`; to check where a URL lands without a screenshot, use `--dump-dom` and read `<html lang>`.

## PR review bots

Greptile reviews a PR once, when it opens; a later push does not trigger a new review. After fixing its findings, the review on the first commit plus your own proof of the fix is the review gate. The retrigger link at the top of its comment asks for a fresh review if the change grew.

## Harness participant smoke

The automated tests start the deterministic fake ACP process, negotiate ACP
v1, prompt it through a real hub attach, observe its file write, and check the
artifact snapshot. They do not call a model:

```bash
bun test packages/core/src/harness/ packages/sdk/src/harness-participant.test.ts
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
  --nickname "OpenCode smoke" \
  --harness opencode \
  --model <MODEL_LABEL> \
  --format ndjson
```

Check these facts before pressing Ctrl+C:

1. Output contains `harness_started`, then `registered` and `tunnel_connected`.
2. `~/.gambi/workspaces/<ROOM_CODE>/opencode-smoke/` exists and holds only `.gambi.json` until the harness writes something.
3. A client attached with `client.harness.attach()` (or `curl -N` on `GET /v1/rooms/<ROOM_CODE>/participants/opencode-smoke/harness/events`) can send `session/prompt` with `client.harness.send()` and receive ACP updates.
4. Editing `README.md` produces `artifact_sent` after about one second.
5. Ctrl+C produces `leaving` and `left` with `reason: "stopped"`, and no `opencode acp` child remains.

Do not copy authentication output into the ticket. Record only the adapter,
model label, operating system, command exit code, and which checks passed.

For Claude Code, also confirm that the join prints the terms warning. Never run
Claude Code as a hosted harness for third parties; every end user runs the
unmodified binary with their own local authentication. For Codex, confirm that
the participant returned by `GET /v1/rooms/:code/participants` contains
`harness.id: "codex"` (and the optional model label when supplied).

The event board rehearsal and the orchestration demo moved with the board to
[`arthurbm/gambiarra-lab`](https://github.com/arthurbm/gambiarra-lab).
