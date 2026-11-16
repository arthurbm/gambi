import { expect } from "bun:test";
import {
  GAMBI_VERSION,
  ParticipantNotFound,
  RoomNotFound,
} from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { Socket } from "effect/socket";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import { InferenceNotServed } from "../participant/inference.ts";
import {
  openTunnel,
  type ParticipantRuntimeOptions,
  register,
  TunnelOpenFailed,
} from "../participant/runtime.ts";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { Hub } from "./hub.ts";

layer(layerHub(), { excludeTestServices: true })("leaving a room", (it) => {
  it.effect(
    "a participant that leaves is removed at once: the room hears it, the list forgets it and its tunnel closes",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        const watch = yield* watchRoom(room.code);

        const left = yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
        });

        expect(left).toEqual({ participantId: "arthur-1" });
        // The one event of leaving: the participant is not shown going
        // offline on its way out.
        expect(yield* watch.next).toEqual({
          type: "participant.removed",
          roomCode: room.code,
          timestamp: expect.any(Number),
          participantId: "arthur-1",
          reason: "left",
        });
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toEqual([]);
        yield* participant.runtime.tunnelDropped;
      })
  );

  it.effect("a participant that never opened its tunnel can leave too", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Maracatu" },
      });
      yield* client.participants.register({
        params: { code: room.code, id: "arthur-1" },
        payload: {
          nickname: "Arthur",
          model: "llama3.1:8b",
          version: GAMBI_VERSION,
        },
      });

      yield* client.participants.remove({
        params: { code: room.code, id: "arthur-1" },
      });

      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toEqual([]);
    })
  );

  it.effect(
    "leaving refuses a room that does not exist and a participant that is not in the room",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Ciranda" },
        });

        const noRoom = yield* client.participants
          .remove({ params: { code: "NOROOM", id: "arthur-1" } })
          .pipe(Effect.flip);
        const noParticipant = yield* client.participants
          .remove({ params: { code: room.code, id: "arthur-1" } })
          .pipe(Effect.flip);
        const response = yield* HttpClient.execute(
          HttpClientRequest.delete(
            `${hub.url}/v1/rooms/${room.code}/participants/arthur-1`
          )
        );

        expect(noRoom).toBeInstanceOf(RoomNotFound);
        expect(noParticipant).toBeInstanceOf(ParticipantNotFound);
        expect(noParticipant.message).toBe(
          `Participant 'arthur-1' is not in room '${room.code}'.`
        );
        expect(response.status).toBe(404);
        expect(yield* response.json).toEqual({
          error: {
            code: "PARTICIPANT_NOT_FOUND",
            message: `Participant 'arthur-1' is not in room '${room.code}'.`,
            hint: "List the participants of the room to see the ids that are in it.",
            details: { roomCode: room.code, participantId: "arthur-1" },
          },
          meta: { requestId: expect.any(String) },
        });
      })
  );

  it.effect(
    "a bootstrap token issued before the participant left opens no tunnel",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Coco" },
        });
        const options: ParticipantRuntimeOptions = {
          hubUrl: hub.url,
          roomCode: room.code,
          participantId: "arthur-1",
          profile: { nickname: "Arthur", model: "llama3.1:8b" },
        };
        const { tunnel } = yield* register(options);
        yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
        });

        const error = yield* openTunnel(options, tunnel.token).pipe(
          Effect.flip
        );

        expect(error).toBeInstanceOf(TunnelOpenFailed);
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toEqual([]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TunnelDiagnostics,
            InferenceNotServed,
            Socket.layerWebSocketConstructorGlobal
          )
        )
      )
  );
});
