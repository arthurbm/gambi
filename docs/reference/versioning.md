# Versioning Reference

Package layout and day-to-day rules for versioning in the Gambi monorepo.

For the rationale behind synchronized versions (vs independent per-package versioning), see [`docs/adr/0005-synchronized-monorepo-versions.md`](../adr/0005-synchronized-monorepo-versions.md).

For the distribution model that ties the wrapper + binary packages together, see [`docs/adr/0004-cli-distribution-model.md`](../adr/0004-cli-distribution-model.md).

For the release pipeline (workflow stages, authentication, trigger steps, local validation), see [`docs/reference/release-architecture.md`](./release-architecture.md).

## Package Layout

| Package | Published | Purpose |
|---------|-----------|---------|
| `gambi` | Yes | Public wrapper that launches the platform binary |
| `gambi-linux-x64` | Yes | Linux x64 CLI binary |
| `gambi-linux-arm64` | Yes | Linux arm64 CLI binary |
| `gambi-darwin-arm64` | Yes | macOS Apple Silicon CLI binary |
| `gambi-darwin-x64` | Yes | macOS Intel CLI binary |
| `gambi-windows-x64` | Yes | Windows x64 CLI binary |
| `gambi-sdk` | Yes | SDK package for app integrations |
| `gambi-tui` | Yes | Interactive terminal dashboard |
| `@gambi/core` | No | Internal core library |
| `@gambi/config` | No | Internal shared config |
| `packages/cli` workspace | No | Source workspace used to build the wrapper and binary packages |

Important details:

- `packages/cli/package.json` is `private: true`.
- The npm package named `gambi` is generated under `packages/cli/dist/npm/gambi`.
- Platform packages are generated under `packages/cli/dist/npm/gambi-<platform>-<arch>`.
- All published packages share the same version on every release (synchronized — see ADR-0005).

## Rules for Everyday Development

- **Do not bump versions manually in feature PRs.** The release workflow is the only legitimate way to mutate `version` in `package.json`. PRs that touch versions get rejected in review.
- **Use Conventional Commits** for every commit (`type(scope): subject`), e.g. `fix(cli): harden self update output`. Scopes are advisory under synchronized versioning — see ADR-0005 — but remain useful for changelog and blame.
- **Let the release workflow update synchronized versions.** Manual edits cause drift between `package.json` files; the workflow propagates one number across all of them in a single commit.
- **Treat `packages/cli/dist` as generated output only.** Never commit changes inside it; the build regenerates everything.
- **If a change affects install, publish, wrapper resolution, or platform binaries**, update [`docs/reference/release-architecture.md`](./release-architecture.md) and `AGENTS.md` in the same PR.

## Deferred Follow-Ups

These are intentionally out of scope (also noted in ADR-0004):

- beta channel with npm dist-tags
- musl / baseline variants and CPU capability fallbacks
- automated install smoke tests across platforms
- distribution channels like Homebrew or AUR
- migration to npm Trusted Publishing (OIDC) to eliminate stored tokens
- `--provenance` flag for supply chain attestation
