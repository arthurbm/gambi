import { expect } from "bun:test";
import { GAMBI_VERSION, tunnelUrl } from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import { Clock, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { Socket } from "effect/socket";
import { TestClock } from "effect/testing";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import {
  openTunnel,
  type ParticipantRuntimeOptions,
  register,
  TunnelOpenFailed,
} from "../participant/runtime.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { Hub } from "./hub.ts";

/** The options of a participant runtime for a new room of the hub in the environment. */
const participantIn = (roomName: string, participantId = "arthur-1") =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({
      payload: { name: roomName },
    });
    const options: ParticipantRuntimeOptions = {
      hubUrl: hub.url,
      roomCode: room.code,
      participantId,
      profile: { nickname: "Arthur", model: "llama3.1:8b" },
    };
    const statuses = client.participants
      .list({ params: { code: room.code } })
      .pipe(
        Effect.map((participants) =>
          participants.map((participant) => [
            participant.id,
            participant.status,
          ])
        )
      );
    return { options, statuses };
  });

/** What a participant runtime needs to dial and serve. */
const Platform = Layer.mergeAll(
  TunnelDiagnostics,
  Socket.layerWebSocketConstructorGlobal
);

/** The tunnel route asked without an upgrade, to read the refusal on the wire. */
const refusal = (url: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(url.replace("ws://", "http://"))
    );
    return { status: response.status, body: yield* response.json };
  });

layer(layerHub(), { excludeTestServices: true })("bootstrap token", (it) => {
  it.effect("opens one tunnel and no second one", () =>
    Effect.gen(function* () {
      const { options, statuses } = yield* participantIn("Frevo");
      const { tunnel } = yield* register(options);

      yield* openTunnel(options, tunnel.token);
      const again = yield* openTunnel(options, tunnel.token).pipe(Effect.flip);
      const onTheWire = yield* refusal(
        tunnelUrl(
          options.hubUrl,
          options.roomCode,
          options.participantId,
          tunnel.token
        )
      );

      expect(again).toBeInstanceOf(TunnelOpenFailed);
      expect(onTheWire.status).toBe(401);
      expect(onTheWire.body).toEqual({
        error: {
          code: "TUNNEL_TOKEN_INVALID",
          message: `The bootstrap token for participant 'arthur-1' in room '${options.roomCode}' is missing, expired or already used.`,
          hint: "Register the participant again to get a new token; it is valid for 60 seconds and for one tunnel.",
          details: { roomCode: options.roomCode, participantId: "arthur-1" },
        },
        meta: { requestId: expect.any(String) },
      });
      // The refused dial did not disturb the tunnel that is open.
      expect(yield* statuses).toEqual([["arthur-1", "online"]]);
    }).pipe(Effect.provide(Platform))
  );

  it.effect("is refused when it is missing or was never issued", () =>
    Effect.gen(function* () {
      const { options, statuses } = yield* participantIn("Maracatu");
      yield* register(options);
      const base = tunnelUrl(
        options.hubUrl,
        options.roomCode,
        options.participantId,
        ""
      );

      const missing = yield* refusal(base.replace("?token=", ""));
      const invented = yield* openTunnel(options, "not-a-token").pipe(
        Effect.flip
      );

      expect(missing.status).toBe(401);
      expect(invented).toBeInstanceOf(TunnelOpenFailed);
      expect(yield* statuses).toEqual([["arthur-1", "offline"]]);
    }).pipe(Effect.provide(Platform))
  );

  it.effect(
    "opens the tunnel of the participant it was issued for, and no other",
    () =>
      Effect.gen(function* () {
        const { options, statuses } = yield* participantIn("Ciranda");
        const client = yield* managementClient;
        const { tunnel } = yield* register(options);
        yield* client.participants.register({
          params: { code: options.roomCode, id: "other" },
          payload: { nickname: "Other", model: "m", version: GAMBI_VERSION },
        });

        const error = yield* openTunnel(
          { ...options, participantId: "other" },
          tunnel.token
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(TunnelOpenFailed);
        expect(yield* statuses).toEqual([
          ["arthur-1", "offline"],
          ["other", "offline"],
        ]);
        // The token was not spent by the wrong participant.
        yield* openTunnel(options, tunnel.token);
        expect(yield* statuses).toEqual([
          ["arthur-1", "online"],
          ["other", "offline"],
        ]);
      }).pipe(Effect.provide(Platform))
  );
});

// The clock of these two is the test clock, and the hub is built inside each
// test so that it reads the same clock. No tunnel is open while the clock
// moves: a jump would also fire the tunnel's ping timeout.
it.effect(
  "a bootstrap token still opens a tunnel 59 s after it was issued",
  () =>
    Effect.gen(function* () {
      const { options, statuses } = yield* participantIn("Coco");
      const { tunnel } = yield* register(options);

      yield* TestClock.adjust("59 seconds");
      yield* openTunnel(options, tunnel.token);

      expect(yield* statuses).toEqual([["arthur-1", "online"]]);
    }).pipe(Effect.provide(Platform), Effect.provide(layerHub()))
);

it.effect("a bootstrap token expires 60 s after it was issued", () =>
  Effect.gen(function* () {
    const { options, statuses } = yield* participantIn("Baião");
    const { tunnel } = yield* register(options);
    const now = yield* Clock.currentTimeMillis;
    expect(tunnel.expiresAt - now).toBe(60_000);

    yield* TestClock.adjust("60 seconds");
    const expired = yield* openTunnel(options, tunnel.token).pipe(Effect.flip);
    const onTheWire = yield* refusal(
      tunnelUrl(
        options.hubUrl,
        options.roomCode,
        options.participantId,
        tunnel.token
      )
    );

    expect(expired).toBeInstanceOf(TunnelOpenFailed);
    expect(onTheWire.status).toBe(401);
    expect(yield* statuses).toEqual([["arthur-1", "offline"]]);
  }).pipe(Effect.provide(Platform), Effect.provide(layerHub()))
);
