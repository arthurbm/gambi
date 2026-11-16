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
 * | a streamed chat completion as the events of a streamed Response | `toResponseEvents` |
 *
 * What crosses: text (instructions, messages, the answer), function tools,
 * tool calls and their outputs, the sampling parameters and the token
 * counts. A request that uses anything else of the Responses API is refused
 * with `RequestNotTranslatable`, which names the field.
 *
 * A Response built here exists nowhere but in the answer: no provider stores
 * it, so it cannot be read back, deleted or cancelled later.
 *
 * Everything here is a pure function of its arguments. The route that uses
 * it is `infer` in `inference.ts`.
 */
import { RequestNotTranslatable } from "@gambi/protocol";
import { Effect, Option, Predicate, Schema } from "effect";
import { Sse } from "effect/encoding";
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

/** The value of a field of something that may not even be an object. */
const fieldOf = (value: unknown, name: string): unknown =>
  Predicate.hasProperty(value, name) ? value[name] : undefined;

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
      const text = Predicate.isString(part) ? part : fieldOf(part, "text");
      return Predicate.isString(text) ? text : "";
    })
    .filter((text) => text !== "")
    .join("\n");
};

/** A message of a Chat Completions request. */
type ChatMessage = Readonly<Record<string, unknown>>;

const MESSAGE_ROLES: Readonly<Record<string, string>> = {
  user: "user",
  assistant: "assistant",
  system: "system",
  // Chat Completions providers know `system`, not `developer`.
  developer: "system",
};

/**
 * The messages with one more tool call of the assistant. In Chat Completions
 * the calls an assistant made in one turn are one message, so a call joins
 * the assistant message right before it.
 */
const withToolCall = (
  messages: readonly ChatMessage[],
  item: unknown
): readonly ChatMessage[] => {
  const toolCall = {
    id: fieldOf(item, "call_id"),
    type: "function",
    function: {
      name: fieldOf(item, "name"),
      arguments: fieldOf(item, "arguments"),
    },
  };
  const last = messages.at(-1);
  if (last?.role !== "assistant") {
    return [
      ...messages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
    ];
  }
  const toolCalls = Array.isArray(last.tool_calls) ? last.tool_calls : [];
  return [
    ...messages.slice(0, -1),
    { ...last, tool_calls: [...toolCalls, toolCall] },
  ];
};

/** The `tool` message that carries the output of a tool call back to the model. */
const toToolMessage = (item: unknown): ChatMessage => {
  const output = fieldOf(item, "output");
  return {
    role: "tool",
    tool_call_id: fieldOf(item, "call_id"),
    content: Predicate.isString(output)
      ? output
      : JSON.stringify(output ?? null),
  };
};

/** The messages with what one more item of `instructions` or of `input` stands for. */
const withItem = Effect.fnUntraced(function* (
  messages: readonly ChatMessage[],
  item: unknown,
  param: "instructions" | "input"
): Effect.fn.Return<readonly ChatMessage[], RequestNotTranslatable> {
  const type = fieldOf(item, "type") ?? "message";
  if (type === "function_call") {
    return withToolCall(messages, item);
  }
  if (type === "function_call_output") {
    return [...messages, toToolMessage(item)];
  }
  if (type !== "message") {
    return yield* new RequestNotTranslatable({
      param,
      issue: `An item of type '${String(type)}' has no equivalent in Chat Completions.`,
    });
  }
  const role = MESSAGE_ROLES[String(fieldOf(item, "role"))];
  if (role === undefined) {
    return yield* new RequestNotTranslatable({
      param,
      issue: `A message with role '${String(fieldOf(item, "role"))}' has no equivalent in Chat Completions.`,
    });
  }
  return [...messages, { role, content: textOf(fieldOf(item, "content")) }];
});

/**
 * The chat messages that `instructions` or `input` of a Responses request
 * stand for: one message for a string, and what each item stands for in a
 * list.
 */
const toChatMessages = Effect.fnUntraced(function* (
  param: "instructions" | "input",
  value: unknown
): Effect.fn.Return<readonly ChatMessage[], RequestNotTranslatable> {
  if (Predicate.isString(value)) {
    return [
      { role: param === "instructions" ? "system" : "user", content: value },
    ];
  }
  let messages: readonly ChatMessage[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    messages = yield* withItem(messages, item, param);
  }
  return messages;
});

/**
 * The `tools` of a Chat Completions request. The two APIs write a function
 * tool differently: the Responses API has its name and parameters at the top
 * of the tool, Chat Completions under `function`.
 */
const toChatTools = Effect.fnUntraced(function* (
  tools: unknown
): Effect.fn.Return<readonly unknown[], RequestNotTranslatable> {
  const chatTools: unknown[] = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (fieldOf(tool, "type") !== "function") {
      return yield* new RequestNotTranslatable({
        param: "tools",
        issue: "Only function tools have an equivalent in Chat Completions.",
      });
    }
    chatTools.push(
      Predicate.hasProperty(tool, "function")
        ? tool
        : {
            type: "function",
            function: {
              name: fieldOf(tool, "name"),
              description: fieldOf(tool, "description"),
              parameters: fieldOf(tool, "parameters"),
              strict: fieldOf(tool, "strict"),
            },
          }
    );
  }
  return chatTools;
});

/** The `tool_choice` of a Chat Completions request: a named function goes under `function`. */
const toChatToolChoice = (toolChoice: unknown): unknown =>
  fieldOf(toolChoice, "type") === "function" &&
  !Predicate.hasProperty(toolChoice, "function")
    ? { type: "function", function: { name: fieldOf(toolChoice, "name") } }
    : toolChoice;

/**
 * The fields of a Responses request that need what only a provider that
 * speaks the Responses API has: stored conversations, background work,
 * reasoning, output formats.
 */
const NO_EQUIVALENT = [
  "background",
  "conversation",
  "previous_response_id",
  "reasoning",
  "store",
  "text",
  "truncation",
] as const;

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
 * that follow it. A field the translation does not know is left out.
 *
 * It fails when the request uses something Chat Completions cannot carry.
 */
export const toChatCompletionsRequest = Effect.fnUntraced(function* (
  request: RequestBody
): Effect.fn.Return<RequestBody, RequestNotTranslatable> {
  const unsupported = NO_EQUIVALENT.find((field) => request[field] != null);
  if (unsupported !== undefined) {
    return yield* new RequestNotTranslatable({
      param: unsupported,
      issue: "Chat Completions has no equivalent.",
    });
  }
  const messages = [
    ...(yield* toChatMessages("instructions", request.instructions)),
    ...(yield* toChatMessages("input", request.input)),
  ];
  if (messages.length === 0) {
    return yield* new RequestNotTranslatable({
      param: "input",
      issue: "Expected text in `input` or in `instructions`.",
    });
  }
  const tools = yield* toChatTools(request.tools);
  const chat: Record<string, unknown> = {
    model: request.model,
    messages,
    ...(tools.length === 0 ? {} : { tools }),
    ...(request.tool_choice == null
      ? {}
      : { tool_choice: toChatToolChoice(request.tool_choice) }),
  };
  for (const [field, chatField] of Object.entries(SHARED_FIELDS)) {
    if (request[field] != null) {
      chat[chatField] = request[field];
    }
  }
  return chat;
});

const Count = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));

/** The token counts of a chat completion. */
const ChatUsage = Schema.Struct({
  prompt_tokens: Count,
  completion_tokens: Count,
  total_tokens: Count,
});
type ChatUsage = typeof ChatUsage.Type;

/** A tool call of the assistant: whole in a message, in pieces in the deltas of a stream. */
const ChatToolCall = Schema.Struct({
  /** Which call of the turn a streamed piece belongs to. */
  index: Count,
  id: Text,
  type: Text,
  function: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ name: Text, arguments: Text }))
  ),
});
type ChatToolCall = typeof ChatToolCall.Type;

/** What the translation reads of an assistant message, whole or as the delta of a chunk. */
const ChatAnswer = Schema.Struct({
  content: Schema.optionalKey(Schema.Unknown),
  tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(ChatToolCall))),
});

/** What the translation reads of a chat completion. A provider may send more; it is not read. */
const ChatCompletion = Schema.fromJsonString(
  Schema.Struct({
    created: Count,
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

/** What the translation reads of one chunk of a streamed chat completion. */
const ChatChunk = Schema.fromJsonString(
  Schema.Struct({
    choices: Schema.optionalKey(
      Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            finish_reason: Text,
            delta: Schema.optionalKey(Schema.NullOr(ChatAnswer)),
          })
        )
      )
    ),
    usage: Schema.optionalKey(Schema.NullOr(ChatUsage)),
  })
);
const readChatChunk = Schema.decodeUnknownOption(ChatChunk);

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

/**
 * The id of an output item of a translated Response. The hub derives it from
 * the id of the Response, so it needs no other source of ids.
 */
const itemId = (translation: Translation, prefix: string) =>
  `${prefix}_${translation.responseId.replace("resp_", "")}`;

/** The one message of a translated Response: the text the assistant answered. */
const messageItem = (translation: Translation, text: string) => ({
  id: itemId(translation, "msg"),
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

/** The output item of a tool call. `index` is its place among the calls of the turn. */
const functionCallItem = (
  translation: Translation,
  index: number,
  toolCall: ChatToolCall
) => {
  const id = `${itemId(translation, "fc")}_${index}`;
  return {
    id,
    type: "function_call",
    status: "completed",
    call_id: toolCall.id ?? id,
    name: toolCall.function?.name ?? "",
    arguments: toolCall.function?.arguments ?? "",
  };
};

/** A tool call that is a function call: the only kind the Responses API has an item for here. */
const isFunctionCall = (toolCall: ChatToolCall) =>
  toolCall.type == null || toolCall.type === "function";

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
 * The Response a chat completion stands for, as JSON text: the text of the
 * answer as a message, then each tool call as a function call. `None` when
 * `document` is not a chat completion: then the hub has nothing to translate.
 */
export const toResponse = (
  translation: Translation,
  document: string
): Option.Option<string> =>
  Option.map(readChatCompletion(document), (completion) => {
    const [choice] = completion.choices;
    const text = textOf(choice?.message?.content);
    const toolCalls = (choice?.message?.tool_calls ?? []).filter(
      isFunctionCall
    );
    return JSON.stringify(
      responseObject(translation, {
        status: "completed",
        createdAt: completion.created,
        finishReason: choice?.finish_reason,
        output: [
          ...(text === "" ? [] : [messageItem(translation, text)]),
          ...toolCalls.map((toolCall, index) =>
            functionCallItem(translation, index, toolCall)
          ),
        ],
        outputText: text,
        usage: completion.usage,
      })
    );
  });

/** The last line of the stream, as Chat Completions ends its own. */
const DONE = Sse.encoder.write({
  _tag: "Event",
  event: "message",
  id: undefined,
  data: "[DONE]",
});

/**
 * A streamed chat completion, rewritten piece by piece as the events of a
 * streamed Response. Each function answers the text of zero or more whole
 * events.
 */
export interface ResponseEvents {
  /**
   * The events that close the Response: each output item, done, and
   * `response.completed` with the whole Response. Call it when the
   * provider's stream ended well.
   */
  readonly end: () => string;
  /** The `sequence_number` the next event of the stream takes. */
  readonly nextSequenceNumber: () => number;
  /**
   * The events for one more piece of the provider's body. A piece may hold
   * several chunks, or part of one: what is unfinished waits for the next.
   */
  readonly piece: (text: string) => string;
  /** `response.created`, which opens the stream before the provider said anything. */
  readonly start: string;
}

/**
 * Starts the translation of one streamed chat completion.
 *
 * The events, in order: `response.created`; for each output item, in the
 * order the provider started them, `response.output_item.added` and then its
 * deltas (`response.output_text.delta` for the text,
 * `response.function_call_arguments.delta` for a tool call); at the end,
 * `response.output_item.done` for each item, `response.completed` and
 * `[DONE]`. Every event carries its `type` and a `sequence_number` that
 * counts from zero.
 *
 * The provider's stream is read with the SSE parser of `effect`.
 */
export const toResponseEvents = (translation: Translation): ResponseEvents => {
  let sequenceNumber = 0;
  let written: string[] = [];
  const write = (type: string, fields: object) => {
    written.push(
      Sse.encoder.write({
        _tag: "Event",
        event: type,
        id: undefined,
        data: JSON.stringify({
          type,
          sequence_number: sequenceNumber,
          ...fields,
        }),
      })
    );
    sequenceNumber += 1;
  };
  const takeWritten = () => {
    const text = written.join("");
    written = [];
    return text;
  };

  /** The output items so far, in the order the provider started them. */
  const output: {
    item: ReturnType<typeof functionCallItem> | ReturnType<typeof messageItem>;
  }[] = [];
  /** Where the message is in `output`, once the text started. */
  let messageAt: number | undefined;
  let text = "";
  /** Where each tool call is in `output`, by its index in the turn. */
  const toolCallsAt = new Map<number, number>();
  let finishReason: string | null | undefined;
  let usage: ChatUsage | null | undefined;

  const start = (item: (typeof output)[number]["item"]) => {
    write("response.output_item.added", {
      output_index: output.length,
      item: {
        ...item,
        status: "in_progress",
        ...("content" in item ? { content: [] } : {}),
      },
    });
    return output.push({ item }) - 1;
  };

  const onText = (delta: string) => {
    messageAt ??= start(messageItem(translation, ""));
    text += delta;
    output[messageAt] = { item: messageItem(translation, text) };
    write("response.output_text.delta", {
      output_index: messageAt,
      item_id: itemId(translation, "msg"),
      content_index: 0,
      delta,
    });
  };

  const onToolCall = (delta: ChatToolCall) => {
    const index = delta.index ?? 0;
    const at =
      toolCallsAt.get(index) ??
      start(functionCallItem(translation, index, delta));
    toolCallsAt.set(index, at);
    const item = output[at]?.item;
    const more = delta.function?.arguments ?? "";
    if (item === undefined || !("arguments" in item) || more === "") {
      return;
    }
    output[at] = { item: { ...item, arguments: item.arguments + more } };
    write("response.function_call_arguments.delta", {
      output_index: at,
      item_id: item.id,
      delta: more,
    });
  };

  const parser = Sse.makeParser((event) => {
    const chunk =
      event._tag === "Event"
        ? Option.getOrUndefined(readChatChunk(event.data))
        : undefined;
    // `[DONE]` is not a chunk, and neither is anything else that is not JSON.
    if (chunk === undefined) {
      return;
    }
    usage = chunk.usage ?? usage;
    const [choice] = chunk.choices ?? [];
    finishReason = choice?.finish_reason ?? finishReason;
    const delta = textOf(choice?.delta?.content);
    if (delta !== "") {
      onText(delta);
    }
    for (const toolCall of choice?.delta?.tool_calls ?? []) {
      if (isFunctionCall(toolCall)) {
        onToolCall(toolCall);
      }
    }
  });

  write("response.created", {
    response: responseObject(translation, {
      status: "in_progress",
      output: [],
      outputText: "",
    }),
  });
  return {
    start: takeWritten(),
    nextSequenceNumber: () => sequenceNumber,
    piece: (piece) => {
      parser.feed(piece);
      return takeWritten();
    },
    end: () => {
      const items = output.map(({ item }) => item);
      for (const [index, item] of items.entries()) {
        write("response.output_item.done", { output_index: index, item });
      }
      write("response.completed", {
        response: responseObject(translation, {
          status: "completed",
          finishReason,
          output: items,
          outputText: text,
          usage,
        }),
      });
      written.push(DONE);
      return takeWritten();
    },
  };
};
