/**
 * How each supported harness is started. Detection of what is installed and
 * logged in lives in `./detection.ts`.
 */
import { fileURLToPath } from "node:url";
import type { HarnessId } from "@gambi/protocol";

/** The command that starts a harness speaking ACP over its stdio. */
export interface HarnessCommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly harness: HarnessId;
}

/** A command that runs the deterministic fake ACP agent (`runFakeAcpAgent`). */
export interface FakeHarnessCommand {
  readonly args?: readonly string[] | undefined;
  readonly command: string;
}

/** Where the fake ACP agent's source is, when this code runs from source. */
export const fakeAgentPath = (): string =>
  fileURLToPath(new URL("../fake-acp-agent.ts", import.meta.url));

/** Inside a compiled `gambi` binary the sources live in Bun's virtual filesystem. */
export const isCompiledBinary = (): boolean =>
  fakeAgentPath().includes("$bunfs");

/**
 * The command of the `fake` harness: the deterministic ACP agent, for tests
 * that must not call a model. From source and inside the compiled `gambi`
 * binary it finds the agent on its own. A bundled consumer (a `gambi-sdk`
 * user) passes a command that runs `runFakeAcpAgent()`, for example
 * `{ command: "bun", args: ["scripts/fake-acp-agent.ts"] }`.
 */
export const fakeHarnessCommand = (
  override?: FakeHarnessCommand
): HarnessCommand => {
  if (override !== undefined) {
    return {
      harness: "fake",
      command: override.command,
      args: override.args ?? [],
    };
  }
  return {
    harness: "fake",
    command: process.execPath,
    args: isCompiledBinary() ? ["__fake-acp-agent"] : [fakeAgentPath()],
  };
};
