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
 * The request lives in the scope of the HTTP request, which stays open until
 * the response body ends. So the participant is `busy`, and the call in its
 * tunnel is open, for exactly as long as the app is being answered. When
 * the app goes away, the scope closes: the call is interrupted, which stops
 * the provider, and the participant is `online` again.
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
  type InferenceChunk,
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
import { Cause, Duration, Effect, Layer, Queue, Stream } from "effect";
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
import { type DispatchedParticipant, Participants } from "./participants.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
import { Tunnels } from "./tunnels.ts";

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

      // Acquired in the scope of the request: released when the response
      // body ends, however it ends.
      const participant: DispatchedParticipant = yield* Effect.acquireRelease(
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

      const disconnected = new ParticipantDisconnected({
        roomCode,
        participantId,
      });
      const timedOut = new InferenceTimedOut({
        roomCode,
        participantId,
        idleSeconds: Duration.toSeconds(settings.inferenceIdleTimeout),
      });
      const named = (error: CallError): InferenceError =>
        error._tag === "RpcClientError" ? disconnected : error;

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

      const head = yield* Queue.take(chunks).pipe(
        Effect.timeoutOrElse({
          duration: settings.inferenceIdleTimeout,
          orElse: () => Effect.fail(timedOut),
        }),
        Effect.catchIf(Cause.isDone, () =>
          Effect.fail(new ProviderResponseInterrupted())
        ),
        Effect.mapError(named)
      );
      if (head._tag !== "Head") {
        return yield* new ProviderResponseInterrupted();
      }
      // The rest of the call: the body, piece by piece, pulled only as fast
      // as it is consumed. No piece for the idle timeout ends it.
      const pieces = Stream.fromQueue(chunks).pipe(
        Stream.timeoutOrElse({
          duration: settings.inferenceIdleTimeout,
          orElse: () => Stream.fail(timedOut),
        }),
        Stream.mapError(named),
        Stream.map((chunk: InferenceChunk) =>
          chunk._tag === "Body" ? chunk.text : ""
        )
      );
      const options = {
        status: head.status,
        ...(head.contentType === undefined
          ? {}
          : { contentType: head.contentType }),
      };

      if (head.contentType?.toLowerCase().startsWith(EVENT_STREAM) === true) {
        return HttpServerResponse.stream(
          Stream.encodeText(eventStreamBody(pieces)),
          { ...options, headers: { "Cache-Control": "no-cache" } }
        );
      }
      // Anything that is not a stream is one JSON document. The hub holds it
      // until it is whole, so that a failure in the middle is still an error
      // response with a name, not a document cut short.
      const held = yield* pieces.pipe(
        Stream.runFoldEffect(
          () => ({ parts: [] as string[], size: 0 }),
          (document, piece) => {
            document.parts.push(piece);
            document.size += piece.length;
            return document.size > MAX_HELD_RESPONSE_CHARACTERS
              ? Effect.fail(
                  new ProviderResponseTooLarge({
                    roomCode,
                    participantId,
                    limitCharacters: MAX_HELD_RESPONSE_CHARACTERS,
                  })
                )
              : Effect.succeed(document);
          }
        )
      );
      return HttpServerResponse.text(held.parts.join(""), options);
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
