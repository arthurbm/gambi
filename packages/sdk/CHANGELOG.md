# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Package renamed from `@gambi/sdk` to `gambi-sdk` (npm scope unavailable)

## [0.1.0] - 2026-01-09

### Added

- Initial npm release as `gambi` (without scope)
- Complete SDK wrapper exposing 100% of @gambi/core functionality
- Organized namespace API: `rooms`, `participants`, `hub`
- Vercel AI SDK provider integration via `createGambi()`
- HTTP client for remote hub interactions via `createClient()`
- Full TypeScript support with auto-generated .d.ts files
- Tree-shakeable subpath exports for optimal bundle size
- OpenAI-compatible types and runtime validation with Zod schemas

### Changed

- Package name from `@gambi/sdk` to `gambi`
- Build system: TypeScript compiler (tsc) for simplicity and reliability
- All exports now point to compiled `dist/` files instead of source `.ts` files

### Technical

- Build configuration inspired by OpenCode architecture
- Simple tsc-based build for 1:1 source structure
- Sourcemaps and declaration maps for debugging
- Proper npm metadata (description, keywords, repository, license)
- PublishConfig for public access

[0.1.0]: https://github.com/arthurbm/gambi/releases/tag/v0.1.0
