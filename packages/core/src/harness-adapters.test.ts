import { describe, expect, test } from "bun:test";
import {
  getHarnessAdapter,
  type HarnessDetectionTools,
} from "./harness-adapters.ts";

function detectionTools(options: {
  available?: string[];
  exitCode?: number;
  stderr?: string;
  stdout?: string;
}): HarnessDetectionTools {
  const available = new Set(options.available ?? []);
  return {
    which: (command) =>
      available.has(command) ? `/test/bin/${command}` : undefined,
    run: async () => ({
      exitCode: options.exitCode ?? 0,
      stderr: options.stderr ?? "",
      stdout: options.stdout ?? "",
    }),
  };
}

describe("harness adapters", () => {
  test("configures Claude Code's published ACP executable and terms warning", async () => {
    const adapter = getHarnessAdapter(
      "claude-code",
      detectionTools({
        available: ["claude-agent-acp", "claude"],
        stdout: JSON.stringify({ loggedIn: true }),
      })
    );

    expect(adapter).toMatchObject({
      id: "claude-code",
      command: "/test/bin/claude-agent-acp",
      args: [],
    });
    expect(adapter.notes.join(" ")).toContain(
      "never intermediates Claude subscription login or hosts Claude Code"
    );
    await expect(adapter.detect()).resolves.toEqual({ ok: true });
  });

  test("gives actionable Claude Code installation and login guidance", async () => {
    const missingAdapter = getHarnessAdapter(
      "claude-code",
      detectionTools({ available: ["claude"] })
    );
    await expect(missingAdapter.detect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "npm install -g @agentclientprotocol/claude-agent-acp"
      ),
    });

    const missingLogin = getHarnessAdapter(
      "claude-code",
      detectionTools({
        available: ["claude-agent-acp", "claude"],
        stdout: JSON.stringify({ loggedIn: false }),
      })
    );
    await expect(missingLogin.detect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("claude auth login"),
    });
  });

  test("configures Codex's published ACP executable and checks local login", async () => {
    const adapter = getHarnessAdapter(
      "codex",
      detectionTools({
        available: ["codex-acp", "codex"],
        stdout: "Logged in using ChatGPT",
      })
    );

    expect(adapter).toMatchObject({
      id: "codex",
      command: "/test/bin/codex-acp",
      args: [],
    });
    await expect(adapter.detect()).resolves.toEqual({ ok: true });
  });

  test("gives actionable Codex installation and login guidance", async () => {
    const missingAdapter = getHarnessAdapter(
      "codex",
      detectionTools({ available: ["codex"] })
    );
    await expect(missingAdapter.detect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "npm install -g @agentclientprotocol/codex-acp"
      ),
    });

    const missingLogin = getHarnessAdapter(
      "codex",
      detectionTools({
        available: ["codex-acp", "codex"],
        exitCode: 1,
      })
    );
    await expect(missingLogin.detect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("codex login"),
    });
  });
});
