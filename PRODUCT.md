# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: **builders who create multi-LLM experiences on top of Gambi** — developers (like the `gambiarra-arena` case) who want rooms, presence, routing, and events as a ready substrate instead of rebuilding transport themselves. Product decisions optimize for them first (confirmed 2026-08-10).

Secondary, confirmed audiences:

- **Club members at in-person events** — people who plug their local LLM (Ollama, etc.) into a shared room with minimal friction.
- **Room operators/hosts** — whoever runs `gambi hub serve`, creates rooms, and monitors participants via CLI/TUI.
- **Automation clients** — the CLI, HTTP, and SDK surfaces are agent-first (structured for non-interactive automation, per ADR-0002).

## Product Purpose

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted local network: a central hub tracks rooms and participants, proxies inference through participant-opened tunnels, and publishes real-time events.

Success (confirmed): **substrate adoption first** — outside builders adopt Gambi instead of rebuilding the stack, with frictionless onboarding — and on that base, **field validation at the Gambiarra LLM Club and the maintainer's research (TCC)** on social experiences between LLMs. The known failure mode to beat is the "adoptability wall" documented in `docs/product/research-direction.md` (issues #54, #55).

## Positioning

"Put your friends' LLMs in a room." Gambi is a **social-ready inference substrate**: room-scoped multi-participant sharing where providers never need to be reachable — the participant opens a tunnel to the hub (tunnel-first, ADR-0003). Neighboring gateways (OpenRouter-style) aggregate providers for one consumer; they do not offer people-contributed participants, rooms, presence, and events as a base for shared multi-LLM experiences.

## Operating Context

- Trusted local networks: homes, labs, and in-person club events; hubs may also be remote on the same trusted network.
- Two API planes: management plane (`/v1/*`, native envelope, CLI/SDK/TUI) and inference plane (`/rooms/:code/v1/*`, OpenAI-compatible, default protocol OpenAI Responses).
- Product surfaces: `gambi` CLI (agent-first, `--format text|json|ndjson`), `gambi-sdk` (inference provider + management client), `gambi-tui` (human-first monitoring), docs site (`apps/docs`, Astro Starlight), install via `gambi.sh` script or npm.
- Builders integrate via the Vercel AI SDK (`createGambi()`) or any OpenAI-compatible client.
- The Gambiarra LLM Club (gambiarra.club) is the field-validation venue: real events, real people plugging local LLMs into shared rooms.

## Capabilities and Constraints

- Confirmed capabilities: room lifecycle, participant registration, tunnel-backed dispatch, model-selector routing (`participantId`, `model:<name>`, `*`), management heartbeats vs tunnel ping/pong, SSE room events with baseline metrics (TTFT, duration, tokens, tokens/s), dry-run + NDJSON on operational commands, local network hub/room discovery.
- Invariants future work must preserve: tunnel-first (hub never originates a connection to a participant); `ParticipantAuthHeaders` never leave the participant runtime; trusted-network only — no native auth, no public exposure without an external proxy/auth layer.
- Canonical vocabulary lives in `CONTEXT.md` (hub, room, participant, provider, tunnel, status vs connection). "Agent" is overloaded — never use it unqualified.
- Out of scope today (parked for "Gambi Agents", `docs/product/vision.md`): agent scheduling, workflow graphs, shared memory, task delegation, multi-agent planning, agent identity/trust.
- Undecided: scope and timing of the social-primitives layer (turns, shared context, personal-agent interaction) — research-frontier material, not product commitment.

## Brand Commitments

**Binding (confirmed 2026-08-10): the "gambiarra" identity — creative improvisation under constraints, with a Brazilian tone — governs product voice and communication** across docs, site, and TUI. "Gambi" is the short form of "gambiarra", meaning the good kind: improvisation turned into a practical tool.

Fixed assets: the name **Gambi**, package names (`gambi`, `gambi-sdk`, `gambi-tui`), the `gambi.sh` domain, the ASCII-art wordmark in the README, and the Gambiarra LLM Club (gambiarra.club) affiliation.

## Evidence on Hand

- Real adoption case study: `gambiarra-arena` (prof. Filipe Calegario) rebuilt the whole stack instead of adopting Gambi — root cause was substrate adoptability, not missing social primitives (he built 6 social games alone). Documented in `docs/product/research-direction.md`; related issues #54 and #55.
- Published packages on npm (`gambi`, `gambi-sdk`, `gambi-tui`) with a working install script at `gambi.sh`.
- Working end-to-end quick start (hub → room → participant → events → SDK inference) documented in `README.md`.
- No user testimonials, benchmarks against alternatives, or usage metrics exist — do not fabricate any.

## Product Principles

1. **Adoptability before orchestration.** The substrate must be trivially adoptable (onboarding, dev mode, "build on me" story) before the social layer has an audience.
2. **Tunnel-first, always.** Participation never requires the provider to be reachable; friction of joining a room stays near zero.
3. **Two planes, two optimizations.** Management surfaces serve automation (structured, scriptable); inference surfaces serve compatibility (OpenAI-compatible, AI SDK-ready).
4. **Lean hub, additive metadata.** Keep transport narrow; prefer additive metadata that a future orchestration layer can build on, never absorb orchestration early.
5. **Honest gambiarra.** Communicate with the improviser's spirit but never overpromise: no claims of orchestration, auth, or scale the hub does not have.
