/**
 * Finds a harness on this machine before the participant joins: is it
 * installed, and is it logged in. `resolveHarness` answers how to start it,
 * or fails with `HarnessNotReady`, whose message says what to install or
 * which login to run.
 *
 * Detection only looks: it runs the harness's own status commands and never
 * reads, stores or forwards a credential.
 */
import type { HarnessId } from "@gambi/protocol";
import {
  Config,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  type FakeHarnessCommand,
  fakeAgentPath,
  fakeHarnessCommand,
  type HarnessCommand,
  isCompiledBinary,
} from "./adapters.ts";

/** The harnesses that have an adapter. `pi` is in the schema and has none yet. */
export type SupportedHarnessId = Exclude<HarnessId, "pi">;

/** What a status command printed and how it exited. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

/** How long a harness's status command has to answer. */
const STATUS_COMMAND_TIMEOUT = Duration.seconds(15);

/**
 * What detection needs from the machine. A test replaces it with a double,
 * so no real harness has to be installed to test the guidance.
 */
export class HarnessTools extends Context.Service<
  HarnessTools,
  {
    /** Whether a file exists at `path`. */
    readonly exists: (path: string) => Effect.Effect<boolean>;
    /**
     * Runs a command to the end and collects what it printed. A command that
     * cannot start, or does not end in time, answers exit code 1.
     */
    readonly run: (
      command: string,
      args: readonly string[]
    ) => Effect.Effect<CommandResult>;
    /** The full path of a command on `PATH`, like `which`. */
    readonly which: (command: string) => Effect.Effect<string | undefined>;
  }
>()("gambi/core/HarnessTools") {
  static readonly layer = Layer.effect(
    HarnessTools,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const windows = path.sep === "\\";
      const variable = (name: string, fallback: string) =>
        Config.String(name).pipe(Effect.orElseSucceed(() => fallback));
      const searchPath = yield* variable("PATH", "");
      const extensions = windows
        ? [
            "",
            ...(yield* variable("PATHEXT", ".EXE;.CMD;.BAT;.COM")).split(";"),
          ]
        : [""];

      const isExecutable = (candidate: string) =>
        fs.stat(candidate).pipe(
          Effect.map(
            (info) =>
              info.type === "File" &&
              // biome-ignore lint/suspicious/noBitwiseOperators: the execute bits of a file mode.
              (windows || (info.mode & 0o111) !== 0)
          ),
          Effect.orElseSucceed(() => false)
        );

      const which = Effect.fn("HarnessTools.which")(function* (
        command: string
      ) {
        for (const directory of searchPath.split(windows ? ";" : ":")) {
          if (directory === "") {
            continue;
          }
          for (const extension of extensions) {
            const candidate = path.join(directory, `${command}${extension}`);
            if (yield* isExecutable(candidate)) {
              return candidate;
            }
          }
        }
        return undefined;
      });

      const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
        stream.pipe(Stream.decodeText(), Stream.mkString);

      const run = (command: string, args: readonly string[]) =>
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, [...args], {
              stdin: "ignore",
              forceKillAfter: "1 second",
            })
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
            { concurrency: "unbounded" }
          );
          return { stdout, stderr, exitCode: Number(exitCode) };
        }).pipe(
          Effect.scoped,
          Effect.timeoutOption(STATUS_COMMAND_TIMEOUT),
          Effect.map(
            Option.getOrElse(
              (): CommandResult => ({
                stdout: "",
                stderr: "The command did not finish in time.",
                exitCode: 1,
              })
            )
          ),
          Effect.catch((error) =>
            Effect.succeed<CommandResult>({
              stdout: "",
              stderr: String(error),
              exitCode: 1,
            })
          ),
          Effect.withSpan("HarnessTools.run", { attributes: { command } })
        );

      return HarnessTools.of({
        exists: (target) =>
          fs.exists(target).pipe(Effect.orElseSucceed(() => false)),
        run,
        which,
      });
    })
  );
}

/**
 * The harness cannot start on this machine yet.
 *
 * - `notInstalled`: the harness itself is missing.
 * - `adapterNotInstalled`: the harness is there, its ACP adapter is not.
 * - `notAuthenticated`: no local login or credentials were found.
 * - `hostedNotAllowed`: this harness may not be hosted for someone else.
 */
export class HarnessNotReady extends Schema.TaggedError<HarnessNotReady>()(
  "HarnessNotReady",
  {
    harness: Schema.String,
    problem: Schema.Literals([
      "notInstalled",
      "adapterNotInstalled",
      "notAuthenticated",
      "hostedNotAllowed",
    ]),
    /** What the status command said, or where the harness was looked for. */
    detail: Schema.optionalKey(Schema.String),
  }
) {
  override get message(): string {
    const said = this.detail === undefined ? "" : ` (${this.detail})`;
    const guidance: Record<string, string> = {
      "opencode notInstalled":
        "OpenCode is not installed. Install it from https://opencode.ai/docs and retry.",
      "opencode notAuthenticated":
        "OpenCode has no detected credentials. Run `opencode auth login` (or configure a provider API key) and retry.",
      "claude-code adapterNotInstalled":
        "The Claude Code ACP adapter is not installed. Run `npm install -g @agentclientprotocol/claude-agent-acp` and retry.",
      "claude-code notInstalled":
        "Claude Code is not installed. Run `npm install -g @anthropic-ai/claude-code`, then `claude auth login`, and retry.",
      "claude-code notAuthenticated": `Claude Code has no detected local login. Run \`claude auth login\` and retry.${said}`,
      "claude-code hostedNotAllowed":
        "Claude Code cannot run as a Gambi-hosted harness for third parties. Each end user must run the unmodified binary with their own local authentication.",
      "codex adapterNotInstalled":
        "The Codex ACP adapter is not installed. Run `npm install -g @agentclientprotocol/codex-acp` and retry.",
      "codex notInstalled":
        "Codex CLI is not installed. Run `npm install -g @openai/codex`, then `codex login`, and retry.",
      "codex notAuthenticated": `Codex has no detected local login. Run \`codex login\` and retry.${said}`,
      "fake notInstalled": `The deterministic fake ACP agent was not found at ${this.detail}. Pass a command that runs runFakeAcpAgent() to fakeHarnessCommand().`,
    };
    return (
      guidance[`${this.harness} ${this.problem}`] ??
      `Harness '${this.harness}' is not ready.`
    );
  }
}

/** A harness that can start: its command, and what the person should read first. */
export interface ResolvedHarness {
  readonly command: HarnessCommand;
  /** What always applies to this harness, such as its terms of use. */
  readonly notes: readonly string[];
  /** Set when detection could not confirm something and let the harness start anyway. */
  readonly warning?: string | undefined;
}

export interface ResolveHarnessOptions {
  /** The command of the fake agent, for a consumer whose bundle cannot find it. */
  readonly fake?: FakeHarnessCommand | undefined;
  /** `true` when the room host runs the harness for someone who brought none. */
  readonly hosted?: boolean | undefined;
}

const CLAUDE_TERMS_WARNING =
  "Warning: Claude Code must use the end user's own local authentication and the unmodified Anthropic binary. Gambi never intermediates Claude subscription login or hosts Claude Code for third parties. Review https://code.claude.com/docs/en/legal-and-compliance.";

const said = (result: CommandResult) => {
  const detail = result.stderr.trim();
  return detail === "" ? {} : { detail };
};

const OpenCodeProviders = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ connections: Schema.Array(Schema.Unknown) }))
);
const ClaudeAuthStatus = Schema.fromJsonString(
  Schema.Struct({ loggedIn: Schema.Boolean })
);

const resolveOpenCode = Effect.fnUntraced(function* () {
  const tools = yield* HarnessTools;
  const harness = "opencode";
  const executable = yield* tools.which("opencode");
  if (executable === undefined) {
    return yield* new HarnessNotReady({ harness, problem: "notInstalled" });
  }
  const resolved: ResolvedHarness = {
    command: { harness, command: executable, args: ["acp"] },
    notes: [],
  };
  const notAuthenticated = new HarnessNotReady({
    harness,
    problem: "notAuthenticated",
  });

  // OpenCode 1.x accepts `--pure` and marks each credential with ●.
  const legacy = yield* tools.run(executable, ["auth", "list", "--pure"]);
  if (legacy.exitCode === 0) {
    return legacy.stdout.includes("●") ? resolved : yield* notAuthenticated;
  }

  // OpenCode 2.x rejects `--pure`; its JSON lists each provider's connections
  // (stored credentials and provider keys found in the environment).
  const current = yield* tools.run(executable, [
    "auth",
    "list",
    "--format",
    "json",
  ]);
  const providers =
    current.exitCode === 0
      ? Schema.decodeUnknownOption(OpenCodeProviders)(current.stdout)
      : Option.none();
  if (Option.isSome(providers)) {
    return providers.value.some((provider) => provider.connections.length > 0)
      ? resolved
      : yield* notAuthenticated;
  }

  // Unknown output: starting with a warning beats blocking someone who is
  // logged in. A missing login then surfaces from OpenCode itself.
  const detail = current.exitCode === 0 ? "" : current.stderr.trim();
  return {
    ...resolved,
    warning: `Warning: Gambi could not confirm OpenCode credentials. If OpenCode is not logged in, run \`opencode auth login\`.${detail === "" ? "" : ` (${detail})`}`,
  };
});

const resolveClaudeCode = Effect.fnUntraced(function* (hosted: boolean) {
  const tools = yield* HarnessTools;
  const harness = "claude-code";
  if (hosted) {
    return yield* new HarnessNotReady({ harness, problem: "hostedNotAllowed" });
  }
  const adapter = yield* tools.which("claude-agent-acp");
  if (adapter === undefined) {
    return yield* new HarnessNotReady({
      harness,
      problem: "adapterNotInstalled",
    });
  }
  const claude = yield* tools.which("claude");
  if (claude === undefined) {
    return yield* new HarnessNotReady({ harness, problem: "notInstalled" });
  }
  const status = yield* tools.run(claude, ["auth", "status", "--json"]);
  const loggedIn = Schema.decodeUnknownOption(ClaudeAuthStatus)(
    status.stdout
  ).pipe(
    Option.map((parsed) => parsed.loggedIn),
    Option.getOrElse(() => false)
  );
  if (status.exitCode !== 0 || !loggedIn) {
    return yield* new HarnessNotReady({
      harness,
      problem: "notAuthenticated",
      ...said(status),
    });
  }
  const resolved: ResolvedHarness = {
    command: { harness, command: adapter, args: [] },
    notes: [CLAUDE_TERMS_WARNING],
  };
  return resolved;
});

const resolveCodex = Effect.fnUntraced(function* () {
  const tools = yield* HarnessTools;
  const harness = "codex";
  const adapter = yield* tools.which("codex-acp");
  if (adapter === undefined) {
    return yield* new HarnessNotReady({
      harness,
      problem: "adapterNotInstalled",
    });
  }
  const codex = yield* tools.which("codex");
  if (codex === undefined) {
    return yield* new HarnessNotReady({ harness, problem: "notInstalled" });
  }
  const status = yield* tools.run(codex, ["login", "status"]);
  if (status.exitCode !== 0) {
    return yield* new HarnessNotReady({
      harness,
      problem: "notAuthenticated",
      ...said(status),
    });
  }
  const resolved: ResolvedHarness = {
    command: { harness, command: adapter, args: [] },
    notes: [],
  };
  return resolved;
});

const resolveFake = Effect.fnUntraced(function* (
  override: FakeHarnessCommand | undefined
) {
  const tools = yield* HarnessTools;
  if (
    override === undefined &&
    !(isCompiledBinary() || (yield* tools.exists(fakeAgentPath())))
  ) {
    return yield* new HarnessNotReady({
      harness: "fake",
      problem: "notInstalled",
      detail: fakeAgentPath(),
    });
  }
  const resolved: ResolvedHarness = {
    command: fakeHarnessCommand(override),
    notes: ["Deterministic test agent; it does not call a model."],
  };
  return resolved;
});

/**
 * How to start a harness on this machine, after checking that it is
 * installed and logged in. Give the `command` to `Harness.layer`.
 */
export const resolveHarness = Effect.fn("Harness.resolve")(function* (
  harness: SupportedHarnessId,
  options: ResolveHarnessOptions = {}
): Effect.fn.Return<ResolvedHarness, HarnessNotReady, HarnessTools> {
  switch (harness) {
    case "opencode":
      return yield* resolveOpenCode();
    case "claude-code":
      return yield* resolveClaudeCode(options.hosted === true);
    case "codex":
      return yield* resolveCodex();
    default:
      return yield* resolveFake(options.fake);
  }
});
