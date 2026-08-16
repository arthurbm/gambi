# Runbook: scaffold da landing fora do Starlight

## Goal

Resolve the AFK wayfinder task “Scaffold da landing fora do Starlight” (GitHub issue 62) in `apps/docs`: establish a minimal, buildable landing shell at `/` and `/pt` outside Starlight, with isolated Tailwind v4, Astro React integration, and a default shadcn initialization. Leave visual direction and final copy for the next ticket.

## Fixed decisions

- The static Astro routes `src/pages/index.astro` and `src/pages/pt/index.astro` own `/` and `/pt`.
- Starlight continues to own every docs route through its rest route. Do not enable Astro or Starlight i18n.
- Landing CSS is imported only by landing pages/layouts. Tailwind preflight and shadcn tokens must not be loaded by Starlight docs pages.
- Run shadcn from `apps/docs`, as a single Astro project—not in monorepo mode. Initialize its current default preset for Astro; the final custom preset will be applied in a later ticket.
- English is the primary locale at `/`; Brazilian Portuguese is at `/pt`. User-facing strings must live in an extracted, typed locale dictionary rather than being duplicated in the route files.
- Preserve the existing Starlight documentation content and appearance. Remove only the legacy landing routing/wiring that conflicts with the new static root route.
- The implementation must respect the repository invariants and code style in `AGENTS.md`.

## Scope

Implement the smallest useful scaffold that proves the architecture:

1. Add and configure `@astrojs/react`, React, Tailwind v4’s Vite integration, and the dependencies produced by current shadcn initialization.
2. Configure the `@/*` alias consistently in Astro/Vite and TypeScript.
3. Add `apps/docs/components.json` with Tailwind v4 settings (`tailwind.config` empty), `rsc: false`, aliases matching the actual paths, and the landing stylesheet as its CSS target.
4. Add the shadcn utility module generated/expected by the initializer.
5. Add a landing-only stylesheet containing Tailwind v4 plus default shadcn tokens. It must be imported only through the landing route/layout tree.
6. Add a shared landing layout/component plus the two thin page entries. Set correct `lang`, canonical URL, and reciprocal `hreflang` alternate links for `en` and `pt-BR`.
7. Add a small neutral placeholder shell that makes the locale routing obvious and links to the existing Quick Start docs. Keep it intentionally unstyled/minimally styled: do not implement the ADR-0001 landing, its layer diagram, final visual direction, motion, or the final shadcn preset.
8. Remove `src/content/docs/index.mdx`, the root-only Starlight `Hero` override, and obsolete legacy landing components/assets only when they are no longer referenced. Remove the `Hero` override from `astro.config.mjs`. Do not retheme or otherwise rewrite docs CSS.

## Implementation constraints

- Use Bun commands because the root declares `packageManager: bun@1.3.13`.
- For shadcn CLI commands, use `bunx --bun shadcn@latest ...` and run from `apps/docs`.
- Do not guess or handcraft a custom preset. Use the CLI’s Astro default initialization non-interactively, then inspect and correct its output for this repo’s paths and CSS-isolation requirement.
- Do not add shadcn UI components just to demonstrate the setup; `components.json`, dependencies, utility module, and buildable CSS configuration are sufficient for this scaffold.
- Do not change public product copy beyond the neutral placeholder strings required to prove extraction and locale routing.
- Do not touch packages outside `apps/docs`, except the root lockfile and this runbook’s normal git history.
- Do not run final verification commands; the orchestrator owns formatting, typecheck/build, and visual smoke checks.

## Acceptance checklist

- `/` builds as a static English Astro page outside Starlight.
- `/pt` builds as a static Brazilian Portuguese Astro page outside Starlight.
- Both pages consume a shared typed locale dictionary and contain reciprocal language alternates.
- A representative docs page still renders through Starlight and does not load the landing Tailwind stylesheet or its shadcn variables/preflight.
- `apps/docs/components.json` is valid for Tailwind v4, Astro, React, `rsc: false`, and the actual aliases.
- `apps/docs/package.json`, root `bun.lock`, Astro config, and TS config agree on all integrations and aliases.
- No legacy root route conflicts remain.
- Changes are committed with a Conventional Commit, ideally `feat(docs): scaffold standalone localized landing`.

## Handoff

In the final response, list the files added/removed, the chosen shadcn default settings, the route/i18n shape, and any command or environment issue the orchestrator must account for. Stop after the scaffold commit; do not begin the visual landing implementation.
