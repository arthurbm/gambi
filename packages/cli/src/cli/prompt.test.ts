import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

layer(layerHub(), { excludeTestServices: true })("prompts", (it) => {
  it.effect("on a terminal a missing flag becomes a question", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Caboclinho" },
      });

      const result = yield* runCommand(["room", "get", "--hub", hub.url], {
        tty: true,
        answers: [room.code],
      });

      expect(result.exitCode).toBe(0);
      expect(result.terminal).toContain("Room code");
      expect(result.stdout).toContain(`${room.code}  Caboclinho`);
    })
  );

  it.effect(
    "--no-interactive fails instead of asking, even on a terminal",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand(
          ["room", "get", "--hub", hub.url, "--no-interactive"],
          { tty: true, answers: ["ABC123"] }
        );

        expect(result.exitCode).toBe(2);
        expect(result.terminal).toBe("");
        expect(result.stderr).toContain("Missing required flag: --code");
      })
  );

  it.effect("a question left unanswered is the missing flag again", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand(["room", "get", "--hub", hub.url], {
        tty: true,
        answers: [],
      });

      expect(result.exitCode).toBe(2);
      expect(result.terminal).toContain("Room code");
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Missing required flag: --code");
    })
  );

  it.effect("an answer is validated like the flag it stands for", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const result = yield* runCommand(["room", "create", "--hub", hub.url], {
        tty: true,
        answers: [""],
      });

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Error (InvalidValue)");
    })
  );
});
