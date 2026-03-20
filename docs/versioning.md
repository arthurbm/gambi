# Versioning and Release Process

This document explains how Gambi versions and releases its packages.

## Decision: Synchronized Versions

All Gambi packages use **synchronized versions**. When a release happens, every package moves to the same version number.

Example:

```text
gambi                 0.2.4
gambi-linux-x64       0.2.4
gambi-linux-arm64     0.2.4
gambi-darwin-arm64    0.2.4
gambi-darwin-x64      0.2.4
gambi-windows-x64     0.2.4
gambi-sdk             0.2.4
@gambi/core           0.2.4
```

We keep this model because it makes compatibility obvious and keeps release tooling simple.

## Package Layout

| Package | Published | Purpose |
|---------|-----------|---------|
| `gambi` | Yes | Public wrapper package that launches the platform binary |
| `gambi-linux-x64` | Yes | Linux x64 CLI binary |
| `gambi-linux-arm64` | Yes | Linux arm64 CLI binary |
| `gambi-darwin-arm64` | Yes | macOS Apple Silicon CLI binary |
| `gambi-darwin-x64` | Yes | macOS Intel CLI binary |
| `gambi-windows-x64` | Yes | Windows x64 CLI binary |
| `gambi-sdk` | Yes | SDK package for app integrations |
| `@gambi/core` | No | Internal core library |
| `@gambi/config` | No | Internal shared config |
| `packages/cli` workspace | No | Source workspace used to build the wrapper and binary packages |

Important detail:

- `packages/cli/package.json` is `private: true`
- the npm package named `gambi` is generated under `packages/cli/dist/npm/gambi`
- platform packages are generated under `packages/cli/dist/npm/gambi-<platform>-<arch>`

## How the CLI Distribution Works

The CLI uses a **wrapper + platform binaries** architecture.

1. `packages/cli` contains the source code for the CLI.
2. `bun run --cwd packages/cli build` compiles one binary per supported platform.
3. The build also generates:
   - a wrapper package `gambi`
   - one binary package per platform
   - GitHub Release assets under `packages/cli/dist/releases`
4. The wrapper package declares the binary packages as `optionalDependencies`.
5. During installation, the package manager installs the wrapper and only the matching platform binary.
6. At runtime, the wrapper resolves the installed platform binary and executes it.

## Release Workflow

The source of truth for releasing is:

- `.github/workflows/release.yml`
- `scripts/publish.ts`

### Release Stages

The workflow runs in four stages:

1. `version`
   Captures the exact source commit for the release and calculates the next synchronized version from the selected bump type.
2. `build-cli`
   Builds the CLI distribution once and uploads `packages/cli/dist` as a workflow artifact.
3. `publish`
   Downloads the prebuilt CLI distribution, updates repository package versions, publishes npm packages, explicitly verifies npm metadata (`version` and selected dist-tag) for each published package, emits a structured release report, commits the version bump, tags the release, and pushes.
4. `github-release`
   Verifies expected release assets from the build manifest, uploads the same prebuilt CLI binaries to the GitHub Release, and explicitly verifies uploaded asset names and byte sizes against the build manifest.

This matters because the release is pinned to one commit and the CLI is built **once** and reused for both npm publishing and GitHub release assets. That avoids divergent artifacts.

## Release Observability and Verification

The release pipeline now emits structured state to make debugging easier:

- `build-cli` prints and summarizes (`$GITHUB_STEP_SUMMARY`) the manifest content:
  - wrapper package directory
  - binary package list
  - release asset list, byte sizes, and SHA-256 digests
- `publish` writes `packages/cli/dist/release-report.json` with:
  - published package list
  - npm metadata verification results per package
  - CLI artifact metadata used by the release
- `github-release` verifies that uploaded release assets match expected manifest entries (name + size), then appends a table to job summary.

These checks reduce manual log-hunting and make post-failure analysis significantly faster.

## Publish Order

When the release includes the CLI, npm publishing must happen in this order:

1. `gambi-linux-x64`
2. `gambi-linux-arm64`
3. `gambi-darwin-arm64`
4. `gambi-darwin-x64`
5. `gambi-windows-x64`
6. `gambi`

The wrapper must be published last, because it depends on the binary packages already existing in the registry.

## How to Trigger a Release

### GitHub UI

1. Open **Actions**
2. Open **Release**
3. Click **Run workflow**
4. Choose `patch`, `minor`, or `major`

### GitHub CLI

```bash
# Release the synchronized package set
gh workflow run release.yml -f bump=patch

# Watch the run
gh run watch
```

The release workflow always publishes the synchronized package set:

- `gambi-sdk`
- all CLI binary packages
- wrapper `gambi`
- GitHub Release assets built from the same CLI artifact

## Manual Binary Rebuilds

The `Build Binaries` workflow exists only for maintenance cases where you need to rebuild and attach CLI assets to an existing release tag.

Important rule:

- this workflow must build from the selected tag itself, not from current `main`

## Local Validation Before Merging Release Changes

When touching CLI distribution or release tooling, validate at least:

```bash
bun run --cwd packages/cli check-types
bun run --cwd packages/cli build
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi
npm pack --dry-run --cache /tmp/npm-cache ./packages/cli/dist/npm/gambi-linux-x64
bun run --cwd packages/sdk build
```

Useful smoke checks:

```bash
node ./packages/cli/dist/npm/gambi/bin/gambi --version
node ./packages/cli/dist/npm/gambi/bin/gambi --help
```

## Rules for Everyday Development

- Do not bump versions manually in feature PRs.
- Let the release workflow update synchronized versions.
- Treat `packages/cli/dist` as generated output only.
- If a change affects install, publish, wrapper resolution, or platform binaries, update this document and `AGENTS.md` in the same PR.

## Deferred Follow-Ups

These are intentionally out of scope for the current architecture:

- beta channel with npm dist-tags
- musl/baseline variants and CPU capability fallbacks
- automated install smoke tests across platforms
- extra distribution channels like Homebrew or AUR
