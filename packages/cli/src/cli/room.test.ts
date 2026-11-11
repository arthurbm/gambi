import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

const SORTED_ROOM_NAME = /^(zz|aa|mm) /;

layer(layerHub(), { excludeTestServices: true })("room commands", (it) => {
  it.effect(
    "room list prints the rooms as JSON when stdout is not a terminal",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = yield* managementClient;
        const created = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });

        const result = yield* runCommand(["room", "list", "--hub", hub.url]);

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).data).toContainEqual(created.room);
      })
  );

  it.effect("a room that does not exist is a remote rejection", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand([
        "room",
        "get",
        "--code",
        "NOPE00",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "RoomNotFound",
        message: "Room 'NOPE00' was not found.",
        exitCode: 4,
      });
    })
  );

  it.effect("room get prints readable lines on a terminal", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Maracatu", password: "segredo" },
      });

      const result = yield* runCommand(
        ["room", "get", "--code", room.code, "--hub", hub.url],
        { tty: true }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toEqual([
        `${room.code}  Maracatu`,
        "participants: 0",
        "protected: yes",
        `created_at: ${new Date(room.createdAt).toISOString()}`,
        "",
      ]);
    })
  );

  it.effect("room list prints one block per room on a terminal", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Ciranda" },
      });

      const result = yield* runCommand(["room", "list", "--hub", hub.url], {
        tty: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        [
          `${room.code}  Ciranda`,
          "  participants: 0",
          "  protected: no",
          `  created_at: ${new Date(room.createdAt).toISOString()}`,
        ].join("\n")
      );
    })
  );

  it.effect("--format json keeps the output structured on a terminal", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Coco" },
      });

      const result = yield* runCommand(
        [
          "room",
          "get",
          "--code",
          room.code,
          "--hub",
          hub.url,
          "--format",
          "json",
        ],
        { tty: true }
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ data: room });
    })
  );

  it.effect("an error on a terminal is a readable line on stderr", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand(
        ["room", "get", "--code", "NOPE00", "--hub", hub.url],
        { tty: true }
      );

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        [
          "Error (RoomNotFound): Room 'NOPE00' was not found.",
          "Hint: List the rooms of this hub to see the codes that exist.",
          "",
        ].join("\n")
      );
    })
  );

  it.effect("room list --sort name orders by name, --reverse inverts it", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      for (const name of ["zz Xote", "aa Baião", "mm Forró"]) {
        yield* client.rooms.create({ payload: { name } });
      }
      const sortedNames = (args: readonly string[]) =>
        runCommand(["room", "list", "--hub", hub.url, ...args]).pipe(
          Effect.map((result) =>
            (JSON.parse(result.stdout).data as { name: string }[])
              .map((room) => room.name)
              .filter((name) => SORTED_ROOM_NAME.test(name))
          )
        );

      expect(yield* sortedNames(["--sort", "name"])).toEqual([
        "aa Baião",
        "mm Forró",
        "zz Xote",
      ]);
      expect(yield* sortedNames(["--sort", "name", "--reverse"])).toEqual([
        "zz Xote",
        "mm Forró",
        "aa Baião",
      ]);
    })
  );

  it.effect("room list rejects a sort it does not know as invalid usage", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand([
        "room",
        "list",
        "--hub",
        hub.url,
        "--sort",
        "color",
      ]);

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "InvalidValue",
        details: { option: "sort", value: "color" },
      });
    })
  );
});
