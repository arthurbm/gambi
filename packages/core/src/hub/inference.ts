/**
 * The inference plane: the OpenAI-compatible routes under
 * `/rooms/:code/v1/*` that apps call. They are plain routes, outside the
 * management contract, because they pass a provider's answer through.
 *
 * | Route | What it does |
 * |---|---|
 * | `POST /rooms/:code/v1/chat/completions` | Chat Completions |
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
  type InferenceError,
  type InferenceOperation,
  InferenceTimedOut,
  InvalidInferenceRequest,
  OPENAI_INTERNAL_ERROR,
  ParticipantDisconnected,
  ParticipantOffline,
  ProviderResponseInterrupted,
  ProviderResponseTooLarge,
  type ProviderUnreachable,
  toOpenAiError,
  toOpenAiStreamError,
} from "@gambi/protocol";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  Queue,
  Scope,
  Stream,
} from "effect";
import {
  HttpRouter,
  type HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { RpcClientError } from "effect/rpc";
import {
  mergeDefaults,
  providerBody,
  readRequest,
} from "./inference-request.ts";
import { Participants } from "./participants.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
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
 * How much of an unfinished server-sent event the hub holds while it waits
 * for the end of the event, in characters. Past it the text goes out as it is.
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
 */
const eventStreamBody = (
  pieces: Stream.Stream<string, InferenceError>
): Stream.Stream<string> =>
  Stream.suspend(() => {
    let held = "";
    return pieces.pipe(
      Stream.map((piece) => {
        const text = held + piece;
        const end =
          text.length > MAX_HELD_EVENT_CHARACTERS
            ? text.length
            : endOfLastEvent(text);
        held = text.slice(end);
        return text.slice(0, end);
      }),
      Stream.concat(Stream.suspend(() => Stream.make(held))),
      Stream.catch((error) => Stream.make(toOpenAiStreamError(error))),
      Stream.filter((text) => text !== "")
    );
  });

const infer = (operation: InferenceOperation) =>
  Effect.fn("Hub.infer")(
    function* (request: HttpServerRequest.HttpServerRequest) {
      const settings = yield* HubSettings;
      const rooms = yield* Rooms;
      const participants = yield* Participants;
      const tunnels = yield* Tunnels;
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

      const requestScope = yield* Effect.scope;
      const call = yield* Scope.fork(requestScope);
      const endCall = Scope.close(call, Exit.void);

      const answer = Effect.gen(function* () {
        const participant = yield* Effect.acquireRelease(
          participants.dispatch(roomCode, asked.model),
          (dispatched) =>
            participants.transition(roomCode, dispatched.id, "requestEnded")
        );
        const participantId = participant.id;
        yield* Effect.annotateCurrentSpan({
          "gambi.room_code": roomCode,
          "gambi.participant_id": participantId,
          "gambi.operation": operation,
        });

        const tunnel = yield* tunnels.client(roomCode, participantId).pipe(
          // The tunnel dropped between the routing and here.
          Effect.mapError(
            () => new ParticipantOffline({ roomCode, participantId })
          )
        );
        const chunks = yield* tunnel.Infer(
          {
            operation,
            body: providerBody(
              operation,
              asked.body,
              mergeDefaults(roomDefaults, participant.config),
              participant.model
            ),
          },
          { asQueue: true }
        );

        const named = (error: CallError): InferenceError =>
          error._tag === "RpcClientError"
            ? new ParticipantDisconnected({ roomCode, participantId })
            : error;
        /**
         * The next chunk of the call. It fails with `Cause.Done` when the
         * call ended well, and with `InferenceTimedOut` when the participant
         * sent nothing for the idle timeout.
         */
        const next = Queue.take(chunks).pipe(
          Effect.timeoutOrElse({
            duration: settings.inferenceIdleTimeout,
            orElse: () =>
              Effect.fail(
                new InferenceTimedOut({
                  roomCode,
                  participantId,
                  idleSeconds: Duration.toSeconds(
                    settings.inferenceIdleTimeout
                  ),
                })
              ),
          }),
          Effect.mapError((error) =>
            Cause.isDone(error) ? error : named(error)
          )
        );
        /** Every piece of the body, in order, until the call ends. */
        const eachPiece = <E, R>(
          use: (text: string) => Effect.Effect<void, E, R>
        ) =>
          next.pipe(
            Effect.flatMap((chunk) =>
              chunk._tag === "Body" ? use(chunk.text) : Effect.void
            ),
            Effect.forever,
            Effect.catchIf(Cause.isDone, () => Effect.void)
          );

        const head = yield* next.pipe(
          Effect.catchIf(Cause.isDone, () =>
            Effect.fail(new ProviderResponseInterrupted())
          )
        );
        if (head._tag !== "Head") {
          return yield* new ProviderResponseInterrupted();
        }
        const options = {
          status: head.status,
          ...(head.contentType === undefined
            ? {}
            : { contentType: head.contentType }),
        };

        if (head.contentType?.toLowerCase().startsWith(EVENT_STREAM) !== true) {
          // Anything that is not a stream is one JSON document. The hub
          // holds it until it is whole, so that a failure in the middle is
          // still an error response with a name, not a document cut short.
          const parts: string[] = [];
          let size = 0;
          yield* eachPiece((text) => {
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
          return {
            streaming: false,
            response: HttpServerResponse.text(parts.join(""), options),
          };
        }

        const pending = yield* Queue.unbounded<
          string,
          InferenceError | Cause.Done
        >();
        let waiting = 0;
        // The pump: it never waits for the app, so the tunnel never waits
        // for it. It ends the call before it ends the body, so that when an
        // app reads the end of the response the participant is already free.
        yield* eachPiece((text) => {
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
          Queue.offerUnsafe(pending, text);
          return Effect.void;
        }).pipe(
          Effect.ensuring(endCall),
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Queue.end(pending)
              : Queue.failCause(pending, exit.cause)
          ),
          Effect.exit,
          Effect.forkIn(requestScope)
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
            Stream.encodeText(eventStreamBody(body)),
            { ...options, headers: { "Cache-Control": "no-cache" } }
          ),
        };
      }).pipe(Scope.provide(call));

      // A streamed answer keeps the call open, and its pump closes it.
      // Everything else is done with the call by the time it answers.
      const answered = yield* answer.pipe(Effect.onError(() => endCall));
      if (!answered.streaming) {
        yield* endCall;
      }
      return answered.response;
    },
    (effect, request) =>
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
      )
  );

/** The inference plane routes, ready for `HttpRouter.serve`. */
export const InferenceRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/rooms/:code/v1/chat/completions",
    infer("chatCompletions.create")
  )
);
