/**
 * What the hub does to the body of an inference request before it goes to a
 * provider. It is all here, and it is all the hub knows of the OpenAI APIs:
 *
 * 1. It reads two fields, `model` (the model selector) and `stream`, and
 *    checks nothing else. A field it does not know reaches the provider as
 *    it came.
 * 2. It fills what the app left out from the defaults of the room and of the
 *    participant; the participant's win over the room's.
 * 3. It replaces `model` with the participant's own model: the selector
 *    means something to the hub only.
 */
import {
  type InferenceCreation,
  InvalidInferenceRequest,
  type RuntimeConfig,
} from "@gambi/protocol";
import { Effect, Predicate, Schema, SchemaIssue } from "effect";

/** The body of an inference request: a JSON object the hub does not interpret. */
export type RequestBody = Readonly<Record<string, unknown>>;

export interface InferenceRequest {
  readonly body: RequestBody;
  /** The model selector the app asked for. */
  readonly model: string;
  /** Whether the app asked for a streamed response. */
  readonly stream: boolean;
}

/** The only two fields of the body the hub reads. */
const ReadFields = Schema.Struct({
  model: Schema.NonEmptyString,
  stream: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** Reads `model` and `stream` from a parsed body, and keeps the rest untouched. */
export const readRequest = Effect.fnUntraced(function* (
  json: unknown
): Effect.fn.Return<InferenceRequest, InvalidInferenceRequest> {
  if (!Predicate.isObject(json) || Array.isArray(json)) {
    return yield* new InvalidInferenceRequest({
      issue: "Expected a JSON object.",
    });
  }
  const read = yield* Schema.decodeUnknownEffect(ReadFields)(json).pipe(
    Effect.mapError((error) => {
      const [first] = formatIssues(error.issue).issues;
      const segment = first?.path?.[0];
      const key = Predicate.isObject(segment) ? segment.key : segment;
      return new InvalidInferenceRequest({
        ...(key === undefined ? {} : { param: String(key) }),
        issue: first?.message ?? "Invalid value.",
      });
    })
  );
  return {
    model: read.model,
    stream: read.stream === true,
    body: json as RequestBody,
  };
});

/** Room defaults under participant config: the participant's values win. */
export const mergeDefaults = (
  room: RuntimeConfig | undefined,
  participant: RuntimeConfig
): RuntimeConfig => ({ ...room, ...participant });

/**
 * Where each default goes in the body of each API. A default applies only
 * when the body has no value for the field (absent or `null`).
 * `instructions` is not here: each API takes it in its own way.
 */
const DEFAULT_FIELDS: Record<
  InferenceCreation,
  Partial<Record<Exclude<keyof RuntimeConfig, "instructions">, string>>
> = {
  "chatCompletions.create": {
    temperature: "temperature",
    top_p: "top_p",
    max_tokens: "max_tokens",
    stop: "stop",
    frequency_penalty: "frequency_penalty",
    presence_penalty: "presence_penalty",
    seed: "seed",
  },
  "responses.create": {
    temperature: "temperature",
    top_p: "top_p",
    max_tokens: "max_output_tokens",
    stop: "stop_sequences",
    frequency_penalty: "frequency_penalty",
    presence_penalty: "presence_penalty",
    seed: "seed",
  },
};

const hasSystemMessage = (messages: readonly unknown[]) =>
  messages.some(
    (message) =>
      Predicate.isObject(message) &&
      Predicate.hasProperty(message, "role") &&
      message.role === "system"
  );

/**
 * The JSON text the provider receives: the app's body with the defaults
 * filled in and `model` replaced by the participant's model.
 *
 * In Chat Completions the default instructions become a `system` message at
 * the start, unless the app sent one; in Responses they fill `instructions`.
 */
export const providerBody = (
  operation: InferenceCreation,
  body: RequestBody,
  defaults: RuntimeConfig,
  model: string
): string => {
  const filled: Record<string, unknown> = { ...body, model };
  for (const [name, field] of Object.entries(DEFAULT_FIELDS[operation])) {
    const value = defaults[name as keyof typeof defaults];
    if (filled[field] == null && value !== undefined) {
      filled[field] = value;
    }
  }
  if (defaults.instructions !== undefined) {
    if (operation === "responses.create") {
      filled.instructions ??= defaults.instructions;
    } else if (
      Array.isArray(filled.messages) &&
      !hasSystemMessage(filled.messages)
    ) {
      filled.messages = [
        { role: "system", content: defaults.instructions },
        ...filled.messages,
      ];
    }
  }
  return JSON.stringify(filled);
};
