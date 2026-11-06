/**
 * Prompts a visitor copies into their own coding agent (Claude Code, Codex,
 * OpenCode, Cursor...). The agent reads the docs through the `.md` routes
 * from starlight-dot-md, so each prompt links the plain-Markdown pages.
 *
 * Keep the commands in sync with reference/cli.mdx.
 */

const SITE = "https://gambi.sh";

export const setupPrompt = `Help me set up Gambi on this machine. Gambi is a hub that lets several people share their AI models and coding agents (Claude Code, Codex, OpenCode) on a trusted local network.

Read these pages first. They are plain Markdown:
- ${SITE}/start/introduction.md
- ${SITE}/start/installation.md
- ${SITE}/start/quickstart.md
- ${SITE}/guides/bring-your-harness.md (only if I share Claude Code, Codex, or OpenCode)

Then guide me one step at a time, and ask before you install anything or start a long-running process:

1. Run \`gambi --version\`. If the CLI is missing, install it with the method for this OS from the installation page.
2. Ask me whether this machine runs the hub or joins a hub that already exists.
   - Runs the hub: start \`gambi hub serve\` in its own terminal, then tell me the URL other machines should use (this machine's LAN IP and port 3000).
   - Joins: ask me for the hub URL and pass it as \`--hub\` from now on.
3. If I don't have a room code yet, create a room with \`gambi room create --name "<name>" --no-interactive\` and show me the code.
4. Ask me what I want to share:
   - A model: look for an OpenAI-compatible server already running (Ollama on localhost:11434, LM Studio on localhost:1234, vLLM on localhost:8000), list its models, and join with \`gambi participant join --room <code> --participant-id <id> --model <model> --endpoint <url>\`.
   - A harness: check that Claude Code, Codex, or OpenCode is installed and logged in, as the bring-your-harness page describes, then join with \`gambi participant join --room <code> --participant-id <id> --harness <claude-code|codex|opencode>\`.
   \`participant join\` stays in the foreground, so run it in its own terminal.
5. Prove it works:
   - \`curl http://<hub>/rooms/<code>/v1/models\` lists every model participant in the room.
   - For a model, send \`curl -X POST http://<hub>/rooms/<code>/v1/responses -H "Content-Type: application/json" -d '{"model":"*","input":"Say hello in one sentence."}'\` and show me the answer.
   - For a harness, confirm that the join output says the ACP session opened (the \`session_opened\` event with \`--format ndjson\`).

Rules:
- Never type, print, or store my API keys. If a provider needs one, ask me to set an environment variable myself (its value is \`Bearer <key>\`), then pass \`--header-env Authorization=<VARIABLE_NAME>\`.
- The hub has no authentication. Keep it on a network I trust and never expose it to the internet.
- If a step fails, read ${SITE}/troubleshooting/common-issues.md before trying something else.`;
