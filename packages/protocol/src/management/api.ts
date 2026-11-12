/**
 * The management plane contract (ADR-0007). Hub handlers, the SDK client, the
 * CLI and the TUI all derive from `ManagementApi`; nothing else describes
 * these routes. The OpenAPI document comes from it too (`openapi.ts`).
 *
 * To add an operation: add an endpoint to a group here (or a new group, and
 * `.add` it to `ManagementApi`), wrap its success schema in `success` and each
 * error class in `failure`, then implement it in the hub. The compiler points
 * at the missing handler and at every client call that changed.
 */
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";
import {
  ParticipantId,
  ParticipantLeft,
  ParticipantRegistered,
  ParticipantSummary,
  RegisterParticipant,
} from "../participant.ts";
import { CreateRoom, RoomCode, RoomCreated, RoomSummary } from "../room.ts";
import { RoomEvent } from "../room-event.ts";
import { failure, success } from "./envelope.ts";
import {
  InternalError,
  InvalidPassword,
  InvalidRequest,
  ParticipantNotFound,
  RoomNotFound,
  VersionMismatch,
} from "./errors.ts";
import { eventStream } from "./event-stream.ts";

export const Health = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Milliseconds since the epoch, on the hub's clock. */
  timestamp: Schema.Finite,
});
export type Health = typeof Health.Type;

/**
 * The failures any operation can answer with: a request that does not match
 * the contract (`InvalidRequest`) and a bug in the hub (`InternalError`).
 * The hub implements it; clients only need its error schemas.
 */
export class ManagementFailures extends HttpApiMiddleware.Service<ManagementFailures>()(
  "gambi/protocol/ManagementFailures",
  { error: [failure(InvalidRequest), failure(InternalError)] }
) {}

export class HubGroup extends HttpApiGroup.make("hub")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: success(Health),
    })
  )
  .annotateMerge(
    OpenApi.annotations({ title: "Hub", description: "Hub liveness." })
  ) {}

export class RoomsGroup extends HttpApiGroup.make("rooms")
  .add(
    HttpApiEndpoint.post("create", "/rooms", {
      payload: CreateRoom,
      success: success(RoomCreated).pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.get("list", "/rooms", {
      success: success(Schema.Array(RoomSummary)),
    }),
    HttpApiEndpoint.get("get", "/rooms/:code", {
      params: { code: RoomCode },
      success: success(RoomSummary),
      error: failure(RoomNotFound),
    })
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Rooms",
      description: "Create, list and read rooms.",
    })
  ) {}

export class ParticipantsGroup extends HttpApiGroup.make("participants")
  .add(
    HttpApiEndpoint.put("register", "/rooms/:code/participants/:id", {
      params: { code: RoomCode, id: ParticipantId },
      payload: RegisterParticipant,
      success: success(ParticipantRegistered),
      error: [
        failure(RoomNotFound),
        failure(InvalidPassword),
        failure(VersionMismatch),
      ],
    }),
    HttpApiEndpoint.get("list", "/rooms/:code/participants", {
      params: { code: RoomCode },
      success: success(Schema.Array(ParticipantSummary)),
      error: failure(RoomNotFound),
    }),
    HttpApiEndpoint.delete("remove", "/rooms/:code/participants/:id", {
      params: { code: RoomCode, id: ParticipantId },
      success: success(ParticipantLeft),
      error: [failure(RoomNotFound), failure(ParticipantNotFound)],
    })
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Participants",
      description:
        "Register a participant, list the participants of a room, and take one out of it. Registration answers with the bootstrap token of the tunnel. A participant that leaves is removed at once and its tunnel closes; one that only loses its tunnel stays, offline, until it reconnects or the reconnection deadline passes.",
    })
  ) {}

export class EventsGroup extends HttpApiGroup.make("events")
  .add(
    HttpApiEndpoint.get("watch", "/rooms/:code/events", {
      params: { code: RoomCode },
      success: eventStream(RoomEvent),
      error: failure(RoomNotFound),
    })
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Events",
      description:
        "Watch a room: a Server-Sent Events stream that starts with a snapshot of the room and then carries every change, one event per change of a participant's status.",
    })
  ) {}

export class ManagementApi extends HttpApi.make("gambi-management")
  .add(HubGroup, RoomsGroup, ParticipantsGroup, EventsGroup)
  .prefix("/v1")
  .middleware(ManagementFailures)
  .annotateMerge(
    OpenApi.annotations({
      title: "Gambi management plane",
      description:
        "The Gambi-native HTTP surface of a hub: rooms, participants and room events.",
    })
  ) {}
