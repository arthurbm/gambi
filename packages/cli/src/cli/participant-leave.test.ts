import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

layer(layerHub(), { excludeTestServices: true })("participant leave", (it) => {
  it.effect("takes a participant out of its room", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });
      yield* joinParticipant({ roomCode: room.code, participantId: "arthur" });
      const watch = yield* watchRoom(room.code);

      const result = yield* runCommand([
        "participant",
        "leave",
        "--room",
        room.code,
        "--participant-id",
        "arthur",
        "--hub",
        hub.url,
      ]);

      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual({
        data: { participantId: "arthur" },
      });
      expect(yield* watch.next).toMatchObject({
        type: "participant.removed",
        participantId: "arthur",
        reason: "left",
      });
      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toEqual([]);
    })
  );

  it.effect("on a terminal it says who left which room", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });
      yield* joinParticipant({ roomCode: room.code, participantId: "arthur" });

      const result = yield* runCommand(
        ["participant", "leave", "-r", room.code, "--hub", hub.url],
        { tty: true, answers: ["arthur"] }
      );

      expect(result.exitCode).toBe(0);
      expect(result.terminal).toContain("Participant id");
      expect(result.stdout).toBe(
        `Participant arthur left room ${room.code}.\n`
      );
    })
  );

  it.effect("a participant that is not in the room is a remote rejection", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });

      const result = yield* runCommand([
        "participant",
        "leave",
        "--room",
        room.code,
        "--participant-id",
        "ninguem",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "ParticipantNotFound",
        details: { roomCode: room.code, participantId: "ninguem" },
        exitCode: 4,
      });
    })
  );

  it.effect("a room that does not exist is a remote rejection", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand([
        "participant",
        "leave",
        "--room",
        "NOPE00",
        "--participant-id",
        "arthur",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(4);
      expect(JSON.parse(result.stderr).error.name).toBe("RoomNotFound");
    })
  );
});
