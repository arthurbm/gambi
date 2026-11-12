/** The schemas of a room, as the management plane shows it. */
import { Schema } from "effect";

/** Generation defaults, compatible with OpenAI-like providers. */
const generationFields = {
  temperature: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2 }))
  ),
  top_p: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  ),
  max_tokens: Schema.optionalKey(Schema.Finite),
  stop: Schema.optionalKey(Schema.Array(Schema.String)),
  frequency_penalty: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: -2, maximum: 2 }))
  ),
  presence_penalty: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: -2, maximum: 2 }))
  ),
  seed: Schema.optionalKey(Schema.Finite),
};

/** The defaults a room applies to requests that leave a field out. */
export const RuntimeConfig = Schema.Struct({
  ...generationFields,
  instructions: Schema.optionalKey(Schema.Trim.check(Schema.isNonEmpty())),
});
export type RuntimeConfig = typeof RuntimeConfig.Type;

/** `RuntimeConfig` without the instructions text, which stays in the hub. */
export const RuntimeConfigPublic = Schema.Struct({
  ...generationFields,
  hasInstructions: Schema.Boolean,
});
export type RuntimeConfigPublic = typeof RuntimeConfigPublic.Type;

/** Redacts a `RuntimeConfig` for display: the instructions text never leaves the hub. */
export const toRuntimeConfigPublic = (
  config: RuntimeConfig
): RuntimeConfigPublic => {
  const { instructions, ...generation } = config;
  return { ...generation, hasInstructions: instructions !== undefined };
};

/** The short code that identifies a room: six characters of `0-9A-Z`. */
export const RoomCode = Schema.String;
export type RoomCode = typeof RoomCode.Type;

export const RoomSummary = Schema.Struct({
  id: Schema.String,
  code: RoomCode,
  name: Schema.String,
  hostId: Schema.String,
  /** Milliseconds since the epoch. */
  createdAt: Schema.Finite,
  defaults: Schema.optionalKey(RuntimeConfigPublic),
  passwordProtected: Schema.Boolean,
  participantCount: Schema.Int,
});
export type RoomSummary = typeof RoomSummary.Type;

export const CreateRoom = Schema.Struct({
  name: Schema.NonEmptyString,
  password: Schema.optionalKey(Schema.NonEmptyString),
  defaults: Schema.optionalKey(RuntimeConfig),
});
export type CreateRoom = typeof CreateRoom.Type;

export const RoomCreated = Schema.Struct({
  room: RoomSummary,
  hostId: Schema.String,
});
export type RoomCreated = typeof RoomCreated.Type;
