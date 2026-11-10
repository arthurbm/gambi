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

interface Result {
  exitCode: number;
  stderr: string;
  stdout: string;
}

describe("OpenCode detection", () => {
  // Real `opencode auth list --format json` output from OpenCode 2.2.7.
  const OPENCODE_2_JSON = JSON.stringify([
    {
      id: "anthropic",
      name: "Anthropic",
      connections: [
        { type: "credential", id: "cred_1", label: "OAuth", method: "oauth" },
      ],
    },
  ]);
  const OPENCODE_2_ENV_JSON = JSON.stringify([
    {
      id: "anthropic",
      name: "Anthropic",
      connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }],
    },
  ]);
  const UNRECOGNIZED_PURE = {
    exitCode: 1,
    stderr: "ERROR\n  Unrecognized flag: --pure in command opencode auth list",
    stdout: "",
  };

  function openCodeTools(responses: Record<string, Result>) {
    const calls: string[] = [];
    const tools: HarnessDetectionTools = {
      which: (command) =>
        command === "opencode" ? "/test/bin/opencode" : undefined,
      run: (_command, args) => {
        const key = args.join(" ");
        calls.push(key);
        return Promise.resolve(
          responses[key] ?? {
            exitCode: 1,
            stderr: `Unrecognized flag in ${key}`,
            stdout: "",
          }
        );
      },
    };
    return { calls, tools };
  }

  function ok(stdout: string): Result {
    return { exitCode: 0, stderr: "", stdout };
  }

  test("accepts OpenCode 2.x with stored credentials", async () => {
    const { calls, tools } = openCodeTools({
      "auth list --pure": UNRECOGNIZED_PURE,
      "auth list --format json": ok(OPENCODE_2_JSON),
    });
    await expect(
      getHarnessAdapter("opencode", tools).detect()
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["auth list --pure", "auth list --format json"]);
  });

  test("accepts OpenCode 2.x with a provider key from the environment", async () => {
    const { tools } = openCodeTools({
      "auth list --pure": UNRECOGNIZED_PURE,
      "auth list --format json": ok(OPENCODE_2_ENV_JSON),
    });
    await expect(
      getHarnessAdapter("opencode", tools).detect()
    ).resolves.toEqual({ ok: true });
  });

  test("asks for opencode auth login when OpenCode 2.x has no credentials", async () => {
    const { tools } = openCodeTools({
      "auth list --pure": UNRECOGNIZED_PURE,
      "auth list --format json": ok("[]\n"),
    });
    await expect(
      getHarnessAdapter("opencode", tools).detect()
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("opencode auth login"),
    });
  });

  test("keeps detecting older OpenCode through --pure and ●", async () => {
    const { calls, tools } = openCodeTools({
      "auth list --pure": ok("●  Anthropic oauth\n"),
    });
    await expect(
      getHarnessAdapter("opencode", tools).detect()
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["auth list --pure"]);

    const loggedOut = openCodeTools({
      "auth list --pure": ok("Credentials ~/.local/share/opencode/auth.json\n"),
    });
    await expect(
      getHarnessAdapter("opencode", loggedOut.tools).detect()
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("opencode auth login"),
    });
  });

  test("lets the harness start with a warning when no known output is recognized", async () => {
    const { tools } = openCodeTools({
      "auth list --pure": UNRECOGNIZED_PURE,
      "auth list --format json": ok("Anthropic  OAuth  stored\n"),
    });
    await expect(
      getHarnessAdapter("opencode", tools).detect()
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining("could not confirm"),
    });

    const failing = openCodeTools({ "auth list --pure": UNRECOGNIZED_PURE });
    await expect(
      getHarnessAdapter("opencode", failing.tools).detect()
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining("could not confirm"),
    });
  });
});
