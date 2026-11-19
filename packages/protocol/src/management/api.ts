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
  HarnessAttachEvent,
  HarnessSessionId,
  HarnessSessionRef,
  OpenHarnessSession,
  SendHarnessMessage,
} from "../harness.ts";
import {
  ParticipantId,
  ParticipantLeft,
  ParticipantRegistered,
  ParticipantSummary,
  RegisterParticipant,
  RemoveParticipant,
} from "../participant.ts";
import { CreateRoom, RoomCode, RoomCreated, RoomSummary } from "../room.ts";
import { RoomEvent } from "../room-event.ts";
import {
  HarnessFailed,
  HarnessSessionNotOpen,
  HarnessSessionOutsideWorkspace,
} from "../tunnel/errors.ts";
import { failure, success } from "./envelope.ts";
import {
  InternalError,
  InvalidPassword,
  InvalidRequest,
  NotAHarnessParticipant,
  ParticipantNotFound,
  ParticipantOfAnotherRuntime,
  ParticipantUnreachable,
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
      query: RemoveParticipant,
      success: success(ParticipantLeft),
      error: [
        failure(RoomNotFound),
        failure(ParticipantNotFound),
        failure(ParticipantOfAnotherRuntime),
      ],
    })
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Participants",
      description:
        "Register a participant, list the participants of a room, and take one out of it. Registration answers with the bootstrap token of the tunnel. A removal names the participant runtime it takes out (`runtimeId`) and is refused when the participant belongs to another one by then. A participant that leaves is removed at once and its tunnel closes for good: its runtime does not come back. One that only loses its tunnel stays, offline, until it reconnects or the reconnection deadline passes.",
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

/** Why a harness participant cannot be reached at all. */
const notAHarness = [
  failure(RoomNotFound),
  failure(ParticipantNotFound),
  failure(NotAHarnessParticipant),
] as const;

/** Why a call to the harness of a participant did not get through. */
const harnessCallFailed = [
  ...notAHarness,
  failure(ParticipantUnreachable),
  failure(HarnessFailed),
] as const;

const harnessParams = { code: RoomCode, id: ParticipantId };
const harnessSessionParams = { ...harnessParams, sessionId: HarnessSessionId };

/**
 * Attaching to a harness participant (ADR-0006): a management client reads
 * what the harness says as a stream of events, and sends it ACP messages and
 * session control as ordinary requests. Any number of clients attach to the
 * same participant, and each stays attached while the participant's tunnel
 * is down.
 */
export class HarnessGroup extends HttpApiGroup.make("harness")
  .add(
    HttpApiEndpoint.get(
      "events",
      "/rooms/:code/participants/:id/harness/events",
      {
        params: harnessParams,
        success: eventStream(HarnessAttachEvent),
        error: notAHarness,
      }
    ),
    HttpApiEndpoint.post(
      "send",
      "/rooms/:code/participants/:id/harness/messages",
      {
        params: harnessParams,
        payload: SendHarnessMessage,
        success: success(HarnessSessionRef).pipe(HttpApiSchema.status(202)),
        error: [...harnessCallFailed, failure(HarnessSessionNotOpen)],
      }
    ),
    HttpApiEndpoint.put(
      "openSession",
      "/rooms/:code/participants/:id/harness/sessions/:sessionId",
      {
        params: harnessSessionParams,
        payload: OpenHarnessSession,
        success: success(HarnessSessionRef),
        error: [...harnessCallFailed, failure(HarnessSessionOutsideWorkspace)],
      }
    ),
    HttpApiEndpoint.delete(
      "closeSession",
      "/rooms/:code/participants/:id/harness/sessions/:sessionId",
      {
        params: harnessSessionParams,
        success: success(HarnessSessionRef),
        error: harnessCallFailed,
      }
    )
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Harness",
      description:
        "Attach to a harness participant: a Server-Sent Events stream of what its harness says (ACP v1 messages, the status of its sessions), and requests that send it an ACP message or open and close a harness session. The stream starts by saying whether the hub is receiving the harness; a client that reads too slowly is told how many events it lost.",
    })
  ) {}

export class ManagementApi extends HttpApi.make("gambi-management")
  .add(HubGroup, RoomsGroup, ParticipantsGroup, EventsGroup, HarnessGroup)
  .prefix("/v1")
  .middleware(ManagementFailures)
  .annotateMerge(
    OpenApi.annotations({
      title: "Gambi management plane",
      description:
        "The Gambi-native HTTP surface of a hub: rooms, participants and room events.",
    })
  ) {}
