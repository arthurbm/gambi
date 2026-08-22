import { fileURLToPath } from "node:url";
import type { HarnessParticipant } from "./types.ts";

export type SupportedHarnessId = Extract<
  HarnessParticipant["id"],
  "opencode" | "fake"
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

async function detectOpenCode(): Promise<HarnessDetection> {
  const executable = Bun.which("opencode");
  if (!executable) {
    return {
      ok: false,
      message:
        "OpenCode is not installed. Install it from https://opencode.ai/docs and retry.",
    };
  }

  const process = Bun.spawn([executable, "auth", "list", "--pure"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    return {
      ok: false,
      message: `OpenCode authentication could not be checked. Run \`opencode auth login\` and retry.${stderr.trim() ? ` (${stderr.trim()})` : ""}`,
    };
  }

  if (!stdout.includes("●")) {
    return {
      ok: false,
      message:
        "OpenCode has no detected credentials. Run `opencode auth login` (or configure a provider API key) and retry.",
    };
  }

  return { ok: true };
}

function fakeAgentPath(): string {
  return fileURLToPath(new URL("./fake-acp-agent.ts", import.meta.url));
}

export function getHarnessAdapter(id: SupportedHarnessId): HarnessAdapter {
  if (id === "opencode") {
    return {
      id,
      command: Bun.which("opencode") ?? "opencode",
      args: ["acp"],
      detect: detectOpenCode,
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
