/**
 * Prompts a visitor copies into their own coding agent (Claude Code, Codex,
 * OpenCode, Cursor...). The agent reads the docs through the `.md` routes
 * from starlight-dot-md, so each prompt links the plain-Markdown pages.
 *
 * Keep the commands in sync with reference/cli.mdx.
 */

const SITE = "https://gambi.sh";

const setupPromptEn = `Help me set up Gambi on this machine. Gambi is a hub that lets several people share their AI models and coding agents (Claude Code, Codex, OpenCode) on a trusted local network.

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

const setupPromptPt = `Me ajude a configurar o Gambi nesta máquina. O Gambi é um hub que permite que várias pessoas compartilhem seus modelos de IA e agentes de código (Claude Code, Codex, OpenCode) em uma rede local confiável. Responda em português.

Leia estas páginas primeiro. Elas estão em Markdown puro:
- ${SITE}/pt-br/start/introduction.md
- ${SITE}/pt-br/start/installation.md
- ${SITE}/pt-br/start/quickstart.md
- ${SITE}/pt-br/guides/bring-your-harness.md (só se eu for compartilhar Claude Code, Codex ou OpenCode)

Depois me guie um passo de cada vez, e pergunte antes de instalar qualquer coisa ou iniciar um processo que fica rodando:

1. Rode \`gambi --version\`. Se a CLI não estiver instalada, instale com o método deste sistema operacional descrito na página de instalação.
2. Pergunte se esta máquina vai rodar o hub ou entrar em um hub que já existe.
   - Vai rodar o hub: inicie \`gambi hub serve\` em um terminal próprio e me diga a URL que as outras máquinas devem usar (o IP desta máquina na rede local e a porta 3000).
   - Vai entrar: peça a URL do hub e passe com \`--hub\` daqui em diante.
3. Se eu ainda não tiver um código de room, crie uma room com \`gambi room create --name "<nome>" --no-interactive\` e me mostre o código.
4. Pergunte o que eu quero compartilhar:
   - Um modelo: procure um servidor compatível com OpenAI já rodando (Ollama em localhost:11434, LM Studio em localhost:1234, vLLM em localhost:8000), liste os modelos dele e entre com \`gambi participant join --room <código> --participant-id <id> --model <modelo> --endpoint <url>\`.
   - Um harness: confira se Claude Code, Codex ou OpenCode está instalado e logado, como descreve a página "Traga seu harness", e entre com \`gambi participant join --room <código> --participant-id <id> --harness <claude-code|codex|opencode>\`.
   O \`participant join\` fica em primeiro plano, então rode-o em um terminal próprio.
5. Prove que funciona:
   - \`curl http://<hub>/rooms/<código>/v1/models\` lista todos os participantes de modelo da room.
   - Para um modelo, envie \`curl -X POST http://<hub>/rooms/<código>/v1/responses -H "Content-Type: application/json" -d '{"model":"*","input":"Diga olá em uma frase."}'\` e me mostre a resposta.
   - Para um harness, confirme que a saída do join diz que a sessão ACP foi aberta (o evento \`session_opened\` com \`--format ndjson\`).

Regras:
- Nunca digite, mostre ou guarde minhas chaves de API. Se um provedor precisar de uma, peça para eu mesmo definir uma variável de ambiente (o valor é \`Bearer <chave>\`) e passe \`--header-env Authorization=<NOME_DA_VARIAVEL>\`.
- O hub não tem autenticação. Mantenha-o em uma rede em que eu confio e nunca o exponha à internet.
- Se um passo falhar, leia ${SITE}/pt-br/troubleshooting/common-issues.md antes de tentar outra coisa.`;

/** The setup prompt in the page's language. `locale` is Starlight's route locale. */
export const setupPrompt = (locale: string | undefined): string =>
  locale === "pt-br" ? setupPromptPt : setupPromptEn;
