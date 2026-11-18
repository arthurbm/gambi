/**
 * The `fake` harness: a deterministic ACP agent that calls no model, for
 * testing a harness participant without spending one.
 *
 * `runFakeAcpAgent` is the agent itself, as a function a program can run. A
 * harness is a subprocess, so the session needs a command that runs it:
 * `ownFakeAgentCommand` is that command when this module can be loaded from
 * its own file.
 */
export { runFakeAcpAgent } from "@gambi/core/fake-acp-agent";

/** A command that runs `runFakeAcpAgent()`, speaking ACP over its stdio. */
export interface FakeAgentCommand {
  readonly args?: readonly string[] | undefined;
  readonly command: string;
}

/**
 * This module as the SDK ships it (`dist/participant.js`) or as its source.
 * Anywhere else it was bundled into another program, and loading that file
 * in a subprocess would run that program again.
 */
const OWN_FILE = /[\\/](?:dist[\\/]participant\.js|src[\\/]fake-harness\.ts)$/;

/**
 * The command that runs the fake agent from this very file, or nothing when
 * this module was bundled into another program: such a program passes a
 * command of its own (`fakeAgentCommand`).
 */
export const ownFakeAgentCommand = (): FakeAgentCommand | undefined =>
  OWN_FILE.test(new URL(import.meta.url).pathname)
    ? {
        command: process.execPath,
        args: [
          "-e",
          `import(${JSON.stringify(import.meta.url)}).then((entry) => entry.runFakeAcpAgent())`,
        ],
      }
    : undefined;
