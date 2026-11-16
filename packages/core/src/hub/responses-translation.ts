/**
 * The translation between the Responses API and Chat Completions, for a
 * participant whose provider speaks only the second. An app asks for a
 * Response; the hub asks the provider for a chat completion and writes its
 * answer as the Response the app expects.
 *
 * | Step | Function |
 * |---|---|
 * | the Responses request as a Chat Completions request | `toChatCompletionsRequest` |
 * | a chat completion as a Response | `toResponse` |
 *
 * A Response built here exists nowhere but in the answer: no provider stores
 * it, so it cannot be read back, deleted or cancelled later.
 *
 * Everything here is a pure function of its arguments. The route that uses
 * it is `infer` in `inference.ts`.
 */
import { Option, Predicate, Schema } from "effect";
import type { RequestBody } from "./inference-request.ts";

/** What every Response of one translated request has in common. */
export interface Translation {
  /** When the Response was created, in seconds since the epoch. */
  readonly createdAt: number;
  /** The participant's model, which is the one the provider was asked for. */
  readonly model: string;
  /** The Responses request, with the defaults of the room and of the participant filled in. */
  readonly request: RequestBody;
  /** The id the hub gave the Response: `resp_` and 32 hexadecimal digits. */
  readonly responseId: string;
}

/**
 * The text of a message content of either API: the string itself, or the
 * text parts of a list of parts, one per line. A part that is not text (an
 * image, a file) has no place in the translation and is left out.
 */
const textOf = (content: unknown): string => {
  if (Predicate.isString(content)) {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: unknown) => {
      if (Predicate.isString(part)) {
        return part;
      }
      return Predicate.hasProperty(part, "text") &&
        Predicate.isString(part.text)
        ? part.text
        : "";
    })
    .filter((text) => text !== "")
    .join("\n");
};

/** A message of a Chat Completions request. */
type ChatMessage = Readonly<Record<string, unknown>>;

/** The chat message an item of `input` or of `instructions` stands for. */
const toChatMessage = (item: unknown): ChatMessage => {
  const role = Predicate.hasProperty(item, "role") ? item.role : undefined;
  return {
    // Chat Completions providers know `system`, not `developer`.
    role: role === "developer" ? "system" : role,
    content: textOf(Predicate.hasProperty(item, "content") ? item.content : ""),
  };
};

/** The chat messages a string or a list of items of a Responses request stands for. */
const toChatMessages = (
  value: unknown,
  role: "system" | "user"
): readonly ChatMessage[] => {
  if (Predicate.isString(value)) {
    return [{ role, content: value }];
  }
  return Array.isArray(value) ? value.map(toChatMessage) : [];
};

/** The fields both APIs have, under the name each gives them. */
const SHARED_FIELDS: Readonly<Record<string, string>> = {
  stream: "stream",
  temperature: "temperature",
  top_p: "top_p",
  max_output_tokens: "max_tokens",
  stop_sequences: "stop",
  frequency_penalty: "frequency_penalty",
  presence_penalty: "presence_penalty",
  seed: "seed",
};

/**
 * The Chat Completions request that asks for what a Responses request asks.
 * `instructions` become the first `system` message and `input` the messages
 * that follow it.
 */
export const toChatCompletionsRequest = (request: RequestBody): RequestBody => {
  const chat: Record<string, unknown> = {
    model: request.model,
    messages: [
      ...toChatMessages(request.instructions, "system"),
      ...toChatMessages(request.input, "user"),
    ],
  };
  for (const [field, chatField] of Object.entries(SHARED_FIELDS)) {
    if (request[field] != null) {
      chat[chatField] = request[field];
    }
  }
  return chat;
};

const Tokens = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));

/** The token counts of a chat completion. */
const ChatUsage = Schema.Struct({
  prompt_tokens: Tokens,
  completion_tokens: Tokens,
  total_tokens: Tokens,
});
type ChatUsage = typeof ChatUsage.Type;

/** What the translation reads of an assistant message, whole or as the delta of a chunk. */
const ChatAnswer = Schema.Struct({
  content: Schema.optionalKey(Schema.Unknown),
});

/** What the translation reads of a chat completion. A provider may send more; it is not read. */
const ChatCompletion = Schema.fromJsonString(
  Schema.Struct({
    created: Tokens,
    choices: Schema.Array(
      Schema.Struct({
        finish_reason: Text,
        message: Schema.optionalKey(Schema.NullOr(ChatAnswer)),
      })
    ),
    usage: Schema.optionalKey(Schema.NullOr(ChatUsage)),
  })
);
const readChatCompletion = Schema.decodeUnknownOption(ChatCompletion);

const numberOrNull = (value: unknown): number | null =>
  Predicate.isNumber(value) ? value : null;

/** The `usage` of a Response, from the token counts of a chat completion. */
const toUsage = (usage: ChatUsage | null | undefined) => {
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage?.total_tokens ?? inputTokens + outputTokens,
  };
};

/** Why a Response stopped short, from the `finish_reason` of a chat completion. */
const toIncompleteDetails = (finishReason: string | null | undefined) => {
  if (finishReason === "length") {
    return { reason: "max_output_tokens" };
  }
  return finishReason === "content_filter"
    ? { reason: "content_filter" }
    : null;
};

/** The id of an output item of a translated Response, derived from the id of the Response. */
const itemId = (translation: Translation, prefix: string) =>
  `${prefix}_${translation.responseId.replace("resp_", "")}`;

const messageItem = (translation: Translation, text: string) => ({
  id: itemId(translation, "msg"),
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

/** A Response object: what the request says of it, and what the answer added. */
const responseObject = (
  translation: Translation,
  answer: {
    readonly createdAt?: number | null | undefined;
    readonly finishReason?: string | null | undefined;
    readonly output: readonly object[];
    readonly outputText: string;
    readonly status: "in_progress" | "completed";
    readonly usage?: ChatUsage | null | undefined;
  }
) => {
  const { request } = translation;
  return {
    id: translation.responseId,
    object: "response",
    created_at: answer.createdAt ?? translation.createdAt,
    status: answer.status,
    model: translation.model,
    output: answer.output,
    output_text: answer.outputText,
    error: null,
    incomplete_details: toIncompleteDetails(answer.finishReason),
    instructions: request.instructions ?? null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: numberOrNull(request.temperature),
    tool_choice: request.tool_choice ?? "auto",
    tools: Array.isArray(request.tools) ? request.tools : [],
    top_p: numberOrNull(request.top_p),
    background: null,
    conversation: null,
    max_output_tokens: numberOrNull(request.max_output_tokens),
    previous_response_id: null,
    prompt: null,
    prompt_cache_retention: null,
    reasoning: null,
    service_tier: null,
    text: { format: { type: "text" }, verbosity: "medium" },
    truncation: "disabled",
    usage: toUsage(answer.usage),
  };
};

/**
 * The Response a chat completion stands for, as JSON text. `None` when
 * `document` is not a chat completion: then the hub has nothing to translate.
 */
export const toResponse = (
  translation: Translation,
  document: string
): Option.Option<string> =>
  Option.map(readChatCompletion(document), (completion) => {
    const [choice] = completion.choices;
    const text = textOf(choice?.message?.content);
    return JSON.stringify(
      responseObject(translation, {
        status: "completed",
        createdAt: completion.created,
        finishReason: choice?.finish_reason,
        output: text === "" ? [] : [messageItem(translation, text)],
        outputText: text,
        usage: completion.usage,
      })
    );
  });
