/**
 * The hub side of attaching to a harness participant: the handlers of the
 * `harness` group of the management contract.
 *
 * Reading goes through `HarnessClients` (the events the participant sends up
 * its long-lived stream). Writing is an ordinary tunnel call each time: the
 * hub hands the message or the session control to the participant and
 * answers with what the participant answered.
 */
import {
  type CallNotSupported,
  ManagementApi,
  NotAHarnessParticipant,
  ParticipantNotFound,
  ParticipantUnreachable,
} from "@gambi/protocol";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { RpcClientError } from "effect/rpc";
import { HarnessClients } from "./harness-clients.ts";
import { OpenStreams } from "./open-streams.ts";
import { Participants } from "./participants.ts";
import { Rooms } from "./rooms.ts";
import { type TunnelClient, type TunnelNotOpen, Tunnels } from "./tunnels.ts";

/** What a call can fail with because of the tunnel, not of the harness. */
type TunnelFailure =
  | TunnelNotOpen
  | RpcClientError.RpcClientError
  | CallNotSupported;

export const HarnessHandlers = HttpApiBuilder.group(
  ManagementApi,
  "harness",
  Effect.fn(function* (handlers) {
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const tunnels = yield* Tunnels;
    const clients = yield* HarnessClients;
    const streams = yield* OpenStreams;

    /** The harness participant a request is about, or why there is none. */
    const harnessParticipant = Effect.fnUntraced(function* (params: {
      readonly code: string;
      readonly id: string;
    }) {
      const room = yield* rooms.get(params.code);
      const target = { roomCode: room.code, participantId: params.id };
      const participant = yield* participants.get(room.code, params.id);
      if (participant === undefined) {
        return yield* new ParticipantNotFound(target);
      }
      if (participant.harness === undefined) {
        return yield* new NotAHarnessParticipant(target);
      }
      return target;
    });

    /**
     * One call to the participant through its tunnel, as it is now. What the
     * tunnel itself says becomes an error of the management plane; what the
     * harness says passes as it is.
     */
    const call = <A, E extends { readonly _tag: string }>(
      params: { readonly code: string; readonly id: string },
      make: (tunnel: TunnelClient) => Effect.Effect<A, E>
    ) =>
      Effect.gen(function* () {
        const target = yield* harnessParticipant(params);
        return yield* tunnels
          .client(target.roomCode, target.participantId)
          .pipe(
            Effect.flatMap(make),
            Effect.scoped,
            Effect.mapError(
              (
                error
              ):
                | ParticipantUnreachable
                | NotAHarnessParticipant
                | Exclude<E, TunnelFailure> => {
                switch (error._tag) {
                  // No tunnel now, or it dropped with the call in flight.
                  case "TunnelNotOpen":
                  case "RpcClientError":
                    return new ParticipantUnreachable(target);
                  // It registered a harness and serves none.
                  case "CallNotSupported":
                    return new NotAHarnessParticipant(target);
                  default:
                    return error as Exclude<E, TunnelFailure>;
                }
              }
            )
          );
      });

    return handlers.handleAll({
      events: Effect.fn("Harness.attach")(function* ({ params }) {
        // What cannot be attached to is refused before the stream starts.
        const { roomCode, participantId } = yield* harnessParticipant(params);
        // Attached before the hub answers, for as long as the request lives:
        // its scope closes when the response ends or the client goes away.
        const events = yield* clients.attach(roomCode, participantId);
        // Asked again now that the client is attached. A participant that
        // left in between detached nobody, and this client would wait for
        // ever; one that leaves from here on detaches it.
        yield* harnessParticipant(params);
        return streams.untilHubCloses(events);
      }),
      send: Effect.fn("Harness.send")(function* ({ params, payload }) {
        yield* call(params, (tunnel) => tunnel.HarnessSend(payload));
        return { sessionId: payload.sessionId };
      }),
      openSession: Effect.fn("Harness.openSession")(function* ({
        params,
        payload,
      }) {
        const { sessionId } = params;
        yield* call(params, (tunnel) =>
          tunnel.HarnessOpenSession({ sessionId, ...payload })
        );
        return { sessionId };
      }),
      closeSession: Effect.fn("Harness.closeSession")(function* ({ params }) {
        const { sessionId } = params;
        yield* call(params, (tunnel) =>
          tunnel.HarnessCloseSession({ sessionId })
        );
        return { sessionId };
      }),
    });
  })
);
