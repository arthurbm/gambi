# Release Architecture Explained

This document explains the CLI distribution model used by Gambi and why it was chosen.

It also compares the approach with the one used by OpenCode, which was the main reference for the redesign.

## The Problem We Needed to Solve

Originally, the Gambi CLI lived as a normal workspace package in `packages/cli` and npm publishing was too close to the source workspace itself.

That caused two structural problems:

1. npm metadata leaked workspace-specific details such as `workspace:*`
2. `npm install -g gambi` was not a true first-class install path for the CLI

The redesign separates **source**, **distribution**, and **release assets**.

## The Three Layers

### 1. Source workspace

`packages/cli` is where the CLI is developed.

It contains:

- the Clipanion entrypoint
- subcommands
- helpers
- type-checking and local development scripts

This workspace is now `private: true`.

That does **not** mean Turbo or Bun stop seeing it. It only means:

- it is still a normal workspace for development
- it still participates in `bun install`, `turbo`, and local scripts
- but `npm publish` cannot accidentally ship it as-is

### 2. Generated npm distribution

The build produces packages under `packages/cli/dist/npm`:

- `gambi`
- `gambi-linux-x64`
- `gambi-linux-arm64`
- `gambi-darwin-arm64`
- `gambi-darwin-x64`
- `gambi-windows-x64`

Yes: this architecture intentionally creates multiple public npm packages.

That is normal for this distribution model.

The user still installs only:

```bash
npm install -g gambi
```

What happens next is:

- npm installs the public wrapper package `gambi`
- the wrapper declares platform packages as `optionalDependencies`
- because each binary package declares `os` and `cpu`, only the compatible one is installed for the current machine

So, in practice, a Linux x64 user gets:

- `gambi`
- `gambi-linux-x64`

and not all the others.

### 3. GitHub Release assets

The same build also produces raw binaries under `packages/cli/dist/releases`.

These are used by:

- GitHub Releases
- `scripts/install.sh`
- `scripts/install.ps1`

This is important because it keeps direct install and npm install aligned on the same compiled binaries.

## Why the Wrapper Exists

The wrapper solves a specific packaging problem.

The package named `gambi` is no longer the full CLI implementation. It is a small launcher package that:

- detects the current platform
- finds the installed platform binary package
- executes the real binary

That gives us two benefits:

1. `gambi` stays the only public install command users need to remember
2. the real heavy artifact is distributed as a platform-specific binary package

## Why `optionalDependencies` Matter

This is the part that usually feels magical the first time.

The wrapper package declares all platform packages, for example:

```json
{
  "optionalDependencies": {
    "gambi-linux-x64": "0.2.4",
    "gambi-linux-arm64": "0.2.4",
    "gambi-darwin-arm64": "0.2.4",
    "gambi-darwin-x64": "0.2.4",
    "gambi-windows-x64": "0.2.4"
  }
}
```

Each binary package also declares its own compatibility:

```json
{
  "os": ["linux"],
  "cpu": ["x64"]
}
```

So the package manager installs only what matches the current environment.

That is why the user does **not** download every binary package.

## Why Publish Order Matters

The wrapper depends on the binary packages already existing in the npm registry.

If `gambi` were published first, users could install a wrapper that points to binary packages that do not exist yet.

That is why the correct publish order is:

1. all platform packages
2. wrapper `gambi`

## Why We Reuse Build Artifacts in CI

The release workflow builds the CLI once, uploads `packages/cli/dist` as an artifact, and reuses it in later jobs.

This matters because otherwise CI could:

- build one binary set for npm
- build another binary set for GitHub Releases
- accidentally publish different artifacts for the same version

The artifact-based flow prevents that.

With the current release workflow, this reuse is also observable:

- the build manifest includes release asset metadata (size and SHA-256)
- CI publishes a human-readable summary table in `$GITHUB_STEP_SUMMARY`
- publish step emits `packages/cli/dist/release-report.json` with npm verification results
- GitHub Release upload is validated against manifest asset names and byte sizes

## Why the Release Is Pinned to One Commit

The release workflow captures one source commit up front and every later checkout uses that exact ref.

This prevents a subtle but serious failure mode:

- the version job reads one revision
- the CLI build job reads a newer revision
- the publish job reads yet another revision

If that happened, npm packages, Git tags, and GitHub Release assets could all refer to different source states.

Pinning the workflow to one commit keeps the release auditable and reproducible.

## How OpenCode Influenced This

OpenCode uses the same broad architecture:

- source workspace stays separate from published install surface
- wrapper package is public
- per-platform packages contain compiled binaries
- release workflow builds first and publishes later

The main reference points in `../opencode` were:

- `packages/opencode/script/build.ts`
- `packages/opencode/script/publish.ts`
- `packages/opencode/bin/opencode`
- `packages/opencode/script/postinstall.mjs`
- `.github/workflows/publish.yml`

What we copied conceptually:

- wrapper + binary package split
- `optionalDependencies`
- launcher script that resolves the right binary
- publish order: binaries first, wrapper last
- build once, reuse artifacts in CI

What we intentionally did **not** copy yet:

- preview/beta channels
- musl variants
- baseline CPU fallbacks
- AVX2 detection
- Homebrew/AUR distribution
- broader multi-product release orchestration

That makes the Gambi version simpler than OpenCode, but still structurally robust.

Another intentional difference:

- Gambi currently releases the synchronized package set together instead of supporting partial CLI-only or SDK-only releases

That keeps the versioning model honest and avoids tags that imply package versions which were never actually published.

## Authentication

The release workflow authenticates to npm using a **granular access token** stored as the `NPM_TOKEN` repository secret.

How it works:

1. The `publish` job passes `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step.
2. `actions/setup-node` with `registry-url` creates an `.npmrc` that references this token.
3. Each npm package on npmjs.com must allow granular access tokens (with 2FA bypass) in its publishing access settings.
4. The `publish` job also has `id-token: write` permission, which enables `--provenance` signing if added in the future.

When adding a new published package to the repo:

1. Create the package on npmjs.com (or use the "pending package" flow).
2. In the package's settings, set publishing access to allow granular access tokens with 2FA bypass.
3. Ensure the `NPM_TOKEN` secret has publish permissions for the new package.

## In Short

If you remember only four ideas, remember these:

1. `packages/cli` is the source workspace, not the published npm package
2. `gambi` is the public wrapper package
3. `gambi-<platform>-<arch>` packages contain the real compiled binaries
4. CI builds once and reuses the same artifacts for npm and GitHub Releases

For day-2 operations, there is now an equally important fifth idea:

5. CI performs explicit post-publish verification (npm metadata + GitHub Release assets), not only best-effort publishing
