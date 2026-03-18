# Versioning Strategy

This document explains the versioning strategy for Gambi packages.

## Decision: Synchronized Versions

All Gambi packages use **synchronized versions** - when a release is made, all packages are bumped to the same version number.

```
gambi (CLI):     0.1.2
gambi-sdk:      0.1.2
@gambi/core:     0.1.2  (internal)
```

### Why Synchronized?

We evaluated two approaches:

| Approach | Used By | Pros | Cons |
|----------|---------|------|------|
| **Synchronized** | React, Angular, OpenCode | Simple, guaranteed compatibility | Version bump without changes |
| **Independent** | Babel, AWS SDK | Versions reflect real changes | Complex, compatibility issues |

**We chose synchronized versions because:**

1. **Project Size** - Gambi is small; independent versioning overhead doesn't pay off
2. **Shared Core** - SDK and CLI depend on the same core; they should evolve together
3. **Simplicity** - Less chance of errors, less tooling required
4. **Compatibility** - Users know that `0.1.2` of everything works together

### The "Cost" is Low

Bumping a version without changes in a specific package:
- Users run `npm update` and get the same code (no harm)
- Doesn't break anything
- Semver is about **compatibility**, not "amount of changes"

## Package Structure

| Package | npm Name | Published | Notes |
|---------|----------|-----------|-------|
| CLI | `gambi` | Yes | Main product, includes TUI |
| SDK | `gambi-sdk` | Yes | For developers integrating with Vercel AI SDK |
| Core | `@gambi/core` | No | Internal, bundled into SDK/CLI |
| TUI | `tui` | No | Internal, `private: true`, used by CLI |
| Config | `@gambi/config` | No | Internal, `private: true` |
| Docs | `docs` | No | Documentation site |

## When to Release

| Change | Release Needed? | Package to Select |
|--------|-----------------|-------------------|
| Bug fix in SDK | Yes | `sdk` or `all` |
| New feature in CLI | Yes | `cli` or `all` |
| UI fix in TUI | Yes (if users need it) | `cli` or `all` |
| Refactor in Core | Depends | If affects SDK/CLI behavior |
| Documentation only | No | Just commit and push |
| Internal refactor | No | Just commit and push |

**Key insight:** Release is for delivering something to external users. Internal changes are just normal commits.

## Release Workflow

Releases are automated via GitHub Actions with an OpenCode-style workflow.

### How It Works

1. Workflow is triggered manually (not by tags)
2. You select: bump type (`patch`/`minor`/`major`) and package (`all`/`sdk`/`cli`)
3. CI calculates the new version automatically
4. CI updates ALL `package.json` files (synchronized)
5. CI builds and publishes to npm
6. CI commits, tags, and pushes
7. CI builds binaries and creates GitHub Release (if CLI)

### Via GitHub UI

1. Go to **Actions** > **Release** > **Run workflow**
2. Select bump type: `patch`, `minor`, or `major`
3. Select package: `all`, `sdk`, or `cli`
4. Click **Run workflow**

### Via GitHub CLI

```bash
# Release all packages with patch bump (0.1.1 → 0.1.2)
gh workflow run release.yml -f bump=patch -f package=all

# Release only SDK with minor bump (0.1.1 → 0.2.0)
gh workflow run release.yml -f bump=minor -f package=sdk

# Release only CLI with major bump (0.1.1 → 1.0.0)
gh workflow run release.yml -f bump=major -f package=cli

# Watch the workflow progress
gh run watch
```

### What Each Option Does

| Package | npm Publish | GitHub Release | Binaries |
|---------|-------------|----------------|----------|
| `all` | SDK + CLI | Yes | Yes |
| `sdk` | SDK only | No | No |
| `cli` | CLI only | Yes | Yes |

**Note:** Version is always synchronized across all packages, regardless of which package you publish.

## Semantic Versioning

We follow [SemVer](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backward compatible
- **PATCH** (0.0.1): Bug fixes, backward compatible

### Examples

```bash
# Bug fix in SDK
gh workflow run release.yml -f bump=patch -f package=sdk

# New feature in CLI (e.g., new command)
gh workflow run release.yml -f bump=minor -f package=cli

# Breaking change in API
gh workflow run release.yml -f bump=major -f package=all
```

## Future Considerations

If Gambi grows significantly and independent versioning becomes necessary, we can adopt **Changesets**:

```bash
bunx changeset        # Create changeset describing the change
bunx changeset version  # Calculate versions automatically
bunx changeset publish  # Publish
```

For now, synchronized versions are the right choice for simplicity and maintainability.

## References

- [OpenCode](https://github.com/anomalyco/opencode) - Uses synchronized versions
- [Semantic Versioning](https://semver.org/)
- [Changesets](https://github.com/changesets/changesets) - For independent versioning
