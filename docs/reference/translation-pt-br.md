# Translating the docs into Brazilian Portuguese

Rules for writing or updating a page under `apps/docs/src/content/docs/pt-br/`, a landing string in `apps/docs/src/content/i18n/pt-BR.json`, or the Portuguese setup prompt in `apps/docs/src/prompts.ts`. The Portuguese page mirrors its English source at the same path: same headings in the same order, same facts, same code.

Tone: direct technical Brazilian Portuguese, short sentences, active voice, "você", full accents. Rewrite a sentence until it reads naturally; never add or drop information.

## Terms

Kept in English (product names, domain terms with no good Portuguese word, and anything that is also an identifier):

| Term | In Portuguese prose |
|---|---|
| hub | "o hub" |
| harness | "o harness", "os harnesses"; *harness participant* is "participante de harness" |
| workspace | "o workspace" |
| endpoint | "o endpoint"; *provider endpoint* is "endpoint do provedor" |
| heartbeat, ping/pong, bootstrap token, tunnel-first | as is |
| SDK, CLI, API, SSE, WebSocket, mDNS, ACP, JSON, NDJSON, Responses API, Chat Completions, prompt, streaming, runtime | as is ("a CLI", "o SDK", "a API") |
| Product names: Gambi, Claude Code, Codex, OpenCode, Ollama, LM Studio, vLLM, OpenRouter, AI SDK, Pele, Starlight | as is |

Translated:

| English | Portuguese |
|---|---|
| room | sala ("a sala", "código da sala"); the CLI and API keep `room` (`gambi room create`, `--room`, `/rooms/:code`) |
| participant | participante (`participantId` and `--participant-id` stay) |
| provider | provedor |
| model | modelo |
| tunnel | túnel |
| your app | seu app |
| trusted network | rede confiável; the caution title is "Somente redes confiáveis" |
| management plane / inference plane | "plano de gerenciamento (management plane)" and "plano de inferência (inference plane)" on first mention |
| Management API / Inference API | API de gerenciamento / API de inferência |
| model selector | seletor de modelo |
| artifact | artefato |
| request / response | requisição / resposta |
| quick start | início rápido |

On the landing, "agents" is "agentes" (marketing copy may say agents; docs say harness).

## Markup

- **Code blocks stay byte-identical.** Only `#` and `//` comments are translated. Commands, flags, routes, event names, JSON keys, and example values (`ABC123`, `joao-1`) never change.
- **Mermaid:** translate labels, edge labels, notes, and the `title="..."` caption. Keep node ids, `participant X as` identifiers, `:::model`/`:::harness`/`:::hub` classes, `classDef` lines, and message or route names. Keep labels short and break long ones with `<br/>`.
- **Internal links** get the `/pt-br` prefix: `/start/quickstart/` becomes `/pt-br/start/quickstart/`. External links stay.
- **Anchors** come from the translated heading (github-slugger: lowercase, spaces to `-`, punctuation dropped, accents kept). When you translate a heading that something links to, update those links. Headings that are code (`` ## `gambi hub serve` ``) and headings with an explicit `<a id="...">` keep their anchor.
- **MDX imports** are one directory deeper, so relative imports gain a `../`. Package imports (`@astrojs/starlight/components`) stay.
- **Frontmatter:** translate `title`, `description`, and `sidebar.label`. Keep everything else.
- **Landing strings** must be about as long as the English. The hero, the inventory, the comparison grid, and the SVG labels have no room to re-wrap; check them at 1440, 1024, and 390px.
