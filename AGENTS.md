# AGENTS.md

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted local network. The transport is **tunnel-first**: each participant opens a WebSocket to the hub and the hub dispatches inference requests through that tunnel, so participant providers never need to be reachable from the hub.

## Source of truth

When documentation diverges from code, implement against the code and note the divergence in the task summary. Precedence: source in `packages/*` and `apps/*` → internal docs in `docs/` → public docs in `apps/docs/src/content/docs/` → `README.md`.

## Invariants

- **Tunnel-first.** The hub never originates a connection to a participant. The participant opens the WebSocket; the hub dispatches into it.
- **`ParticipantAuthHeaders` stay in the participant runtime.** They are applied only when calling the local provider — never uploaded to the hub or surfaced through the management API.
- **Conventional Commits** on every commit (`type(scope): subject`, e.g., `fix(cli): handle prompt cancellation`).
- **Trusted local network only.** The hub has no native auth. Do not introduce public exposure without an external proxy / auth layer.

## Essential commands

```bash
bun install                         # setup
bun run dev                         # run hub locally (gambi hub serve)
bun run dev:cli -- <subcommand>     # run any CLI subcommand
bun run check-types                 # turbo check-types across the monorepo
bun x ultracite fix                 # format before committing
```

If `bun` is not on `PATH` (Cursor Cloud and similar environments):

```bash
export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH"
```

For the full command catalog and the per-area validation matrix, see [`docs/agents/commands.md`](docs/agents/commands.md).

## Where to look

| Topic | Path |
|---|---|
| Architecture concepts (planes, components, lifecycles, security model) | `docs/reference/architecture.md` |
| Contract reference (envelope, error codes, endpoints, events, tunnel protocol, runtime constants, CLI flags / exit codes / env vars) | `docs/reference/contracts.md` |
| Observability detail (metrics, signals, phase 2 plan) | `docs/reference/observability.md` |
| Release process and npm authentication | `docs/reference/release-architecture.md` |
| Versioning policy | `docs/reference/versioning.md` |
| Architecture decision records (numbered, accepted decisions) | `docs/adr/` |
| Product direction (future of `gambi agents`, umbrella positioning) | `docs/product/vision.md` |
| Full command reference + validation matrix per area | `docs/agents/commands.md` |
| Doc-update checklist when changing public contracts | `docs/agents/docs-update.md` |
| Issue tracker conventions | `docs/agents/issue-tracker.md` |
| Triage labels | `docs/agents/triage-labels.md` |
| Domain language (`CONTEXT.md` is created lazily at the repo root) | `docs/agents/domain.md` |

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Code style

This project uses **Ultracite** (zero-config preset on top of Biome). Run `bun x ultracite fix` before committing. Biome covers formatting and most lint automatically; review business correctness, naming, and edge cases manually.

## Commit style

Every commit in this repo must use Conventional Commits: `type(scope): subject`. Use a scope when the affected area is clear, for example `feat(skills): install prototype and handoff skills`.
