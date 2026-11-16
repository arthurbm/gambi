/**
 * The inference plane: the OpenAI-compatible routes under
 * `/rooms/:code/v1/*` that apps call. They are plain routes, outside the
 * management contract, because they pass a provider's answer through.
 *
 * | Route | What it does |
 * |---|---|
 * | `GET /rooms/:code/v1/models` | lists the participants that can take a request |
 * | `POST /rooms/:code/v1/chat/completions` | Chat Completions |
 * | `POST /rooms/:code/v1/responses` | creates a Response |
 *
 * A request is routed to one participant by its model selector
 * (`Participants.dispatch`), sent into that participant's tunnel as an
 * `Infer` call, and the provider's answer comes back with its own status.
 *
 * Two lifetimes matter, and they are two scopes:
 *
 * - **The call** (`call` in `infer`). While it is open the participant is
 *   `busy` and the `Infer` call is open in its tunnel. It closes when the
 *   provider's answer ended, when the request failed, or when the app went
 *   away. Closing it interrupts the call, which stops the provider, and puts
 *   the participant back `online`.
 * - **The HTTP request**, which stays open until the response body ends. The
 *   call never outlives it.
 *
 * A streamed answer does not go straight from the tunnel to the app. A pump
 * takes every chunk off the tunnel as soon as it arrives and hands the text
 * to the response body through `pending`. The hub must never make a tunnel
 * wait for an app: a tunnel has one reader, and while it waits on a full
 * stream it reads nothing else, pongs included, so the hub would drop the
 * whole tunnel on a ping timeout (measured, see the ticket notes). What an
 * app has not read yet is bounded instead: past
 * `MAX_PENDING_STREAM_CHARACTERS` the request is cancelled with
 * `ConsumerTooSlow`.
 *
 * A failure is an `InferenceError` (`@gambi/protocol`), written in the
 * OpenAI error format: as the response when nothing was sent yet, as a last
 * `error` event when a stream was already on its way.
 *
 * To add a route that calls a provider: add its operation to `Infer`, give
 * it a row in `inference-request.ts` and in the participant runtime's table
 * of provider routes, and add the route to `InferenceRoutes` with `infer`.
 */
import {
  type CallNotSupported,
  ConsumerTooSlow,
  type InferenceCreation,
  type InferenceError,
  type InferenceOperation,
  type InferenceRequest,
  InferenceTimedOut,
  InvalidInferenceRequest,
  OPENAI_INTERNAL_ERROR,
  ParticipantDisconnected,
  ParticipantIsOffline,
  ProviderResponseInterrupted,
  ProviderResponseTooLarge,
  type ProviderUnreachable,
  ResponseNotFound,
  ResponseNotStored,
  ResponsesNotSupported,
  type StoredResponseOperation,
  toOpenAiError,
  toOpenAiStreamError,
} from "@gambi/protocol";
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { SecureRandom } from "effect/crypto";
import { Sse } from "effect/encoding";
import {
  HttpRouter,
  type HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { RpcClientError } from "effect/rpc";
import {
  mergeDefaults,
  providerBody,
  type RequestBody,
  readRequest,
} from "./inference-request.ts";
import { RequestIdentity } from "./management.ts";
import { type DispatchedParticipant, Participants } from "./participants.ts";
import {
  type RequestReport,
  reportRequest,
  unreported,
} from "./request-events.ts";
import {
  type Translation,
  toChatCompletionsRequest,
  toResponse,
  toResponseEvents,
} from "./responses-translation.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
import { StoredResponses } from "./stored-responses.ts";
import { Tunnels } from "./tunnels.ts";

/**
 * How much of a streamed response may wait in the hub for the app to read
 * it, in characters. A whole text completion is a small fraction of it; an
 * app only reaches it by not reading while the provider keeps producing.
 */
export const MAX_PENDING_STREAM_CHARACTERS = 8 * 1024 * 1024;

/**
 * How much of a response that is not a stream the hub holds before it gives
 * up, in characters. A completion with a few images fits many times over.
 */
export const MAX_HELD_RESPONSE_CHARACTERS = 32 * 1024 * 1024;

/**
 * How long an unfinished server-sent event may get while the hub holds it,
 * waiting for its end, in characters. Past it the text goes out as it is.
 */
const MAX_HELD_EVENT_CHARACTERS = 1024 * 1024;

const EVENT_STREAM = "text/event-stream";

const errorResponse = (error: InferenceError) => {
  const { status, body } = toOpenAiError(error);
  return HttpServerResponse.jsonUnsafe(body, { status });
};

/** What a call in the tunnel can fail with, as the hub's client sees it. */
type CallError =
  | CallNotSupported
  | ProviderUnreachable
  | ProviderResponseInterrupted
  | InferenceTimedOut
  | RpcClientError.RpcClientError;

/** The index right after the last complete server-sent event in `text`: after its blank line. */
const endOfLastEvent = (text: string): number => {
  const after = (blankLine: string) => {
    const at = text.lastIndexOf(blankLine);
    return at === -1 ? 0 : at + blankLine.length;
  };
  return Math.max(after("\n\n"), after("\r\r"), after("\r\n\r\n"));
};

/**
 * A `text/event-stream` body that only ever sends whole events, and ends
 * with the name of what went wrong when something does.
 *
 * The provider's text is passed on up to the end of its last complete event;
 * the unfinished rest waits for the next piece. So when the stream fails in
 * the middle of an event, the half event is dropped and the `error` event
 * that follows is one a client can parse. A stream that ends well sends
 * everything it got, byte for byte.
 *
 * An unfinished event longer than `MAX_HELD_EVENT_CHARACTERS` is not held:
 * it goes out as it is. If the stream fails before that event ends, the
 * `error` event starts after a blank line of its own.
 */
const eventStreamBody = (
  pieces: Stream.Stream<string, InferenceError>,
  errorEvent: (error: InferenceError) => string
): Stream.Stream<string> =>
  Stream.suspend(() => {
    let held = "";
    let insideEvent = false;
    return pieces.pipe(
      Stream.map((piece) => {
        const text = held + piece;
        const whole = endOfLastEvent(text);
        const tooLong = text.length - whole > MAX_HELD_EVENT_CHARACTERS;
        const end = tooLong ? text.length : whole;
        if (end > 0) {
          insideEvent = tooLong;
        }
        held = text.slice(end);
        return text.slice(0, end);
      }),
      Stream.concat(Stream.suspend(() => Stream.make(held))),
      Stream.catch((error) =>
        Stream.make(`${insideEvent ? "\n\n" : ""}${errorEvent(error)}`)
      ),
      Stream.filter((text) => text !== "")
    );
  });

/** What a request was answered with, and whether its call is still feeding the response. */
interface Answered {
  readonly response: HttpServerResponse.HttpServerResponse;
  /** A streamed answer keeps its call open; the pump closes it. */
  readonly streaming: boolean;
}

/** The call a request holds in a participant's tunnel. */
interface Call {
  /** Closes the call: the provider stops, and what the call held is released. */
  readonly end: Effect.Effect<void>;
  readonly participantId: string;
  /** The scope of the HTTP request, which lasts until the response body ends. */
  readonly requestScope: Scope.Scope;
  readonly roomCode: string;
}

/**
 * Runs `use` with a scope for the call of a request, a child of the scope of
 * the HTTP request. The call ends when `use` fails, when it answers with
 * something that is not a stream, or, for a stream, when its pump ends it.
 */
const withCall = Effect.fnUntraced(function* <E, R>(
  use: (
    scopes: Pick<Call, "end" | "requestScope">
  ) => Effect.Effect<Answered, E, R>
) {
  const requestScope = yield* Effect.scope;
  const call = yield* Scope.fork(requestScope);
  const end = Scope.close(call, Exit.void);
  const answered = yield* use({ end, requestScope }).pipe(
    Scope.provide(call),
    Effect.onError(() => end)
  );
  if (!answered.streaming) {
    yield* end;
  }
  return answered.response;
});

/** The answer of a provider, as it comes out of the tunnel. */
interface ProviderAnswer {
  /** The provider's `Content-Type`, when it sent one. */
  readonly contentType: string | undefined;
  /**
   * Runs `use` on every piece of the body, in order, until the answer ends.
   * It fails with what the call failed with.
   */
  readonly eachPiece: <E, R>(
    use: (text: string) => Effect.Effect<void, E, R>
  ) => Effect.Effect<void, E | InferenceError, R>;
  /** Whether the body is a `text/event-stream`. */
  readonly isEventStream: boolean;
  /** The HTTP status the provider answered with. */
  readonly status: number;
}

/**
 * Sends `request` into the participant's tunnel and waits for the head of
 * the provider's answer. The `Infer` call lives in the scope: closing it
 * interrupts the call, which stops the provider.
 */
const askProvider = Effect.fnUntraced(function* (
  roomCode: string,
  participantId: string,
  request: InferenceRequest
): Effect.fn.Return<
  ProviderAnswer,
  InferenceError,
  HubSettings | Tunnels | Scope.Scope
> {
  const settings = yield* HubSettings;
  const tunnels = yield* Tunnels;
  const tunnel = yield* tunnels.client(roomCode, participantId).pipe(
    // The tunnel dropped between the routing and here.
    Effect.mapError(() => new ParticipantIsOffline({ roomCode, participantId }))
  );
  const chunks = yield* tunnel.Infer(request, { asQueue: true });

  const named = (error: CallError): InferenceError =>
    error._tag === "RpcClientError"
      ? new ParticipantDisconnected({ roomCode, participantId })
      : error;
  /**
   * The next chunk of the call. It fails with `Cause.Done` when the call
   * ended well, and with `InferenceTimedOut` when the participant sent
   * nothing for the idle timeout.
   */
  const next = Queue.take(chunks).pipe(
    Effect.timeoutOrElse({
      duration: settings.inferenceIdleTimeout,
      orElse: () =>
        Effect.fail(
          new InferenceTimedOut({
            roomCode,
            participantId,
            idleSeconds: Duration.toSeconds(settings.inferenceIdleTimeout),
          })
        ),
    }),
    Effect.mapError((error) => (Cause.isDone(error) ? error : named(error)))
  );

  const head = yield* next.pipe(
    Effect.catchIf(Cause.isDone, () =>
      Effect.fail(new ProviderResponseInterrupted())
    )
  );
  if (head._tag !== "Head") {
    return yield* new ProviderResponseInterrupted();
  }
  return {
    status: head.status,
    contentType: head.contentType,
    isEventStream:
      head.contentType?.toLowerCase().startsWith(EVENT_STREAM) === true,
    eachPiece: (use) =>
      next.pipe(
        Effect.flatMap((chunk) =>
          chunk._tag === "Body" ? use(chunk.text) : Effect.void
        ),
        Effect.forever,
        Effect.catchIf(Cause.isDone, () => Effect.void)
      ),
  };
});

/** What the hub does to a streamed answer on its way to the app. */
interface StreamForm {
  /** What goes to the app after the provider's last piece. */
  readonly end: Effect.Effect<string>;
  /** The last event of a stream that failed: the name of what went wrong. */
  readonly errorEvent: (error: InferenceError) => string;
  /** What goes to the app for one piece of the provider's body. */
  readonly piece: (text: string) => Effect.Effect<string>;
  /** What goes to the app before the provider's first piece. */
  readonly start: string;
}

/** A streamed answer that goes to the app as the provider sent it. */
const untouchedStream: StreamForm = {
  start: "",
  piece: Effect.succeed,
  end: Effect.succeed(""),
  errorEvent: toOpenAiStreamError,
};

/** The id of the Response an event of a streamed Response is about. */
const ResponseEvent = Schema.fromJsonString(
  Schema.Struct({ response: Schema.Struct({ id: Schema.String }) })
);
const readEventResponseId = Schema.decodeUnknownOption(ResponseEvent);

/**
 * A streamed Response that goes to the app as the provider sent it, while
 * the hub reads its events until one says the id of the Response (the first
 * one does), and calls `remember` with it.
 */
const streamOfStoredResponse = (
  remember: (responseId: string) => Effect.Effect<void>
): Effect.Effect<StreamForm> =>
  Effect.sync(() => {
    let searching = true;
    let found: string | undefined;
    const parser = Sse.makeParser((event) => {
      if (searching && event._tag === "Event") {
        found = Option.getOrUndefined(readEventResponseId(event.data))?.response
          .id;
        searching = found === undefined;
      }
    });
    return {
      ...untouchedStream,
      piece: (text) => {
        if (!searching) {
          return Effect.succeed(text);
        }
        // An event too long to be parsed is not the one with the id.
        searching = parser.feed(text) === undefined && searching;
        return found === undefined
          ? Effect.succeed(text)
          : Effect.as(remember(found), text);
      },
    };
  });

/** What the hub does to a provider's answer on its way to the app. */
interface AnswerForm {
  /**
   * Called with the whole body of an answer that is not a stream. What it
   * returns is the body the app gets.
   */
  readonly document: (text: string) => Effect.Effect<string>;
  /** Told how the answer went, for the events of the request. */
  readonly report: RequestReport;
  /** Called when an answer starts to stream. */
  readonly stream: Effect.Effect<StreamForm>;
}

/** An answer that goes to the app as the provider sent it, and that the room hears nothing of. */
const untouched: AnswerForm = {
  document: Effect.succeed,
  report: unreported,
  stream: Effect.succeed(untouchedStream),
};

/**
 * Turns a provider's answer into the HTTP response, with the status the
 * provider answered with.
 *
 * An answer that is not a stream is one document: the hub holds it until it
 * is whole, so that a failure in the middle is still an error response with
 * a name. A stream goes out piece by piece through the pump (see the top of
 * this file), which ends the call before it ends the body.
 */
const respond = Effect.fnUntraced(function* (
  call: Call,
  answer: ProviderAnswer,
  form: AnswerForm
): Effect.fn.Return<Answered, InferenceError> {
  const { roomCode, participantId } = call;
  const { report } = form;
  const options = {
    status: answer.status,
    ...(answer.contentType === undefined
      ? {}
      : { contentType: answer.contentType }),
  };

  if (!answer.isEventStream) {
    const parts: string[] = [];
    let size = 0;
    yield* answer.eachPiece((text) => {
      report.piece();
      parts.push(text);
      size += text.length;
      return size > MAX_HELD_RESPONSE_CHARACTERS
        ? Effect.fail(
            new ProviderResponseTooLarge({
              roomCode,
              participantId,
              limitCharacters: MAX_HELD_RESPONSE_CHARACTERS,
            })
          )
        : Effect.void;
    });
    const document = parts.join("");
    report.completed(answer.status, document);
    return {
      streaming: false,
      response: HttpServerResponse.text(
        yield* form.document(document),
        options
      ),
    };
  }

  const stream = yield* form.stream;
  const pending = yield* Queue.unbounded<string, InferenceError | Cause.Done>();
  let waiting = 0;
  const send = (text: string) => {
    waiting += text.length;
    if (waiting > MAX_PENDING_STREAM_CHARACTERS) {
      return Effect.fail(
        new ConsumerTooSlow({
          roomCode,
          participantId,
          limitCharacters: MAX_PENDING_STREAM_CHARACTERS,
        })
      );
    }
    if (text !== "") {
      Queue.offerUnsafe(pending, text);
    }
    return Effect.void;
  };
  report.streaming();
  // The pump: it never waits for the app, so the tunnel never waits for it.
  // It ends the call before it ends the body, so that when an app reads the
  // end of the response the participant is already free.
  yield* send(stream.start).pipe(
    Effect.andThen(
      answer.eachPiece((text) => {
        report.piece();
        return Effect.flatMap(stream.piece(text), send);
      })
    ),
    Effect.andThen(Effect.flatMap(stream.end, send)),
    Effect.tap(() => Effect.sync(() => report.completed(answer.status))),
    Effect.tapError((error) => {
      report.failed(error);
      return Effect.logInfo("inference stream ended early").pipe(
        Effect.annotateLogs({ error: error._tag, reason: error.message })
      );
    }),
    Effect.ensuring(call.end),
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Queue.end(pending)
        : Queue.failCause(pending, exit.cause)
    ),
    Effect.exit,
    Effect.forkIn(call.requestScope)
  );
  const body = Stream.fromQueue(pending).pipe(
    Stream.map((text) => {
      waiting -= text.length;
      return text;
    })
  );
  return {
    streaming: true,
    response: HttpServerResponse.stream(
      Stream.encodeText(eventStreamBody(body, stream.errorEvent)),
      { ...options, headers: { "Cache-Control": "no-cache" } }
    ),
  };
});

/**
 * Answers a failure of a route in the OpenAI error format, and a bug in the
 * hub with a 500 that says nothing of it.
 */
const answeringFailures =
  (operation: InferenceOperation) =>
  <R>(
    effect: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      InferenceError,
      R
    >,
    request: HttpServerRequest.HttpServerRequest
  ) =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logInfo("inference request refused").pipe(
          Effect.annotateLogs({ error: error._tag, reason: error.message })
        )
      ),
      Effect.catch((error) => Effect.succeed(errorResponse(error))),
      Effect.catchDefect((defect) =>
        Effect.logError("inference request failed", Cause.die(defect)).pipe(
          Effect.as(
            HttpServerResponse.jsonUnsafe(OPENAI_INTERNAL_ERROR, {
              status: 500,
            })
          )
        )
      ),
      Effect.annotateLogs({ operation, url: request.url })
    );

/** The id of the Response in a JSON document, when the document is a Response. */
const ResponseDocument = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String })
);
const readResponseId = Schema.decodeUnknownOption(ResponseDocument);

/** A status of `POST /v1/responses` that says the provider has no such route. */
const saysNoResponsesApi = (status: number) =>
  status === 404 || status === 405 || status === 501;

/**
 * Creates a Response on the provider of `participant`, in the API the
 * provider speaks.
 *
 * A provider that may speak the Responses API is asked in it, and keeps the
 * Response it creates. One that does not (its capabilities say so, or it
 * answers that it has no such route) is asked through Chat Completions, and
 * the hub writes the answer as a Response (`responses-translation.ts`). That
 * second request goes through the same call, so it is cancelled, timed out
 * and bounded like any other.
 */
const createResponse = Effect.fnUntraced(function* (
  call: Call,
  participant: DispatchedParticipant,
  body: RequestBody,
  report: RequestReport
) {
  const stored = yield* StoredResponses;
  const random = yield* SecureRandom.SecureRandom;
  const { roomCode, participantId } = call;
  const { capabilities } = participant;

  if (capabilities.openResponses !== "unsupported") {
    const attempt = yield* Scope.fork(yield* Effect.scope);
    const answer = yield* askProvider(roomCode, participantId, {
      operation: "responses.create",
      body: JSON.stringify(body),
    }).pipe(Scope.provide(attempt));
    if (!saysNoResponsesApi(answer.status)) {
      // The provider keeps the Response it created. Whoever asks for it
      // later is sent to this participant.
      const remember = (responseId: string) =>
        stored.remember(roomCode, responseId, {
          participantId,
          translated: false,
        });
      return yield* respond(call, answer, {
        report,
        document: (text) =>
          Option.match(readResponseId(text), {
            onNone: () => Effect.void,
            onSome: ({ id }) => remember(id),
          }).pipe(Effect.as(text)),
        stream: streamOfStoredResponse(remember),
      });
    }
    yield* Scope.close(attempt, Exit.void);
  }
  if (capabilities.chatCompletions === "unsupported") {
    return yield* new ResponsesNotSupported({ roomCode, participantId });
  }

  const chatBody = yield* toChatCompletionsRequest(body);
  const answer = yield* askProvider(roomCode, participantId, {
    operation: "chatCompletions.create",
    body: JSON.stringify(chatBody),
  });
  if (answer.status < 200 || answer.status >= 300) {
    // The provider refused the request. Its answer says why, in a format
    // the two APIs share, so the app gets it as it is.
    return yield* respond(call, answer, { ...untouched, report });
  }
  const translation: Translation = {
    responseId: `resp_${(yield* random.uuidV4()).replaceAll("-", "")}`,
    createdAt: Math.floor((yield* Clock.currentTimeMillis) / 1000),
    model: participant.model,
    request: body,
  };
  // The app may ask for this Response later. The hub remembers that it has
  // no provider behind it, to say so instead of "not found".
  const remember = stored.remember(roomCode, translation.responseId, {
    participantId,
    translated: true,
  });
  return yield* respond(call, answer, {
    report,
    document: (text) =>
      Option.match(toResponse(translation, text), {
        onNone: () => Effect.succeed(text),
        onSome: (response) => Effect.as(remember, response),
      }),
    stream: Effect.map(remember, (): StreamForm => {
      const events = toResponseEvents(translation);
      return {
        start: events.start,
        piece: (text) => Effect.sync(() => events.piece(text)),
        end: Effect.sync(events.end),
        errorEvent: (error) =>
          toOpenAiStreamError(error, events.nextSequenceNumber()),
      };
    }),
  });
});

/**
 * A route that creates something on a provider: the request is routed to a
 * participant by its model selector, and the participant is `busy` until
 * the call ends.
 */
const infer = (operation: InferenceCreation) =>
  Effect.fn("Hub.infer")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const params = yield* HttpRouter.params;
    const room = yield* rooms.get(params.code ?? "");
    const roomCode = room.code;
    const roomDefaults = yield* rooms.defaults(roomCode);
    const json = yield* request.json.pipe(
      Effect.mapError(
        () => new InvalidInferenceRequest({ issue: "Expected JSON." })
      )
    );
    const asked = yield* readRequest(json);

    return yield* withCall(
      Effect.fnUntraced(function* (scopes) {
        const participant = yield* Effect.acquireRelease(
          participants.dispatch(roomCode, asked.model),
          (dispatched) =>
            participants.transition(roomCode, dispatched.id, "requestEnded")
        );
        const participantId = participant.id;
        const call: Call = { ...scopes, roomCode, participantId };
        yield* Effect.annotateCurrentSpan({
          "gambi.room_code": roomCode,
          "gambi.participant_id": participantId,
          "gambi.operation": operation,
        });

        // From here on the room is told how the request ends.
        const report = yield* reportRequest(roomCode, {
          operation,
          participantId,
          model: participant.model,
          modelSelector: asked.model,
        });
        const body = providerBody(
          operation,
          asked.body,
          mergeDefaults(roomDefaults, participant.config),
          participant.model
        );
        const answering =
          operation === "responses.create"
            ? createResponse(call, participant, body, report)
            : askProvider(roomCode, participantId, {
                operation,
                body: JSON.stringify(body),
              }).pipe(
                Effect.flatMap((answer) =>
                  respond(call, answer, { ...untouched, report })
                )
              );
        return yield* answering.pipe(
          Effect.tapError((error) => Effect.sync(() => report.failed(error)))
        );
      })
    );
  }, answeringFailures(operation));

/** The query string of a request URL, without the `?`; empty when it has none. */
const queryOf = (url: string): string => {
  const at = url.indexOf("?");
  return at === -1 ? "" : url.slice(at + 1);
};

/**
 * A route about a Response a provider stored: reading it, deleting it,
 * cancelling it, listing its input items. It goes to the participant that
 * created the Response, whatever that participant is doing: an app cancels
 * a Response while its participant is `busy` answering it. So the request
 * is not dispatched, changes no status and is no event of the room.
 */
const storedResponse = (operation: StoredResponseOperation) =>
  Effect.fn("Hub.storedResponse")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const stored = yield* StoredResponses;
    const params = yield* HttpRouter.params;
    const room = yield* rooms.get(params.code ?? "");
    const roomCode = room.code;
    const responseId = params.id ?? "";
    const known = yield* stored.find(roomCode, responseId);
    if (known === undefined) {
      return yield* new ResponseNotFound({ roomCode, responseId });
    }
    if (known.translated) {
      return yield* new ResponseNotStored({ roomCode, responseId });
    }
    const { participantId } = known;
    // Without its participant in the room nobody can reach the Response. The
    // hub keeps what it knows: a participant that comes back under its id
    // brings its provider, and the Response, back with it.
    if ((yield* participants.status(roomCode, participantId)) === undefined) {
      return yield* new ResponseNotFound({ roomCode, responseId });
    }
    // Cancelling takes no parameters; the other operations take theirs in
    // the query, which goes to the provider as the app wrote it.
    const query = operation === "responses.cancel" ? "" : queryOf(request.url);
    yield* Effect.annotateCurrentSpan({
      "gambi.room_code": roomCode,
      "gambi.participant_id": participantId,
      "gambi.operation": operation,
    });

    return yield* withCall(
      Effect.fnUntraced(function* (scopes) {
        const call: Call = { ...scopes, roomCode, participantId };
        const answer = yield* askProvider(roomCode, participantId, {
          operation,
          responseId,
          ...(query === "" ? {} : { query }),
        });
        const succeeded = answer.status >= 200 && answer.status < 300;
        // The Response is gone from the provider: deleted now, or found
        // missing by an operation on the Response itself.
        const gone =
          operation === "responses.delete"
            ? succeeded || answer.status === 404
            : operation === "responses.retrieve" && answer.status === 404;
        if (gone) {
          yield* stored.forget(roomCode, responseId);
        }
        return yield* respond(call, answer, untouched);
      })
    );
  }, answeringFailures(operation));

/**
 * The participants of the room as an OpenAI list of models. The `id` of each
 * is its participant id, which is a model selector; `gambi` says what stands
 * behind it. A participant that is `offline`, or that shares no model
 * endpoint, is not a model.
 */
const listModels = Effect.fn("Hub.listModels")(
  function* () {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const params = yield* HttpRouter.params;
    const room = yield* rooms.get(params.code ?? "");
    const data = (yield* participants.list(room.code)).flatMap((participant) =>
      participant.status === "offline" || participant.endpoint === undefined
        ? []
        : [
            {
              id: participant.id,
              object: "model" as const,
              created: Math.floor(participant.joinedAt / 1000),
              owned_by: participant.nickname,
              gambi: {
                nickname: participant.nickname,
                model: participant.model,
                endpoint: participant.endpoint,
                capabilities: participant.capabilities,
                status: participant.status,
              },
            },
          ]
    );
    return HttpServerResponse.jsonUnsafe({ object: "list" as const, data });
  },
  Effect.catch((error) => Effect.succeed(errorResponse(error)))
);

/** The inference plane routes, ready for `HttpRouter.serve`. */
export const InferenceRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/rooms/:code/v1/models", listModels),
  HttpRouter.add(
    "POST",
    "/rooms/:code/v1/chat/completions",
    infer("chatCompletions.create")
  ),
  HttpRouter.add(
    "POST",
    "/rooms/:code/v1/responses",
    infer("responses.create")
  ),
  HttpRouter.add(
    "GET",
    "/rooms/:code/v1/responses/:id",
    storedResponse("responses.retrieve")
  ),
  HttpRouter.add(
    "DELETE",
    "/rooms/:code/v1/responses/:id",
    storedResponse("responses.delete")
  ),
  HttpRouter.add(
    "POST",
    "/rooms/:code/v1/responses/:id/cancel",
    storedResponse("responses.cancel")
  ),
  HttpRouter.add(
    "GET",
    "/rooms/:code/v1/responses/:id/input_items",
    storedResponse("responses.inputItems.list")
  )
).pipe(Layer.provide(RequestIdentity));
