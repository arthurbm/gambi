/**
 * The hub side of the management plane contract: one handler per endpoint of
 * `ManagementApi`, plus what every management request gets (a request id, the
 * typed answers for a bad request and for a bug).
 *
 * A new group of the contract gets its handlers here, with
 * `HttpApiBuilder.group(ManagementApi, "<group>", ...)`, and is added to
 * `ManagementHandlers`. The compiler rejects the hub until it is.
 */
import {
  failure,
  InternalError,
  InvalidRequest,
  ManagementApi,
  type ManagementError,
  type ManagementErrorClass,
  ManagementFailures,
  RequestId,
  RouteNotFound,
} from "@gambi/protocol";
import {
  Cause,
  Clock,
  Effect,
  Layer,
  Schema,
  SchemaIssue,
  type Types,
} from "effect";
import { SecureRandom } from "effect/crypto";
import {
  HttpRouter,
  type HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { HarnessHandlers } from "./harness-attach.ts";
import { OpenStreams } from "./open-streams.ts";
import { Participants } from "./participants.ts";
import { leaveRoom, registerParticipant } from "./registration.ts";
import { RoomEvents } from "./room-events.ts";
import { Rooms } from "./rooms.ts";

const HubHandlers = HttpApiBuilder.group(ManagementApi, "hub", (handlers) =>
  handlers.handle(
    "health",
    Effect.fn("Hub.health")(function* () {
      return {
        status: "ok" as const,
        timestamp: yield* Clock.currentTimeMillis,
      };
    })
  )
);

const RoomsHandlers = HttpApiBuilder.group(
  ManagementApi,
  "rooms",
  Effect.fn(function* (handlers) {
    const rooms = yield* Rooms;
    return handlers.handleAll({
      create: ({ payload }) => rooms.create(payload),
      get: ({ params }) => rooms.get(params.code),
      list: () => rooms.list,
    });
  })
);

const ParticipantsHandlers = HttpApiBuilder.group(
  ManagementApi,
  "participants",
  Effect.fn(function* (handlers) {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    return handlers.handleAll({
      register: ({ params, payload }) =>
        registerParticipant(params.code, params.id, payload),
      list: Effect.fn("Participants.list")(function* ({ params }) {
        const room = yield* rooms.get(params.code);
        return yield* participants.list(room.code);
      }),
      remove: ({ params, query }) =>
        leaveRoom(params.code, params.id, query.runtimeId),
    });
  })
);

const EventsHandlers = HttpApiBuilder.group(
  ManagementApi,
  "events",
  Effect.fn(function* (handlers) {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const events = yield* RoomEvents;
    const streams = yield* OpenStreams;
    return handlers.handle(
      "watch",
      Effect.fn("Events.watch")(function* ({ params }) {
        // A room that does not exist is refused before the stream starts.
        const { code } = yield* rooms.get(params.code);
        const snapshot = Effect.all({
          room: Effect.orDie(rooms.get(code)),
          participants: participants.list(code),
        });
        return streams.untilHubCloses(events.watch(code, snapshot));
      })
    );
  })
);

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const toRequestIssues = (error: HttpApiError.HttpApiSchemaError) => {
  const slot = error.kind.toLowerCase();
  return formatIssues(error.cause.issue).issues.map((issue) => ({
    path: [
      slot,
      ...(issue.path ?? []).map((segment) => {
        const key = typeof segment === "object" ? segment.key : segment;
        return typeof key === "number" ? key : String(key);
      }),
    ],
    message: issue.message,
  }));
};

/**
 * A request that does not match the contract answers `InvalidRequest` with
 * the issues found. A defect, or a response the hub cannot encode, is logged
 * with its cause and answers `InternalError`, which carries no detail.
 */
const ManagementFailuresLive = Layer.succeed(ManagementFailures, (httpEffect) =>
  httpEffect.pipe(
    Effect.catch(
      (error): Effect.Effect<never, Types.unhandled | InvalidRequest> => {
        if (!HttpApiError.HttpApiSchemaError.is(error)) {
          return Effect.fail(error);
        }
        if (error.kind === "Body" || error.kind === "ResponseHeaders") {
          return Effect.die(error);
        }
        return Effect.fail(
          new InvalidRequest({ issues: toRequestIssues(error) })
        );
      }
    ),
    Effect.catchDefect((defect) =>
      Effect.logError("management request failed", Cause.die(defect)).pipe(
        Effect.andThen(Effect.fail(new InternalError({})))
      )
    )
  )
);

/**
 * Gives every request a `RequestId`: the envelope reads it, and every log line
 * and span of the request carries it.
 */
export const RequestIdentity = HttpRouter.middleware<{ provides: RequestId }>()(
  Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom;
    return (httpEffect) =>
      Effect.gen(function* () {
        const requestId = yield* random.uuidV4();
        yield* Effect.annotateCurrentSpan("gambi.request_id", requestId);
        return yield* httpEffect.pipe(
          Effect.provideService(RequestId, requestId),
          Effect.annotateLogs({ requestId })
        );
      });
  }),
  { global: true }
);

/**
 * Answers a refusal in the management envelope, with the status the error
 * declares. For a route outside the contract (an upgrade, a fallback); a
 * handler of the contract just fails with the error.
 */
export const refuse = <Self extends ManagementError>(
  errorClass: ManagementErrorClass<Self>,
  error: Self
) =>
  Schema.encodeEffect(failure(errorClass))(error).pipe(
    Effect.orDie,
    Effect.map((body) =>
      HttpServerResponse.jsonUnsafe(body, { status: errorClass.status })
    )
  );

/**
 * What the management plane answers where it has no route: the error
 * envelope, like every other refusal. The router tries it last, so it shadows
 * no route; the inference plane, outside `/v1`, answers for itself.
 */
const RouteNotFoundFallback = HttpRouter.add(
  "*",
  "/v1/*",
  Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
    const path = request.url.split("?")[0] ?? request.url;
    return yield* refuse(
      RouteNotFound,
      new RouteNotFound({ method: request.method, path })
    );
  })
);

/** The path of the OpenAPI document the hub serves, generated from the contract. */
export const OPENAPI_PATH = "/v1/openapi.json";

/** The management plane routes, ready for `HttpRouter.serve`. */
export const ManagementRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(ManagementApi, { openapiPath: OPENAPI_PATH }).pipe(
    Layer.provide([
      HubHandlers,
      RoomsHandlers,
      ParticipantsHandlers,
      EventsHandlers,
      HarnessHandlers,
    ]),
    Layer.provide(ManagementFailuresLive)
  ),
  RouteNotFoundFallback,
  HttpRouter.cors()
).pipe(Layer.provide(RequestIdentity));
