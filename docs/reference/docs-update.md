# Doc Update Checklist

When you change a public contract or behavior, update the corresponding docs in the same PR.

## What to update when

| If you change... | Update these docs |
|---|---|
| Management or inference HTTP endpoints | `docs/reference/contracts.md`, `docs/reference/architecture.md` (only if the conceptual model changes), `apps/docs/src/content/docs/reference/api.md`, `README.md` |
| Error codes or envelope shape | `docs/reference/contracts.md`, `apps/docs/src/content/docs/reference/api.md` |
| Tunnel protocol messages | `docs/reference/contracts.md`, `docs/reference/architecture.md`, `apps/docs/src/content/docs/architecture/overview.md`, `apps/docs/src/content/docs/explanation/tunnel-first.mdx` |
| Runtime constants (`HEALTH_CHECK_INTERVAL`, `PARTICIPANT_TIMEOUT`, etc.) | `docs/reference/contracts.md` |
| SSE event types or `llm.*` metrics | `docs/reference/contracts.md`, `docs/reference/observability.md`, `apps/docs/src/content/docs/reference/observability.md` |
| SDK surfaces (`createGambi`, `createClient`, `createParticipantSession`, discovery) | `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/reference/architecture.md` |
| `createParticipantSession()` semantics | `apps/docs/src/content/docs/guides/custom-participant.mdx` |
| CLI commands or flags | `apps/docs/src/content/docs/reference/cli.mdx`, `docs/reference/validation.md`, `docs/reference/contracts.md` (exit codes, global flags, env vars) |
| User-facing UX (quickstart, remote provider flows) | `apps/docs/src/content/docs/guides/quickstart.mdx`, `apps/docs/src/content/docs/guides/remote-providers.md`, `README.md` |
| Release process or distribution | `docs/reference/release-architecture.md` |
| Versioning rules | `docs/reference/versioning.md` |

## Audiences

- `docs/` — internal: agent-facing operational reference and architectural rationale.
- `apps/docs/src/content/docs/` — public: end-user reference and guides (Astro Starlight site).
- `README.md` — top-of-funnel UX. Keep it terse; defer detail to `apps/docs/`.

## Known weak spots

- Some workspace `README.md` files are placeholders and don't reflect current behavior. The authoritative public docs live in `apps/docs/src/content/docs/`.
