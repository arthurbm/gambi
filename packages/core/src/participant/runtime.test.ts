import { expect } from "bun:test";
import {
  InvalidPassword,
  RoomNotFound,
  TunnelRpcs,
  VersionMismatch,
} from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { Tunnels } from "../hub/tunnels.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { HubUnreachable } from "./runtime.ts";

const NO_HUB_AT_LOOPBACK =
  /^No Gambi hub answered at http:\/\/127\.0\.0\.1:\d+\.$/;

const participantsOf = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return yield* client.participants.list({ params: { code: roomCode } });
  });

layer(layerHub({ version: "0.8.3" }), { excludeTestServices: true })(
  "participant runtime",
  (it) => {
    it.effect(
      "ends with the hub's refusal when it runs another minor, and does not join",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Frevo" },
          });

          const error = yield* joinParticipant({
            roomCode: room.code,
            version: "0.9.0",
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(VersionMismatch);
          expect(error.message).toBe(
            "This hub runs Gambi 0.8.3 and expects participants on 0.8.x; this participant runs 0.9.0."
          );
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect("joins when it runs another patch of the hub's minor", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Maracatu" },
        });

        const participant = yield* joinParticipant({
          roomCode: room.code,
          version: "0.8.0",
        });

        expect(participant.runtime.participant.status).toBe("offline");
        expect(
          (yield* participantsOf(room.code)).map((listed) => listed.status)
        ).toEqual(["online"]);
      })
    );

    it.effect(
      "ends with the hub's refusal for a wrong password or a missing room",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Ciranda", password: "sanfona" },
          });

          const wrongPassword = yield* joinParticipant({
            roomCode: room.code,
            password: "zabumba",
            version: "0.8.3",
          }).pipe(Effect.flip);
          const noRoom = yield* joinParticipant({
            roomCode: "NOROOM",
            version: "0.8.3",
          }).pipe(Effect.flip);
          const joined = yield* joinParticipant({
            roomCode: room.code,
            password: "sanfona",
            version: "0.8.3",
          });

          expect(wrongPassword).toBeInstanceOf(InvalidPassword);
          expect(noRoom).toBeInstanceOf(RoomNotFound);
          expect(joined.runtime.participant.id).toBe("participant-1");
        })
    );

    it.effect(
      "sends the hub nothing of what its handlers hold: ParticipantAuthHeaders stay on the participant",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const tunnels = yield* Tunnels;
          const { room } = yield* client.rooms.create({
            payload: { name: "Coco" },
          });
          // The handlers are where a host keeps the provider credentials.
          const authHeaders = { authorization: "Bearer sk-participant-secret" };
          const withCredentials = Layer.mergeAll(
            TunnelRpcs.toLayerHandler("Echo", ({ text }) =>
              Effect.succeed(
                authHeaders.authorization.length > 0 ? text : "no credentials"
              )
            ),
            TunnelRpcs.toLayerHandler("Ticks", ({ count }) =>
              Stream.range(1, count)
            )
          );
          const participant = yield* joinParticipant({
            roomCode: room.code,
            version: "0.8.3",
            handlers: withCredentials,
          });
          const tunnel = yield* tunnels.client(room.code, "participant-1");
          yield* tunnel.Echo({ text: "olinda" });
          yield* Stream.runDrain(tunnel.Ticks({ count: 3 }));

          const sent = yield* participant.sentToHub;

          // The registration, the dial, and the answers of the three calls
          // (the welcome, the echo and the ticks).
          expect(sent.some((line) => line.startsWith("PUT "))).toBe(true);
          expect(sent.some((line) => line.startsWith("DIAL ws://"))).toBe(true);
          expect(sent.some((line) => line.includes('"olinda"'))).toBe(true);
          expect(sent.join("\n")).not.toContain("sk-participant-secret");
          expect(sent.join("\n").toLowerCase()).not.toContain("authheaders");
          expect(sent.join("\n").toLowerCase()).not.toContain("authorization");
        })
    );
  }
);

it.live("ends with HubUnreachable when no hub answers", () =>
  Effect.gen(function* () {
    // A port that was a hub a moment ago and is closed now.
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(layerHub(), scope);
    yield* Scope.close(scope, Exit.void);

    const error = yield* joinParticipant({ roomCode: "AB12CD" }).pipe(
      Effect.provide(context),
      Effect.flip
    );

    expect(error).toBeInstanceOf(HubUnreachable);
    expect(error.message).toMatch(NO_HUB_AT_LOOPBACK);
  })
);
