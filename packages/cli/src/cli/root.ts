/**
 * The command tree of `gambi`. A new command lives in `commands/`, under the
 * group of its resource (ADR-0002: no flat aliases), and a new group is one
 * line here.
 */
import type { CliError } from "effect/cli";
import { Command } from "effect/cli";
import { hub } from "./commands/hub.ts";
import { room } from "./commands/room.ts";
import { self } from "./commands/self.ts";
import { globalFlags } from "./global-flags.ts";

export const root = Command.make("gambi").pipe(
  Command.withDescription(
    "Share OpenAI-compatible LLM endpoints across a trusted local network"
  ),
  Command.withGlobalFlags(globalFlags),
  Command.withSubcommands([hub, room, self])
);

/** Every typed error a run of `gambi` can end with. `exit-codes.ts` maps each one. */
export type CommandFailure = Command.Error<typeof root> | CliError.CliError;
