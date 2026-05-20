# Release Architecture

Operational reference for the Gambi CLI distribution and release pipeline.

For the rationale behind the wrapper + per-platform binary model, optionalDependencies resolution, publish order, build-once-reuse, and pin-to-commit, see [`docs/adr/0004-cli-distribution-model.md`](../adr/0004-cli-distribution-model.md).

For versioning policy (synchronized package set), see [`docs/reference/versioning.md`](./versioning.md) and [`docs/adr/0005-synchronized-monorepo-versions.md`](../adr/0005-synchronized-monorepo-versions.md).

## The Three Layers

### 1. Source workspace

`packages/cli` is where the CLI is developed.

It contains:

- the Clipanion entrypoint
- subcommands
- helpers
- type-checking and local development scripts

This workspace is `private: true`. It still participates in `bun install`, `turbo`, and local scripts; the flag just blocks `npm publish` from shipping it as-is.

### 2. Generated npm distribution

The build produces packages under `packages/cli/dist/npm`:

- `gambi`
- `gambi-linux-x64`
- `gambi-linux-arm64`
- `gambi-darwin-arm64`
- `gambi-darwin-x64`
- `gambi-windows-x64`

The user installs only:

```bash
npm install -g gambi
```

The wrapper package `gambi` declares the platform packages as `optionalDependencies`. Each binary package declares its own `os` / `cpu`. Only the compatible binary is installed for the current machine.

### 3. GitHub Release assets

The same build produces raw binaries under `packages/cli/dist/releases`. These back GitHub Releases, `scripts/install.sh`, and `scripts/install.ps1` — keeping every install channel aligned on the same compiled artifacts.

## Release Pipeline

Source of truth:

- `.github/workflows/release.yml`
- `scripts/publish.ts`

### Stages

1. `version` — captures the exact source commit and calculates the next synchronized version from the selected bump type.
2. `build-cli` — builds the CLI distribution once and uploads `packages/cli/dist` as a workflow artifact.
3. `publish` — downloads the prebuilt artifact, updates repo package versions, publishes npm packages in order, verifies npm metadata, emits the release report, commits the version bump, tags, pushes.
4. `github-release` — downloads the same prebuilt artifact, verifies asset names and sizes against the manifest, uploads to the GitHub Release.

### Publish order (required)

1. `gambi-sdk`
2. `gambi-tui`
3. `gambi-linux-x64`
4. `gambi-linux-arm64`
5. `gambi-darwin-arm64`
6. `gambi-darwin-x64`
7. `gambi-windows-x64`
8. `gambi` (wrapper — must be last; depends on platform packages existing in the registry)

### Observability and verification

- `build-cli` prints and summarizes (`$GITHUB_STEP_SUMMARY`) the manifest content: wrapper directory, binary package list, release asset list with byte sizes and SHA-256 digests.
- `publish` writes `packages/cli/dist/release-report.json` with published-package list, npm metadata verification results per package, and CLI artifact metadata.
- `github-release` verifies uploaded asset names and byte sizes against expected manifest entries, then appends a table to job summary.

## Authentication

The release workflow authenticates to npm using a **granular access token** stored as the `NPM_TOKEN` repository secret.

How it works:

1. The `publish` job passes `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step.
2. `actions/setup-node` with `registry-url` creates an `.npmrc` that references this token.
3. Each npm package on npmjs.com must allow granular access tokens (with 2FA bypass) in its publishing access settings.
4. The `publish` job also has `id-token: write` permission, enabling `--provenance` signing if added in the future.

When adding a new published package to the repo:

1. Create the package on npmjs.com (or use the "pending package" flow).
2. In the package's settings, set publishing access to allow granular access tokens with 2FA bypass.
3. Ensure the `NPM_TOKEN` secret has publish permissions for the new package.

## Triggering a Release

### GitHub UI

1. Open **Actions** → **Release** → **Run workflow**
2. Choose `patch`, `minor`, or `major`

### GitHub CLI

```bash
gh workflow run release.yml -f bump=patch
gh run watch
```

The workflow always publishes the synchronized package set (`gambi-sdk`, `gambi-tui`, all binary packages, wrapper `gambi`, plus GitHub Release assets from the same artifact).

## Manual Binary Rebuilds

The `Build Binaries` workflow exists only for maintenance cases where you need to rebuild and attach CLI assets to an existing release tag.

Important rule: this workflow must build **from the selected tag itself**, not from current `main`.

## Local Validation Before Merging Release Changes

```bash
bun run --cwd packages/cli check-types
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi-linux-x64
bun run --cwd packages/sdk build
```

Smoke checks:

```bash
node ./packages/cli/dist/npm/gambi/bin/gambi --version
node ./packages/cli/dist/npm/gambi/bin/gambi --help
```
