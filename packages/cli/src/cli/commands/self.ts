import { Config, Effect, Option, Schema } from "effect";
import { Command, Flag, Prompt, TerminalCapabilities } from "effect/cli";
import { Installation } from "../installation.ts";
import { Output } from "../output.ts";
import { applyStandaloneUpdate, runPackageManager } from "../update.ts";
import {
  DEFAULT_RELEASE_BASE_URL,
  PACKAGE_MANAGERS,
  resolveUpdatePlan,
} from "../update-plan.ts";

/** Nothing tells whether a package manager or the install script put gambi here. */
export class UnknownInstallSource extends Schema.TaggedError<UnknownInstallSource>()(
  "UnknownInstallSource",
  { execPath: Schema.String }
) {
  override get message(): string {
    return "Could not tell how this gambi was installed.";
  }

  get hint(): string {
    return "Run it again with --manager bun or --manager npm.";
  }
}

const environment = Config.all({
  /** Overrides where the binaries of the release are downloaded from. */
  releaseBaseUrl: Config.String("GAMBI_UPDATE_BASE_URL").pipe(
    Config.withDefault(DEFAULT_RELEASE_BASE_URL)
  ),
  userAgent: Config.option(Config.String("npm_config_user_agent")),
});

const update = Command.make(
  "update",
  {
    manager: Flag.String("manager").pipe(
      Flag.withMetavar(PACKAGE_MANAGERS.join("|")),
      Flag.withDescription(
        "Package manager to update with, instead of detecting how gambi was installed"
      ),
      Flag.map((value) => value.trim().toLowerCase()),
      Flag.withSchema(
        Schema.String.pipe(Schema.decodeTo(Schema.Literals(PACKAGE_MANAGERS)))
      ),
      Flag.optional
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription("Update without asking for confirmation"),
      Flag.withDefault(false)
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print the update plan without running it"),
      Flag.withDefault(false)
    ),
  },
  Effect.fn("self.update")(function* ({ dryRun, manager, yes }) {
    const output = yield* Output;
    const installation = yield* Installation;
    const { releaseBaseUrl, userAgent } = yield* environment.pipe(Effect.orDie);
    const plan = resolveUpdatePlan({
      installation,
      manager: Option.getOrUndefined(manager),
      releaseBaseUrl,
      userAgent: Option.getOrUndefined(userAgent),
    });
    if (plan === undefined) {
      return yield* new UnknownInstallSource({
        execPath: installation.execPath,
      });
    }
    if (dryRun) {
      return yield* output.result({ plan }, () => `Would run: ${plan.command}`);
    }

    // The question is for a person at a terminal. A program that calls
    // `self update` has already decided.
    const { canPrompt } = yield* TerminalCapabilities.TerminalCapabilities;
    if (canPrompt && !yes) {
      const confirmed = yield* Prompt.run(
        Prompt.Confirm({
          message: `Update now? (${plan.command})`,
          initial: true,
        })
      ).pipe(Effect.catchTag("QuitError", () => Effect.succeed(false)));
      if (!confirmed) {
        return yield* output.result(
          { plan, cancelled: true },
          () => "Update cancelled."
        );
      }
    }

    if (plan.kind === "standalone") {
      const result = yield* applyStandaloneUpdate(plan);
      return yield* output.result({ plan, result }, () => "Update finished.");
    }
    const result = yield* runPackageManager(plan, {
      capture: output.format !== "text",
    });
    yield* output.result({ plan, result }, () => "Update finished.");
  })
).pipe(
  Command.withDescription(
    "Update gambi the way it was installed: with bun, with npm, or by replacing the standalone binary"
  ),
  Command.withExamples([
    {
      command: "gambi self update --dry-run",
      description: "Show how this gambi would be updated",
    },
    {
      command: "gambi self update --yes",
      description: "Update without the confirmation question",
    },
  ])
);

export const self = Command.make("self").pipe(
  Command.withDescription("Manage this installation of gambi"),
  Command.withSubcommands([update])
);
