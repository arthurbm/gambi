import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import { it, layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand, startCommand } from "./testing.ts";

const hubUrlOf = (stdout: string): unknown => JSON.parse(stdout).data.hubUrl;

it.effect("without --hub and GAMBI_HUB a command talks to the local hub", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([
      "room",
      "create",
      "--name",
      "Ensaio",
      "--dry-run",
    ]);

    expect(hubUrlOf(result.stdout)).toBe("http://localhost:3000");
  })
);

it.effect("GAMBI_HUB that is not a URL is invalid usage", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["room", "list"], {
      env: { GAMBI_HUB: "hub-da-sala" },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.name).toBe("InvalidValue");
  })
);

layer(layerHub(), { excludeTestServices: true })(
  "the hub of a command",
  (it) => {
    it.effect("GAMBI_HUB says where the hub is when --hub is absent", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = yield* managementClient;
        const env = { GAMBI_HUB: hub.url };
        const { room } = yield* client.rooms.create({
          payload: { name: "Pela variável" },
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur",
        });

        const created = yield* runCommand(
          ["room", "create", "--name", "Maracatu"],
          {
            env,
          }
        );
        expect(created.exitCode).toBe(0);

        const listed = yield* runCommand(["room", "list"], { env });
        expect(listed.exitCode).toBe(0);
        expect(listed.stdout).toContain("Pela variável");

        const read = yield* runCommand(["room", "get", "--code", room.code], {
          env,
        });
        expect(JSON.parse(read.stdout).data.code).toBe(room.code);

        const watching = yield* startCommand(
          ["events", "watch", "--room", room.code],
          { env }
        );
        expect(JSON.parse(yield* watching.nextLine).type).toBe("room.snapshot");
        yield* watching.signal("SIGINT");

        const left = yield* runCommand(
          [
            "participant",
            "leave",
            "--room",
            room.code,
            "--participant-id",
            "arthur",
          ],
          { env }
        );
        expect(left.exitCode).toBe(0);
      })
    );

    it.effect("--hub wins over GAMBI_HUB", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand(
          ["room", "create", "--name", "Ensaio", "--dry-run", "--hub", hub.url],
          { env: { GAMBI_HUB: "http://127.0.0.1:9" } }
        );

        expect(hubUrlOf(result.stdout)).toBe(hub.url);
      })
    );
  }
);
