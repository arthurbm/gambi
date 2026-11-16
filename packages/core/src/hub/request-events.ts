/**
 * What a room hears about one inference request: `llm.request` when the hub
 * dispatches it, and exactly one of `llm.complete` and `llm.error` when its
 * call ends. The events are defined in `@gambi/protocol` (`room-event.ts`).
 *
 * `reportRequest` is called in the scope of the call. The inference route
 * tells it how the call went (`completed`, `failed`), and the end of the
 * scope publishes the last event. A call that ends without either was given
 * up by the app: that is an `llm.error` too, with `request_cancelled`.
 */
import {
  INFERENCE_FAILURES,
  type InferenceError,
  type InferenceOperation,
  type InferenceProtocol,
  type LlmError,
  RequestId,
  type RequestMetrics,
} from "@gambi/protocol";
import { Clock, Effect, Option, Schema } from "effect";
import { RoomEvents } from "./room-events.ts";

/** The protocol each operation counts as. A new operation gets a row here. */
const PROTOCOLS: Record<InferenceOperation, InferenceProtocol> = {
  "chatCompletions.create": "chatCompletions",
  "responses.create": "openResponses",
};

/** The `code` of an `llm.error` for a request the app cancelled. */
export const REQUEST_CANCELLED = "request_cancelled";

/** The token counts in the `usage` of an answer, under the names of each API. */
const Usage = Schema.fromJsonString(
  Schema.Struct({
    usage: Schema.Struct({
      prompt_tokens: Schema.optionalKey(Schema.Finite),
      completion_tokens: Schema.optionalKey(Schema.Finite),
      input_tokens: Schema.optionalKey(Schema.Finite),
      output_tokens: Schema.optionalKey(Schema.Finite),
      total_tokens: Schema.optionalKey(Schema.Finite),
    }),
  })
);
const readUsage = Schema.decodeUnknownOption(Usage);

type Outcome =
  | {
      readonly _tag: "Completed";
      readonly status: number;
      readonly document: string | undefined;
    }
  | {
      readonly _tag: "Failed";
      readonly stage: LlmError["stage"];
      readonly code: string;
      readonly error: string;
    };

export interface RequestReport {
  /**
   * The provider's answer ended, with this HTTP status. `document` is the
   * whole body of an answer that is not a stream: its `usage` gives the
   * token counts.
   */
  readonly completed: (status: number, document?: string) => void;
  /** The request failed with `error`. */
  readonly failed: (error: InferenceError) => void;
  /** A piece of the answer's body arrived. The first one marks the time to first token. */
  readonly piece: () => void;
  /** A streamed answer started to go to the app: a failure from now on is in the `stream` stage. */
  readonly streaming: () => void;
}

/**
 * Publishes `llm.request` now, and the event that ends the request when the
 * scope closes.
 */
export const reportRequest = Effect.fn("Hub.reportRequest")(function* (
  roomCode: string,
  request: {
    readonly operation: InferenceOperation;
    readonly participantId: string;
    readonly model: string;
    readonly modelSelector: string;
  }
) {
  const events = yield* RoomEvents;
  const requestId = yield* RequestId;
  const clock = yield* Clock.Clock;
  const common = {
    requestId,
    participantId: request.participantId,
    model: request.model,
    protocol: PROTOCOLS[request.operation],
  };
  const startedAt = clock.currentTimeMillisUnsafe();
  let firstPieceAt: number | undefined;
  let stage: LlmError["stage"] = "dispatch";
  let outcome: Outcome | undefined;

  const metrics = (document: string | undefined): RequestMetrics => {
    const endedAt = clock.currentTimeMillisUnsafe();
    const durationMs = Math.max(0, endedAt - startedAt);
    const usage = Option.getOrUndefined(readUsage(document))?.usage;
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
    const totalTokens =
      usage?.total_tokens ??
      (inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0));
    return {
      ttftMs: Math.max(0, (firstPieceAt ?? endedAt) - startedAt),
      durationMs,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(outputTokens === undefined || durationMs === 0
        ? {}
        : { tokensPerSecond: (outputTokens / durationMs) * 1000 }),
    };
  };

  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      const ended: Outcome = outcome ?? {
        _tag: "Failed",
        stage,
        code: REQUEST_CANCELLED,
        error: "The app cancelled the request.",
      };
      return events.publish(
        roomCode,
        ended._tag === "Completed"
          ? {
              type: "llm.complete",
              ...common,
              status: ended.status,
              metrics: metrics(ended.document),
            }
          : {
              type: "llm.error",
              ...common,
              stage: ended.stage,
              code: ended.code,
              error: ended.error,
            }
      );
    })
  );
  yield* events.publish(roomCode, {
    type: "llm.request",
    ...common,
    modelSelector: request.modelSelector,
  });

  const report: RequestReport = {
    completed: (status, document) => {
      outcome ??= { _tag: "Completed", status, document };
    },
    failed: (error) => {
      outcome ??= {
        _tag: "Failed",
        stage,
        code: INFERENCE_FAILURES[error._tag].code,
        error: error.message,
      };
    },
    piece: () => {
      firstPieceAt ??= clock.currentTimeMillisUnsafe();
    },
    streaming: () => {
      stage = "stream";
    },
  };
  return report;
});
