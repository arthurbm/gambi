/**
 * A fake local provider for tests: a real HTTP server on a free loopback
 * port that answers like an OpenAI-compatible backend and records every
 * request it gets. It stands where Ollama or vLLM would on a participant's
 * machine, so a test runs the whole path: hub, tunnel, participant runtime,
 * provider.
 *
 * Test support only: it uses `Bun.serve`. Import it as
 * `@gambi/core/testing/provider`.
 */
import { Deferred, Effect, Queue, type Scope } from "effect";

/** One request the fake provider received. */
export interface ProviderCall {
  /**
   * Completes when the caller gave up on the request: it aborted, or closed
   * the connection before the response ended. This is how a test sees a
   * cancellation arrive at the provider.
   */
  readonly aborted: Effect.Effect<void>;
  /** The request body: parsed when it is JSON, the text otherwise, `undefined` when empty. */
  readonly body: unknown;
  /** The request headers, with lowercase names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  /** The path and query, for example `/v1/chat/completions`. */
  readonly path: string;
}

export interface FakeProviderOptions {
  /**
   * How the provider answers a call. Default: `openAiAnswer`, a short
   * completion in the shape of the route that was called.
   */
  readonly answer?:
    | ((call: ProviderCall) => Response | Promise<Response>)
    | undefined;
}

export interface FakeProvider {
  /** Every call received so far, oldest first. */
  readonly calls: Effect.Effect<readonly ProviderCall[]>;
  /**
   * The next call nobody took yet: waits for one to arrive. Each call is
   * handed out once.
   */
  readonly nextCall: Effect.Effect<ProviderCall>;
  /** The provider endpoint, for example `http://127.0.0.1:41233`. */
  readonly url: string;
}

const encoder = new TextEncoder();

/** A JSON response. */
export const jsonAnswer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** The text of one server-sent event: `data: <json>` and, when given, `event: <name>`. */
export const sseEvent = (data: unknown, event?: string): string =>
  `${event === undefined ? "" : `event: ${event}\n`}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

/**
 * A `text/event-stream` response that sends `events` and ends. Each item is
 * the whole text of an event (`sseEvent` builds one).
 */
export const sseAnswer = (events: readonly string[]): Response =>
  new Response(events.join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

export interface OpenStream {
  /** Ends the response. */
  readonly end: Effect.Effect<void>;
  /** Breaks the response the way a provider that crashes does. */
  readonly fail: Effect.Effect<void>;
  /** Give this to `answer`. */
  readonly response: Response;
  /** Sends one more piece of the body. */
  readonly send: (text: string) => Effect.Effect<void>;
}

/**
 * A response whose body the test writes piece by piece and that stays open
 * until the test ends it: what a provider that is still generating looks
 * like. Default `Content-Type`: `text/event-stream`.
 */
export const openStream = (
  contentType = "text/event-stream"
): Effect.Effect<OpenStream> =>
  Effect.sync(() => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    });
    return {
      response: new Response(body, {
        headers: { "Content-Type": contentType },
      }),
      send: (text) =>
        Effect.sync(() => controller?.enqueue(encoder.encode(text))),
      end: Effect.sync(() => controller?.close()),
      fail: Effect.sync(() =>
        controller?.error(new Error("The fake provider crashed."))
      ),
    };
  });

const isStreaming = (call: ProviderCall): boolean =>
  typeof call.body === "object" &&
  call.body !== null &&
  "stream" in call.body &&
  call.body.stream === true;

const modelOf = (call: ProviderCall): string =>
  typeof call.body === "object" &&
  call.body !== null &&
  "model" in call.body &&
  typeof call.body.model === "string"
    ? call.body.model
    : "unknown";

/** The text every canned completion of `openAiAnswer` says. */
export const FAKE_COMPLETION_TEXT = "Olá, Recife!";

const chatCompletion = (call: ProviderCall): Response => {
  const model = modelOf(call);
  if (!isStreaming(call)) {
    return jsonAnswer({
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: FAKE_COMPLETION_TEXT },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
  }
  const chunk = (delta: object, finishReason: string | null = null) =>
    sseEvent({
      id: "chatcmpl-fake",
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
  return sseAnswer([
    chunk({ role: "assistant", content: "" }),
    chunk({ content: "Olá, " }),
    chunk({ content: "Recife!" }),
    chunk({}, "stop"),
    sseEvent("[DONE]"),
  ]);
};

const responsesCreate = (call: ProviderCall): Response => {
  const response = (status: string, text?: string) => ({
    id: "resp_fake",
    object: "response",
    created_at: 0,
    status,
    model: modelOf(call),
    output:
      text === undefined
        ? []
        : [
            {
              id: "msg_fake",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ],
  });
  if (!isStreaming(call)) {
    return jsonAnswer(response("completed", FAKE_COMPLETION_TEXT));
  }
  const event = (type: string, fields: object) =>
    sseEvent({ type, ...fields }, type);
  return sseAnswer([
    event("response.created", { response: response("in_progress") }),
    event("response.output_text.delta", { delta: "Olá, " }),
    event("response.output_text.delta", { delta: "Recife!" }),
    event("response.completed", {
      response: response("completed", FAKE_COMPLETION_TEXT),
    }),
  ]);
};

/**
 * Answers like an OpenAI-compatible provider: a short completion on
 * `POST /v1/chat/completions` and on `POST /v1/responses`, as JSON or as
 * `text/event-stream` when the request says `stream: true`, and the OpenAI
 * error shape with 404 on anything else.
 */
export const openAiAnswer = (call: ProviderCall): Response => {
  if (call.method === "POST" && call.path === "/v1/chat/completions") {
    return chatCompletion(call);
  }
  if (call.method === "POST" && call.path === "/v1/responses") {
    return responsesCreate(call);
  }
  return jsonAnswer(
    {
      error: {
        message: `The fake provider has no route ${call.method} ${call.path}.`,
        type: "invalid_request_error",
        param: null,
        code: "not_found",
      },
    },
    404
  );
};

const parseBody = (text: string): unknown => {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Starts a fake provider on a free loopback port. It stops when the scope
 * closes, cutting whatever it was still answering.
 *
 * @example
 * const provider = yield* fakeProvider();
 * const participant = yield* joinParticipant({
 *   roomCode: room.code,
 *   handlers: providerHandlers({ endpoint: provider.url }),
 * });
 * // ... call the hub's inference plane ...
 * const call = yield* provider.nextCall;
 * expect(call.path).toBe("/v1/chat/completions");
 */
export const fakeProvider = (
  options: FakeProviderOptions = {}
): Effect.Effect<FakeProvider, never, Scope.Scope> =>
  Effect.gen(function* () {
    const answer = options.answer ?? openAiAnswer;
    const received: ProviderCall[] = [];
    const untaken = yield* Queue.unbounded<ProviderCall>();
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          // A provider that is still generating may stay silent for long.
          idleTimeout: 0,
          fetch: async (request) => {
            const url = new URL(request.url);
            const aborted = Deferred.makeUnsafe<void>();
            request.signal.addEventListener(
              "abort",
              () => Deferred.doneUnsafe(aborted, Effect.void),
              { once: true }
            );
            const call: ProviderCall = {
              method: request.method,
              path: `${url.pathname}${url.search}`,
              headers: Object.fromEntries(request.headers.entries()),
              body: parseBody(await request.text()),
              aborted: Deferred.await(aborted),
            };
            received.push(call);
            Queue.offerUnsafe(untaken, call);
            return answer(call);
          },
        })
      ),
      (running) => Effect.promise(() => running.stop(true))
    );
    return {
      url: `http://127.0.0.1:${server.port}`,
      calls: Effect.sync(() => [...received]),
      nextCall: Queue.take(untaken),
    };
  });
