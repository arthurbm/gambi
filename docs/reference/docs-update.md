# Doc Update Checklist

When you change a public contract or behavior, update the corresponding docs in the same PR.

## What to update when

| If you change... | Update these docs |
|---|---|
| Management or inference HTTP endpoints | `docs/reference/contracts.md`, `docs/reference/architecture.md` (only if the conceptual model changes), `apps/docs/src/content/docs/reference/api.md`, `README.md` |
| Error codes or envelope shape | `docs/reference/contracts.md`, `apps/docs/src/content/docs/reference/api.md` |
| Tunnel protocol messages | `docs/reference/contracts.md`, `docs/reference/architecture.md`, `apps/docs/src/content/docs/concepts/architecture.md`, `apps/docs/src/content/docs/concepts/tunnel-first.mdx` |
| Runtime constants (`HEALTH_CHECK_INTERVAL`, `PARTICIPANT_TIMEOUT`, etc.) | `docs/reference/contracts.md` |
| SSE event types or event metrics | `docs/reference/contracts.md`, `docs/reference/observability.md`, `apps/docs/src/content/docs/reference/observability.md` |
| SDK surfaces (`createGambi`, `createClient`, `client.harness.attach`, `createParticipantSession`, discovery) | `apps/docs/src/content/docs/reference/sdk.md`, `apps/docs/src/content/docs/guides/ai-tools.md`, `README.md`, `docs/reference/architecture.md` |
| `createParticipantSession()` semantics | `apps/docs/src/content/docs/guides/custom-participant.mdx` |
| Harness participant setup or adapter behavior | `apps/docs/src/content/docs/guides/bring-your-harness.mdx`, `apps/docs/src/content/docs/reference/cli.mdx`, `apps/docs/src/content/docs/concepts/tunnel-first.mdx`, `README.md` |
| CLI commands or flags | `apps/docs/src/content/docs/reference/cli.mdx`, `docs/reference/validation.md`, `docs/reference/contracts.md` (exit codes, global flags, env vars) |
| User-facing UX (installation, quickstart, remote provider flows) | `apps/docs/src/content/docs/start/installation.mdx`, `apps/docs/src/content/docs/start/quickstart.mdx`, `apps/docs/src/prompts.ts` (the "Ask your agent" setup prompt), `apps/docs/src/content/docs/guides/remote-providers.md`, `README.md` |
| Release process or distribution | `docs/reference/release-architecture.md` |
| Versioning rules | `docs/reference/versioning.md` |

## Localization

The public docs ship in English (site root) and Brazilian Portuguese (`/pt-br/`), using Starlight's i18n.

- Every page under `apps/docs/src/content/docs/` has a Portuguese counterpart at the same path under `apps/docs/src/content/docs/pt-br/`. When you change an English page, update its counterpart in the same PR. Internal links in Portuguese pages carry the `/pt-br` prefix.
- Landing and component strings live in `apps/docs/src/content/i18n/en.json` and `pt-BR.json`, read with `Astro.locals.t()`. Add every new key to both files.
- CI enforces both rules with `bun run --cwd apps/docs check:i18n`. It checks that the pages and keys exist, not that the translation is current.
- The agent setup prompt has one version per language in `apps/docs/src/prompts.ts`.
- Terms, markup rules, and length limits for Portuguese copy: [`translation-pt-br.md`](translation-pt-br.md).

## Audiences

- `docs/` — internal: agent-facing operational reference and architectural rationale.
- `apps/docs/src/content/docs/` — public: end-user reference and guides (Astro Starlight site).
- `README.md` — top-of-funnel UX. Keep it terse; defer detail to `apps/docs/`.

## Known weak spots

- Some workspace `README.md` files are placeholders and don't reflect current behavior. The authoritative public docs live in `apps/docs/src/content/docs/`.
