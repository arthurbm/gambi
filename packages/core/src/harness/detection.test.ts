/**
 * What a person reads when a harness is not installed or not logged in. The
 * machine is a double (`HarnessTools`): no real harness runs here.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { it } from "@gambi/testing/effect";
import { Effect, Layer } from "effect";
import {
  type CommandResult,
  HarnessTools,
  resolveHarness,
} from "./detection.ts";

const ok = (stdout: string): CommandResult => ({
  exitCode: 0,
  stderr: "",
  stdout,
});

/**
 * A machine with the given commands installed. Each status command answers
 * what `responses` says for its arguments, or fails.
 */
const machine = (options: {
  readonly installed?: readonly string[];
  readonly responses?: Record<string, CommandResult>;
}) => {
  const calls: string[] = [];
  const installed = new Set(options.installed ?? []);
  return {
    calls,
    tools: Layer.succeed(
      HarnessTools,
      HarnessTools.of({
        exists: () => Effect.succeed(false),
        which: (command) =>
          Effect.succeed(
            installed.has(command) ? `/test/bin/${command}` : undefined
          ),
        run: (_command, args) =>
          Effect.sync(() => {
            const key = args.join(" ");
            calls.push(key);
            return (
              options.responses?.[key] ?? {
                exitCode: 1,
                stderr: `Unrecognized flag in ${key}`,
                stdout: "",
              }
            );
          }),
      })
    ),
  };
};

const messageOf = (
  harness: Parameters<typeof resolveHarness>[0],
  on: ReturnType<typeof machine>,
  options?: Parameters<typeof resolveHarness>[1]
) =>
  resolveHarness(harness, options).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
    Effect.provide(on.tools)
  );

it.effect(
  "Claude Code starts through its published ACP adapter, with the terms note",
  () =>
    Effect.gen(function* () {
      const resolved = yield* resolveHarness("claude-code").pipe(
        Effect.provide(
          machine({
            installed: ["claude-agent-acp", "claude"],
            responses: { "auth status --json": ok('{"loggedIn":true}') },
          }).tools
        )
      );

      expect(resolved.command).toEqual({
        harness: "claude-code",
        command: "/test/bin/claude-agent-acp",
        args: [],
      });
      expect(resolved.notes.join(" ")).toContain(
        "never intermediates Claude subscription login or hosts Claude Code"
      );
    })
);

it.effect(
  "Claude Code that is missing a piece or a login says what to run",
  () =>
    Effect.gen(function* () {
      expect(
        yield* messageOf("claude-code", machine({ installed: ["claude"] }))
      ).toBe(
        "The Claude Code ACP adapter is not installed. Run `npm install -g @agentclientprotocol/claude-agent-acp` and retry."
      );
      expect(
        yield* messageOf(
          "claude-code",
          machine({ installed: ["claude-agent-acp"] })
        )
      ).toBe(
        "Claude Code is not installed. Run `npm install -g @anthropic-ai/claude-code`, then `claude auth login`, and retry."
      );
      expect(
        yield* messageOf(
          "claude-code",
          machine({
            installed: ["claude-agent-acp", "claude"],
            responses: { "auth status --json": ok('{"loggedIn":false}') },
          })
        )
      ).toBe(
        "Claude Code has no detected local login. Run `claude auth login` and retry."
      );
      expect(
        yield* messageOf(
          "claude-code",
          machine({
            installed: ["claude-agent-acp", "claude"],
            responses: {
              "auth status --json": {
                exitCode: 1,
                stderr: "not logged in\n",
                stdout: "",
              },
            },
          })
        )
      ).toBe(
        "Claude Code has no detected local login. Run `claude auth login` and retry. (not logged in)"
      );
    })
);

it.effect("Claude Code is never hosted for someone else", () =>
  Effect.gen(function* () {
    expect(
      yield* messageOf(
        "claude-code",
        machine({ installed: ["claude-agent-acp", "claude"] }),
        { hosted: true }
      )
    ).toBe(
      "Claude Code cannot run as a Gambi-hosted harness for third parties. Each end user must run the unmodified binary with their own local authentication."
    );
  })
);

it.effect(
  "Codex starts through its published ACP adapter when it is logged in",
  () =>
    Effect.gen(function* () {
      const resolved = yield* resolveHarness("codex").pipe(
        Effect.provide(
          machine({
            installed: ["codex-acp", "codex"],
            responses: { "login status": ok("Logged in using ChatGPT") },
          }).tools
        )
      );

      expect(resolved.command).toEqual({
        harness: "codex",
        command: "/test/bin/codex-acp",
        args: [],
      });
    })
);

it.effect("Codex that is missing a piece or a login says what to run", () =>
  Effect.gen(function* () {
    expect(yield* messageOf("codex", machine({ installed: ["codex"] }))).toBe(
      "The Codex ACP adapter is not installed. Run `npm install -g @agentclientprotocol/codex-acp` and retry."
    );
    expect(
      yield* messageOf("codex", machine({ installed: ["codex-acp"] }))
    ).toBe(
      "Codex CLI is not installed. Run `npm install -g @openai/codex`, then `codex login`, and retry."
    );
    expect(
      yield* messageOf(
        "codex",
        machine({
          installed: ["codex-acp", "codex"],
          responses: {
            "login status": { exitCode: 1, stderr: "", stdout: "" },
          },
        })
      )
    ).toBe("Codex has no detected local login. Run `codex login` and retry.");
  })
);

// Real `opencode auth list --format json` output from OpenCode 2.2.7.
const OPENCODE_2_STORED = JSON.stringify([
  {
    id: "anthropic",
    name: "Anthropic",
    connections: [
      { type: "credential", id: "cred_1", label: "OAuth", method: "oauth" },
    ],
  },
]);
const OPENCODE_2_ENVIRONMENT = JSON.stringify([
  {
    id: "anthropic",
    name: "Anthropic",
    connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }],
  },
]);
const NO_PURE_FLAG: CommandResult = {
  exitCode: 1,
  stderr: "ERROR\n  Unrecognized flag: --pure in command opencode auth list",
  stdout: "",
};
const NO_CREDENTIALS =
  "OpenCode has no detected credentials. Run `opencode auth login` (or configure a provider API key) and retry.";

it.effect("OpenCode that is not installed says where to get it", () =>
  Effect.gen(function* () {
    expect(yield* messageOf("opencode", machine({}))).toBe(
      "OpenCode is not installed. Install it from https://opencode.ai/docs and retry."
    );
  })
);

it.effect(
  "OpenCode 2.x is accepted with stored credentials or a provider key from the environment",
  () =>
    Effect.gen(function* () {
      const stored = machine({
        installed: ["opencode"],
        responses: {
          "auth list --pure": NO_PURE_FLAG,
          "auth list --format json": ok(OPENCODE_2_STORED),
        },
      });
      const resolved = yield* resolveHarness("opencode").pipe(
        Effect.provide(stored.tools)
      );
      expect(resolved).toEqual({
        command: {
          harness: "opencode",
          command: "/test/bin/opencode",
          args: ["acp"],
        },
        notes: [],
      });
      expect(stored.calls).toEqual([
        "auth list --pure",
        "auth list --format json",
      ]);

      const fromEnvironment = yield* resolveHarness("opencode").pipe(
        Effect.provide(
          machine({
            installed: ["opencode"],
            responses: {
              "auth list --pure": NO_PURE_FLAG,
              "auth list --format json": ok(OPENCODE_2_ENVIRONMENT),
            },
          }).tools
        )
      );
      expect(fromEnvironment.warning).toBeUndefined();
    })
);

it.effect("OpenCode 2.x without credentials asks for opencode auth login", () =>
  Effect.gen(function* () {
    expect(
      yield* messageOf(
        "opencode",
        machine({
          installed: ["opencode"],
          responses: {
            "auth list --pure": NO_PURE_FLAG,
            "auth list --format json": ok("[]\n"),
          },
        })
      )
    ).toBe(NO_CREDENTIALS);
  })
);

it.effect("older OpenCode is still read through --pure and its ● marks", () =>
  Effect.gen(function* () {
    const loggedIn = machine({
      installed: ["opencode"],
      responses: { "auth list --pure": ok("●  Anthropic oauth\n") },
    });
    yield* resolveHarness("opencode").pipe(Effect.provide(loggedIn.tools));
    expect(loggedIn.calls).toEqual(["auth list --pure"]);

    expect(
      yield* messageOf(
        "opencode",
        machine({
          installed: ["opencode"],
          responses: {
            "auth list --pure": ok(
              "Credentials ~/.local/share/opencode/auth.json\n"
            ),
          },
        })
      )
    ).toBe(NO_CREDENTIALS);
  })
);

it.effect(
  "OpenCode whose output is not recognized starts with a warning instead of being blocked",
  () =>
    Effect.gen(function* () {
      const unknown = yield* resolveHarness("opencode").pipe(
        Effect.provide(
          machine({
            installed: ["opencode"],
            responses: {
              "auth list --pure": NO_PURE_FLAG,
              "auth list --format json": ok("Anthropic  OAuth  stored\n"),
            },
          }).tools
        )
      );
      expect(unknown.warning).toBe(
        "Warning: Gambi could not confirm OpenCode credentials. If OpenCode is not logged in, run `opencode auth login`."
      );

      const failing = yield* resolveHarness("opencode").pipe(
        Effect.provide(
          machine({
            installed: ["opencode"],
            responses: { "auth list --pure": NO_PURE_FLAG },
          }).tools
        )
      );
      expect(failing.warning).toBe(
        "Warning: Gambi could not confirm OpenCode credentials. If OpenCode is not logged in, run `opencode auth login`. (Unrecognized flag in auth list --format json)"
      );
    })
);

it.effect("the fake harness that cannot be found says how to point at it", () =>
  Effect.gen(function* () {
    const message = yield* messageOf("fake", machine({}));
    expect(message).toStartWith(
      "The deterministic fake ACP agent was not found at "
    );
    expect(message).toEndWith(
      "fake-acp-agent.ts. Pass a command that runs runFakeAcpAgent() to fakeHarnessCommand()."
    );

    const given = yield* resolveHarness("fake", {
      fake: { command: "bun", args: ["scripts/fake-acp-agent.ts"] },
    }).pipe(Effect.provide(machine({}).tools));
    expect(given.command).toEqual({
      harness: "fake",
      command: "bun",
      args: ["scripts/fake-acp-agent.ts"],
    });
  })
);

// The one test here that touches the machine: `HarnessTools.layer` itself.
it.live(
  "on a real machine, finds a command on PATH, runs it, and survives one that does not exist",
  () =>
    Effect.gen(function* () {
      const tools = yield* HarnessTools;

      const bun = yield* tools.which("bun");
      expect(bun).toBeDefined();
      expect(yield* tools.which("gambi-no-such-command")).toBeUndefined();

      const version = yield* tools.run(bun ?? "bun", ["--version"]);
      expect(version.exitCode).toBe(0);
      expect(version.stdout.trim()).toBe(Bun.version);

      const missing = yield* tools.run("gambi-no-such-command", []);
      expect(missing.exitCode).toBe(1);

      const resolved = yield* resolveHarness("fake");
      expect(resolved.notes).toEqual([
        "Deterministic test agent; it does not call a model.",
      ]);
    }).pipe(
      Effect.provide(HarnessTools.layer.pipe(Layer.provide(BunServices.layer)))
    )
);
