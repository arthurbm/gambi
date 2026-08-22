import { fileURLToPath } from "node:url";
import type { HarnessParticipant } from "./types.ts";

export type SupportedHarnessId = Extract<
  HarnessParticipant["id"],
  "claude-code" | "codex" | "opencode" | "fake"
>;

export interface HarnessDetection {
  message?: string;
  ok: boolean;
}

export interface HarnessAdapter {
  args: readonly string[];
  command: string;
  detect: () => Promise<HarnessDetection>;
  id: SupportedHarnessId;
  notes: readonly string[];
}

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface HarnessDetectionTools {
  run: (command: string, args: readonly string[]) => Promise<CommandResult>;
  which: (command: string) => string | undefined;
}

const defaultDetectionTools: HarnessDetectionTools = {
  which: (command) => Bun.which(command) ?? undefined,
  run: async (command, args) => {
    const process = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  },
};

const CLAUDE_TERMS_WARNING =
  "Warning: Claude Code must use the end user's own local authentication and the unmodified Anthropic binary. Gambi never intermediates Claude subscription login or hosts Claude Code for third parties. Review https://code.claude.com/docs/en/legal-and-compliance.";

function commandFailureDetail(result: CommandResult): string {
  const detail = result.stderr.trim();
  return detail ? ` (${detail})` : "";
}

async function detectOpenCode(
  tools: HarnessDetectionTools
): Promise<HarnessDetection> {
  const executable = tools.which("opencode");
  if (!executable) {
    return {
      ok: false,
      message:
        "OpenCode is not installed. Install it from https://opencode.ai/docs and retry.",
    };
  }

  const result = await tools.run(executable, ["auth", "list", "--pure"]);
  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: `OpenCode authentication could not be checked. Run \`opencode auth login\` and retry.${commandFailureDetail(result)}`,
    };
  }

  if (!result.stdout.includes("●")) {
    return {
      ok: false,
      message:
        "OpenCode has no detected credentials. Run `opencode auth login` (or configure a provider API key) and retry.",
    };
  }

  return { ok: true };
}

async function detectClaudeCode(
  tools: HarnessDetectionTools
): Promise<HarnessDetection> {
  if (!tools.which("claude-agent-acp")) {
    return {
      ok: false,
      message:
        "The Claude Code ACP adapter is not installed. Run `npm install -g @agentclientprotocol/claude-agent-acp` and retry.",
    };
  }

  const claude = tools.which("claude");
  if (!claude) {
    return {
      ok: false,
      message:
        "Claude Code is not installed. Run `npm install -g @anthropic-ai/claude-code`, then `claude auth login`, and retry.",
    };
  }

  const result = await tools.run(claude, ["auth", "status", "--json"]);
  let loggedIn = false;
  try {
    const status = JSON.parse(result.stdout) as { loggedIn?: unknown };
    loggedIn = status.loggedIn === true;
  } catch {
    // Invalid or missing status output is handled by the actionable error below.
  }
  if (result.exitCode !== 0 || !loggedIn) {
    return {
      ok: false,
      message: `Claude Code has no detected local login. Run \`claude auth login\` and retry.${commandFailureDetail(result)}`,
    };
  }

  return { ok: true };
}

async function detectCodex(
  tools: HarnessDetectionTools
): Promise<HarnessDetection> {
  if (!tools.which("codex-acp")) {
    return {
      ok: false,
      message:
        "The Codex ACP adapter is not installed. Run `npm install -g @agentclientprotocol/codex-acp` and retry.",
    };
  }

  const codex = tools.which("codex");
  if (!codex) {
    return {
      ok: false,
      message:
        "Codex CLI is not installed. Run `npm install -g @openai/codex`, then `codex login`, and retry.",
    };
  }

  const result = await tools.run(codex, ["login", "status"]);
  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: `Codex has no detected local login. Run \`codex login\` and retry.${commandFailureDetail(result)}`,
    };
  }

  return { ok: true };
}

function fakeAgentPath(): string {
  return fileURLToPath(new URL("./fake-acp-agent.ts", import.meta.url));
}

export function getHarnessAdapter(
  id: SupportedHarnessId,
  tools: HarnessDetectionTools = defaultDetectionTools
): HarnessAdapter {
  if (id === "opencode") {
    return {
      id,
      command: tools.which("opencode") ?? "opencode",
      args: ["acp"],
      detect: () => detectOpenCode(tools),
      notes: [],
    };
  }

  if (id === "claude-code") {
    return {
      id,
      command: tools.which("claude-agent-acp") ?? "claude-agent-acp",
      args: [],
      detect: () => detectClaudeCode(tools),
      notes: [CLAUDE_TERMS_WARNING],
    };
  }

  if (id === "codex") {
    return {
      id,
      command: tools.which("codex-acp") ?? "codex-acp",
      args: [],
      detect: () => detectCodex(tools),
      notes: [],
    };
  }

  const scriptPath = fakeAgentPath();
  const isCompiledBinary = scriptPath.includes("$bunfs");
  return {
    id,
    command: isCompiledBinary
      ? process.execPath
      : (Bun.which("bun") ?? process.execPath),
    args: isCompiledBinary ? ["__fake-acp-agent"] : [scriptPath],
    detect: async () => {
      if (!(isCompiledBinary || (await Bun.file(scriptPath).exists()))) {
        return {
          ok: false,
          message: `The deterministic fake ACP agent was not found at ${scriptPath}.`,
        };
      }
      return { ok: true };
    },
    notes: ["Deterministic test agent; it does not call a model."],
  };
}
