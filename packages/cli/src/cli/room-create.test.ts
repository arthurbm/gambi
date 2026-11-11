import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

const CREATED_PERGUNTADA =
  /^Created room [0-9A-Z]{6} \(Perguntada\)\.\nhost_id: \S+\n$/;

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-cli-"))),
  (directory) =>
    Effect.promise(() => rm(directory, { force: true, recursive: true }))
);

const fileWith = (content: string) =>
  Effect.gen(function* () {
    const path = join(yield* temporaryDirectory, "room.json");
    yield* Effect.promise(() => Bun.write(path, content));
    return path;
  });

layer(layerHub(), { excludeTestServices: true })("room create", (it) => {
  it.effect("creates a room and prints it as JSON", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;

      const result = yield* runCommand([
        "room",
        "create",
        "--name",
        "Frevo de Bloco",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const created = JSON.parse(result.stdout).data;
      expect(created.room).toMatchObject({
        name: "Frevo de Bloco",
        passwordProtected: false,
      });
      expect(created.hostId).toBe(created.room.hostId);
      expect(
        yield* client.rooms.get({ params: { code: created.room.code } })
      ).toEqual(created.room);
    })
  );

  it.effect("--password protects the room", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand([
        "room",
        "create",
        "--name",
        "Fechada",
        "--password",
        "segredo",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data.room.passwordProtected).toBe(true);
      expect(result.stdout).not.toContain("segredo");
    })
  );

  it.effect("--config sends the runtime defaults of the room", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const config = yield* fileWith(
        JSON.stringify({ temperature: 0.2, instructions: "Seja breve." })
      );

      const result = yield* runCommand([
        "room",
        "create",
        "--name",
        "Com defaults",
        "--config",
        config,
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data.room.defaults).toEqual({
        temperature: 0.2,
        hasInstructions: true,
      });
    })
  );

  it.effect("a config file that is not a runtime config is invalid usage", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const config = yield* fileWith(JSON.stringify({ temperature: 9 }));

      const result = yield* runCommand([
        "room",
        "create",
        "--name",
        "Quebrada",
        "--config",
        config,
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "InvalidValue",
        details: { option: "config" },
      });
    })
  );

  it.effect(
    "on a terminal it asks for the name and prints readable lines",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand(["room", "create", "--hub", hub.url], {
          tty: true,
          answers: ["Perguntada"],
        });

        expect(result.exitCode).toBe(0);
        expect(result.terminal).toContain("Room name");
        expect(result.stdout).toMatch(CREATED_PERGUNTADA);
      })
  );

  it.effect("--dry-run prints the request and creates nothing", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;

      const result = yield* runCommand([
        "room",
        "create",
        "--name",
        "Ensaio",
        "--password",
        "segredo",
        "--dry-run",
        "--hub",
        hub.url,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data).toEqual({
        hubUrl: hub.url,
        payload: { name: "Ensaio", password: "[redacted]" },
      });
      const names = (yield* client.rooms.list()).map((room) => room.name);
      expect(names).not.toContain("Ensaio");
    })
  );
});
