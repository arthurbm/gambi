/**
 * The flags more than one command takes, besides `--hub` (`hub-client.ts`)
 * and the global ones (`global-flags.ts`).
 */
import { RuntimeConfig } from "@gambi/protocol";
import { Effect, FileSystem, Schema, Stdio, Stream } from "effect";
import { CliError, Flag, Prompt } from "effect/cli";

/** `--room`, `-r`: the room a command is about. Asked for on a terminal. */
export const roomFlag = Flag.String("room").pipe(
  Flag.withAlias("r"),
  Flag.withDescription("Code of the room"),
  Flag.withFallbackPrompt(Prompt.String({ message: "Room code" })),
  Flag.withSchema(Schema.NonEmptyString)
);

/**
 * `--participant-id`: the stable id of a participant. Registering again with
 * the same id updates the participant instead of adding one, which is what
 * makes a retry safe. Asked for on a terminal.
 */
export const participantIdFlag = Flag.String("participant-id").pipe(
  Flag.withDescription("Stable id of the participant"),
  Flag.withFallbackPrompt(Prompt.String({ message: "Participant id" })),
  Flag.withSchema(Schema.NonEmptyString)
);

/** `-` where a file is expected: read stdin instead. */
const STDIN = "-";

const RuntimeConfigFromJson = Schema.fromJsonString(RuntimeConfig);

/**
 * `--config <file|->`: a runtime config (temperature, instructions, ...) as
 * JSON, from a file or, with `-`, from stdin, which is how an automation
 * client that builds the config hands it over.
 *
 * It is written by hand because `Flag.FileSchema` takes `-` for a file name.
 */
export const runtimeConfigFlag = (description: string) =>
  Flag.String("config").pipe(
    Flag.withMetavar("file|-"),
    Flag.withDescription(description),
    Flag.mapEffect(
      Effect.fnUntraced(function* (source) {
        const invalid = (expected: string) =>
          new CliError.InvalidValue({
            option: "config",
            value: source,
            expected,
            kind: "flag",
          });
        const text =
          source === STDIN
            ? yield* (yield* Stdio.Stdio).stdin.pipe(
                Stream.decodeText(),
                Stream.mkString,
                Effect.mapError(() => invalid("a JSON document on stdin"))
              )
            : yield* (yield* FileSystem.FileSystem)
                .readFileString(source)
                .pipe(
                  Effect.mapError(() => invalid("a file that can be read"))
                );
        return yield* Schema.decodeUnknownEffect(RuntimeConfigFromJson)(
          text
        ).pipe(
          Effect.mapError((error) =>
            invalid(
              `a runtime config as JSON${source === STDIN ? " on stdin" : ""} (${error.message})`
            )
          )
        );
      })
    ),
    Flag.optional
  );
