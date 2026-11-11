/**
 * The flags every command accepts. They are declared here so that the parser,
 * `--help` and the completions know them, but their values are needed before
 * a command is parsed (to render a parse error, to decide whether a missing
 * flag may prompt), so `peekGlobalFlags` reads them straight from the
 * arguments and `run.ts` builds the environment from that.
 */
import { Schema } from "effect";
import { Flag, GlobalFlag } from "effect/cli";
import { OUTPUT_FORMATS, type OutputFormat } from "./output.ts";

export const Format = GlobalFlag.Setting("format")({
  flag: Flag.Literals("format", OUTPUT_FORMATS).pipe(
    Flag.optional,
    Flag.withDescription(
      "Output format. Default: text on a terminal, json otherwise"
    )
  ),
});

export const Interactive = GlobalFlag.Setting("interactive")({
  flag: Flag.Boolean("interactive").pipe(
    Flag.withDescription(
      "Ask for missing input on a terminal. --no-interactive never asks"
    ),
    Flag.withDefault(true)
  ),
});

export const globalFlags = [Format, Interactive] as const;

export interface PeekedGlobalFlags {
  /** `--format`, when it names a known format. */
  readonly format: OutputFormat | undefined;
  /** `false` only when `--no-interactive` was passed. */
  readonly interactive: boolean;
}

const isOutputFormat = Schema.is(Schema.Literals(OUTPUT_FORMATS));

export const peekGlobalFlags = (argv: readonly string[]): PeekedGlobalFlags => {
  const end = argv.indexOf("--");
  const flags = end === -1 ? argv : argv.slice(0, end);
  let format: OutputFormat | undefined;
  for (const [index, flag] of flags.entries()) {
    const value = flag.startsWith("--format=")
      ? flag.slice("--format=".length)
      : flag === "--format" && flags[index + 1];
    if (isOutputFormat(value)) {
      format = value;
    }
  }
  return { format, interactive: !flags.includes("--no-interactive") };
};
