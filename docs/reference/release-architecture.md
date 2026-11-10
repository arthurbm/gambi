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
- `scripts/npm-release.ts` (publish and verify loop, tested by `scripts/npm-release.test.ts`)

### Stages

1. `version` — captures the exact source commit and calculates the next synchronized version from the selected bump type.
2. `build-cli` — builds the CLI distribution once and uploads `packages/cli/dist` as a workflow artifact.
3. `publish` — downloads the prebuilt artifact, updates repo package versions, publishes npm packages in two groups (see below), verifies npm metadata, emits the release report, commits the version bump, tags, pushes.
4. `github-release` — downloads the same prebuilt artifact, verifies asset names and sizes against the manifest, uploads to the GitHub Release.

### Publish order (required)

The script publishes in two groups. Inside a group, it publishes every package in this order without waiting for npm, then checks all of them together.

1. Base group:
   1. `gambi-sdk`
   2. `gambi-tui`
   3. `gambi-linux-x64`
   4. `gambi-linux-arm64`
   5. `gambi-darwin-arm64`
   6. `gambi-darwin-x64`
   7. `gambi-windows-x64`
2. `gambi` (wrapper), published only after npm shows every package of the base group.

The wrapper waits for the binaries to be visible, not just accepted. `npm publish` does not check the wrapper's `optionalDependencies`, so publishing it first would succeed. But an install that finds the wrapper before npm shows the matching binary skips the missing optional dependency without an error, and `gambi` ends up without a binary. Waiting costs about 1.5 minutes per release (the wrapper's own wait).

### Publish and verify loop

npm accepts a publish minutes before `npm view` shows it, and the registry serves packuments with `cache-control: max-age=300`. In v0.7.1 the wait after each publish took from 77 s (`gambi-sdk`) to 4.5 minutes (binaries). Until v0.7.1 the script waited for each package before publishing the next one, so the waits added up: 25 of the 27 minutes of the `publish` step. Now the waits overlap.

For each group, `publishAndVerify` in `scripts/npm-release.ts` runs up to 3 rounds:

1. Publish each pending package in order. A version that `npm view` already shows is not published again. If `npm publish` fails because the version exists (`You cannot publish over the previously published versions`, or `EPUBLISHCONFLICT`), the package counts as published.
2. Every 15 s, run `npm view` for all accepted packages at once, until each one shows the new version with the dist-tag pointing at it, or 10 minutes pass.
3. The next round retries only the packages whose publish failed or that npm still does not show.

If a package is still missing after 3 rounds, the step fails and lists each package with its last error. A slow package gets up to about 30 minutes in total.

Expected duration from the v0.7.1 timings: about 6 minutes for the base group and 1.5 minutes for the wrapper, against 27 minutes before.

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

### Why the token is still required

The March 2026 v0.3.x releases tested npm Trusted Publishing. Several workflow runs failed around v0.3.2 after npm returned `404` for packages that the workflow needed to publish. Commit `8372798` restored `NODE_AUTH_TOKEN` after each npm package was configured for granular token access with 2FA bypass. Issue #28 records the earlier v0.3.0 CI failure and the attempted migration.

The current token plus structured verification model is intentional. Do not remove `NODE_AUTH_TOKEN`, change the npm authentication method, or treat `id-token: write` as sufficient without a separate release-infrastructure change and a successful end-to-end publish test.

When adding a new published package to the repo:

1. Create the package on npmjs.com (or use the "pending package" flow).
2. In the package's settings, set publishing access to allow granular access tokens with 2FA bypass.
3. Ensure the `NPM_TOKEN` secret has publish permissions for the new package.

## Triggering a Release

### GitHub UI

1. Open **Actions** → **Release** → **Run workflow**
2. Select the `main` branch
3. Choose `patch`, `minor`, or `major`

### GitHub CLI

```bash
gh workflow run release.yml --ref main -f bump=patch
gambi_release_run_id=$(gh run list --workflow=release.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$gambi_release_run_id" --exit-status
```

The workflow always publishes the synchronized package set (`gambi-sdk`, `gambi-tui`, all binary packages, wrapper `gambi`, plus GitHub Release assets from the same artifact).

Run it only after the release changes have merged and the required validation is green on `main`. A feature branch must prepare release notes and validation instructions, but must not dispatch this workflow.

### Resuming a partial release

`scripts/publish.ts` does not publish a package again when its target version is already on npm, then verifies it like the others (see [Publish and verify loop](#publish-and-verify-loop)).

If the `publish` job fails after some packages reached npm and before `Commit and tag`, nothing was committed or tagged. Dispatch the workflow again on `main` with the same bump: the `version` job calculates the same version from the unchanged `package.json` files, and the publish step publishes only the packages that are missing.

If the job failed after `Commit and tag`, do not re-run with the same bump; the next version would be calculated. Recover the GitHub Release manually instead.

## Manual Binary Rebuilds

The `Build Binaries` workflow exists only for maintenance cases where you need to rebuild and attach CLI assets to an existing release tag.

Important rule: this workflow must build **from the selected tag itself**, not from current `main`.

## Local Validation Before Merging Release Changes

```bash
bun test scripts
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
