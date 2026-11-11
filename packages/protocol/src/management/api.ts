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
import { CreateRoom, RoomCode, RoomCreated, RoomSummary } from "../room.ts";
import { failure, success } from "./envelope.ts";
import { InternalError, InvalidRequest, RoomNotFound } from "./errors.ts";

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

export class ManagementApi extends HttpApi.make("gambi-management")
  .add(HubGroup, RoomsGroup)
  .prefix("/v1")
  .middleware(ManagementFailures)
  .annotateMerge(
    OpenApi.annotations({
      title: "Gambi management plane",
      description:
        "The Gambi-native HTTP surface of a hub: rooms, participants and room events.",
    })
  ) {}
