/**
 * The flags more than one command takes, besides `--hub` (`hub-client.ts`)
 * and the global ones (`global-flags.ts`).
 */
import { Schema } from "effect";
import { Flag, Prompt } from "effect/cli";

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
