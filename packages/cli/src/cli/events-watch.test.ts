import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import { makeManagementClient } from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { runCommand, startCommand } from "./testing.ts";

const SNAPSHOT_LINE = /^\S+ room\.snapshot Frevo \(0 participants\)$/;

layer(layerHub(), { excludeTestServices: true })("events watch", (it) => {
  it.effect("writes each event of the room as one JSON line, as it is", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });

      const watching = yield* startCommand([
        "events",
        "watch",
        "--room",
        room.code,
        "--hub",
        hub.url,
      ]);

      expect(JSON.parse(yield* watching.nextLine)).toMatchObject({
        type: "room.snapshot",
        roomCode: room.code,
        room: { code: room.code, name: "Frevo" },
        participants: [],
      });

      yield* joinParticipant({ roomCode: room.code, participantId: "arthur" });
      expect(JSON.parse(yield* watching.nextLine)).toMatchObject({
        type: "participant.joined",
        roomCode: room.code,
        participant: { id: "arthur", status: "offline" },
      });
      expect(JSON.parse(yield* watching.nextLine)).toMatchObject({
        type: "participant.online",
        previousStatus: "offline",
        participant: { id: "arthur", status: "online" },
      });

      yield* watching.signal("SIGINT");
      expect(yield* watching.result).toMatchObject({ exitCode: 0, stderr: "" });
    })
  );

  it.effect("on a terminal it writes one readable line per event", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });

      const watching = yield* startCommand(
        ["events", "watch", "--room", room.code, "--hub", hub.url],
        { tty: true }
      );

      expect(yield* watching.nextLine).toMatch(SNAPSHOT_LINE);
      yield* watching.signal("SIGTERM");
      expect((yield* watching.result).exitCode).toBe(0);
    })
  );

  it.effect("a room that does not exist is a remote rejection", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand([
        "events",
        "watch",
        "--room",
        "NOPE00",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "RoomNotFound",
        details: { roomCode: "NOPE00" },
      });
    })
  );
});

it.live("events watch ends by itself, with 0, when the hub closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const hub = Context.get(
      yield* Layer.buildWithScope(layerHub(), scope),
      Hub
    );
    const { room } = yield* (yield* makeManagementClient(hub.url)).rooms.create(
      { payload: { name: "Frevo" } }
    );
    const watching = yield* startCommand([
      "events",
      "watch",
      "--room",
      room.code,
      "--hub",
      hub.url,
    ]);
    yield* watching.nextLine;

    yield* Scope.close(scope, Exit.void);

    expect(yield* watching.result).toMatchObject({ exitCode: 0, stderr: "" });
  }).pipe(Effect.provide(FetchHttpClient.layer))
);
