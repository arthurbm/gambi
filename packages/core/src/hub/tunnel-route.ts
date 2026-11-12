/**
 * The route a participant runtime dials to open its tunnel:
 * `GET /v1/rooms/:code/participants/:id/tunnel?token=<bootstrap token>`,
 * a WebSocket upgrade. The participant opens it; the hub never dials out.
 *
 * It is not part of the management contract, because an upgrade is not a
 * request and response. A refusal still answers in the management envelope.
 */
import {
  failure,
  InvalidRequest,
  type ManagementError,
  type ManagementErrorClass,
  TunnelTokenInvalid,
} from "@gambi/protocol";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { RequestIdentity } from "./management.ts";
import { Rooms } from "./rooms.ts";
import { Tunnels } from "./tunnels.ts";

/** Answers a refusal in the management envelope, with the status the error declares. */
const refuse = <Self extends ManagementError>(
  errorClass: ManagementErrorClass<Self>,
  error: Self
) =>
  Schema.encodeEffect(failure(errorClass))(error).pipe(
    Effect.orDie,
    Effect.map((body) =>
      HttpServerResponse.jsonUnsafe(body, { status: errorClass.status })
    )
  );

const openTunnel = Effect.fn("Hub.openTunnel")(function* (
  request: HttpServerRequest.HttpServerRequest
) {
  const rooms = yield* Rooms;
  const tunnels = yield* Tunnels;
  const params = yield* HttpRouter.params;
  const search = yield* HttpServerRequest.ParsedSearchParams;
  const participantId = params.id ?? "";
  const token = typeof search.token === "string" ? search.token : undefined;

  // Any refusal says the same thing, so the route does not tell a caller
  // without a token which rooms and participants exist.
  const invalid = (roomCode: string) =>
    refuse(
      TunnelTokenInvalid,
      new TunnelTokenInvalid({ roomCode, participantId })
    );
  const room = yield* Effect.result(rooms.get(params.code ?? ""));
  if (room._tag === "Failure") {
    return yield* invalid(params.code ?? "");
  }
  const roomCode = room.success.code;
  const redeemed = yield* Effect.result(
    tunnels.redeemToken(roomCode, participantId, token)
  );
  if (redeemed._tag === "Failure") {
    return yield* invalid(roomCode);
  }

  // The token is spent by now, whatever the upgrade does: a caller that
  // fails here registers again.
  const upgraded = yield* Effect.result(request.upgrade);
  if (upgraded._tag === "Failure") {
    return yield* refuse(
      InvalidRequest,
      new InvalidRequest({
        issues: [
          {
            path: ["headers", "upgrade"],
            message: "The tunnel is a WebSocket: send an upgrade request.",
          },
        ],
      })
    );
  }
  yield* tunnels.serve(roomCode, participantId, upgraded.success);
  return HttpServerResponse.empty();
});

/**
 * The tunnel route, ready for `HttpRouter.serve`. The path is the one
 * `tunnelPath` (in `@gambi/protocol`) builds for the participant runtime.
 */
export const TunnelRoute = HttpRouter.add(
  "GET",
  "/v1/rooms/:code/participants/:id/tunnel",
  openTunnel
).pipe(Layer.provide(RequestIdentity));
