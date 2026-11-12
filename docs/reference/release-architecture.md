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
- `scripts/cli-tarballs.ts` (packs and validates the CLI tarballs, tested by `scripts/cli-tarballs.test.ts`)

The workflow has `concurrency: release`, so a second dispatch waits for the first one to finish instead of publishing or tagging at the same time. Both jobs that run Bun pin it (`bun-version: "1.4.4"`, also in `build-binaries.yml`), so a release compiles with the same Bun as the last one. Every release since v0.7.0 was built with 1.4.4, and the root `packageManager` pins the same version.

### Stages

1. `version` — captures the exact source commit and calculates the next synchronized version from the selected bump type.
2. `build-cli` — builds the CLI distribution once, packs the 6 CLI packages into tarballs (see [CLI tarballs](#cli-tarballs)), and uploads `packages/cli/dist` as a workflow artifact.
3. `publish` — checks the npm token (`npm whoami`), downloads the artifact, installs the packed CLI with install scripts off and runs it, updates repo package versions, publishes npm packages in two groups (see below), emits the release report, commits the version bump, tags, pushes.
4. `smoke` — on a clean runner, runs `npx -y gambi@<version> --version` (must print the version) and `participant join --help` with install scripts off.
5. `github-release` — downloads the same artifact, verifies asset names and sizes against the manifest, uploads to the GitHub Release. It runs in parallel with `smoke`: the GitHub assets do not come from npm.

### CLI tarballs

`actions/upload-artifact` drops file modes, so binaries that crossed from `build-cli` to `publish` as loose files reached npm as `0644`. The wrapper's `postinstall` hid that with a `chmod`, but installs that skip scripts (`bunx`, pnpm 10+, npm 12, `--ignore-scripts`) failed with `EACCES` (#83).

Now `build-cli` runs `bun run scripts/cli-tarballs.ts pack <version>`: it sets `bin/*` to `0755` in each CLI package and runs `npm pack`, which keeps the mode inside the tarball. `publish` publishes those exact files with `npm publish <file.tgz> --ignore-scripts`. `gambi-sdk` and `gambi-tui` still publish from their directories, because their `prepublishOnly` builds them.

Before publishing anything, `scripts/publish.ts` validates every tarball in `packages/cli/dist/tarballs` and stops on any problem:

- the package is one of the 5 platform packages or the wrapper, with exactly one tarball each, and none is missing;
- its version is the release version;
- `publishConfig` sets nothing but `access` (a tarball cannot redirect the registry);
- only the wrapper has install scripts;
- `package/bin/gambi` (or `gambi.exe`) is executable;
- the wrapper's `optionalDependencies` pin all 5 platform packages at the release version.

Then the `Smoke-test the CLI tarballs` step installs `gambi-linux-x64` and `gambi` from the tarballs with `npm install --ignore-scripts` and runs `gambi --version` and `gambi participant join --help`. The `smoke` job does the same from npm after publishing. Both keep install scripts off, so the `postinstall` cannot hide a binary without the executable bit.

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

The wrapper waits for the binaries to be visible, not just accepted. `npm publish` does not check the wrapper's `optionalDependencies`, so publishing it first would succeed. But an install that finds the wrapper before npm shows the matching binary skips the missing optional dependency without an error, and `gambi` ends up without a binary. The binaries' own `latest` tag does not matter to the wrapper, because it pins their exact version. Waiting costs about 1.5 minutes per release (the wrapper's own wait).

### Publish and verify loop

npm records a version minutes after `npm publish` returns. In v0.7.1, `time[version]` in each packument came 58 s (`gambi-sdk`) to 4.4 minutes (binaries) after the publish, and `npm view` showed the version 9 to 21 s after that time, within one 15 s polling interval. Until v0.7.1 the script waited for each package before publishing the next one, so the waits added up: 25 of the 27 minutes of the `publish` step. Now the waits overlap.

A fresher check would not help: the delay is in the registry, not in the CDN or the npm cache. `npm view` already fetches with `preferOnline` (the script passes `--prefer-online` anyway), and the per-version document (`GET /<pkg>/<version>`) is served uncached but only exists once the registry records the version.

For each group, `publishAndVerify` in `scripts/npm-release.ts`:

1. Publishes each package once, in order. A version that `npm view` already shows is not published again. If `npm publish` fails because the version exists (`You cannot publish over the previously published versions`, or `EPUBLISHCONFLICT`), the package counts as published. If any other publish fails, the step stops after trying the rest of the group, without waiting.
2. Every 15 s, runs `npm view --prefer-online` for all packages at once, until each one shows the new version with the dist-tag pointing at it, or the timeout passes: 30 minutes per group by default, set by `GAMBI_NPM_WAIT_MINUTES` in `release.yml`.

A package npm does not show in time is **not** published again in the same run. npm already accepted it and may still be processing it (other projects have seen large packages take up to an hour), and a second upload of a 50 MB tarball can fail with an error that hides a healthy publish. A timeout does not mean the publish failed: re-run the job later (see [Resuming a partial release](#resuming-a-partial-release)).

Expected duration from the v0.7.1 timings: about 6 minutes for the base group and 1.5 minutes for the wrapper, against 27 minutes before.

### Observability and verification

- `build-cli` prints and summarizes (`$GITHUB_STEP_SUMMARY`) the manifest content: wrapper directory, binary package list, release asset list with byte sizes and SHA-256 digests. Its pack step prints each tarball with the mode of its binary.
- `publish` writes `packages/cli/dist/release-report.json` with published-package list, npm metadata verification results per package, and CLI artifact metadata.
- `github-release` verifies uploaded asset names and byte sizes against expected manifest entries, then appends a table to job summary.

### Deferred

Considered for this pipeline and left for later:

- Stage, then promote (publish under a temporary dist-tag, move `latest` after everything shows up). It would add `npm dist-tag` calls the current token has never run in CI, more partial states, and no protection that the two groups do not already give without a test between the steps.
- npm Trusted Publishing (OIDC, #99) with `--provenance`, in its own PR and release.
- Building `gambi-sdk` and `gambi-tui` outside the job that holds the npm token.
- Removing the wrapper's `postinstall`.
- Beta or next channels.
- Moving the binaries off npm, which needs an ADR.

## Authentication

The release workflow authenticates to npm using a **granular access token** stored as the `NPM_TOKEN` repository secret.

How it works:

1. The `publish` job writes its own npm config to `$RUNNER_TEMP/npmrc` (the registry and `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`, nothing else) and points `NPM_CONFIG_USERCONFIG` at it.
2. Only the `Check the npm token` (`npm whoami`) and `Publish packages` steps get `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. `npm whoami` runs first, so an expired token fails the job in seconds.
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

If the `publish` job fails before `Commit and tag` (a publish error, or a package npm did not show in time), nothing was committed or tagged. Open the failed run and use **Re-run failed jobs**. The re-run reuses the `version` and `build-cli` outputs of that run: the same commit, the same version, and the same artifact, so npm, the tag, and the GitHub Release assets stay on the same build. It publishes only the packages npm does not show yet. After a timeout, wait a few minutes before re-running so npm can finish processing.

Do not dispatch the workflow again to resume. A new dispatch captures the current `HEAD` of `main` and rebuilds: if `main` moved, the tag and the GitHub Release assets would not match what is already on npm.

If the job failed after `Commit and tag`, do not re-run it; recover the GitHub Release manually instead.

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

To check the tarballs the release would publish (packing takes about a minute):

```bash
GAMBI_RELEASE_VERSION=0.0.0-local bun run --cwd packages/cli build
bun run scripts/cli-tarballs.ts pack 0.0.0-local
cd "$(mktemp -d)" && npm init -y > /dev/null
npm install --ignore-scripts <repo>/packages/cli/dist/tarballs/gambi-linux-x64-0.0.0-local.tgz <repo>/packages/cli/dist/tarballs/gambi-0.0.0-local.tgz
./node_modules/.bin/gambi --version
```

The workflow calls `./node_modules/.bin/gambi` directly. Avoid `npx --no gambi --version`: npm 11 reads that `--version` as its own and prints the npm version.

Smoke checks:

```bash
node ./packages/cli/dist/npm/gambi/bin/gambi --version
node ./packages/cli/dist/npm/gambi/bin/gambi --help
```
