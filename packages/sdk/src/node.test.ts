import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { buildEntry, entries } from "../entries.ts";

const sdkDir = resolve(import.meta.dir, "..");

/**
 * What a Node program does with the default entry: every kind of call of the
 * management client and the provider, against the hub at `argv[2]`. It never
 * closes the client and never calls `process.exit`: Node must end by itself.
 */
const NODE_PROGRAM = `
import { ClientError, createClient, createGambi } from "./index.js";

const hubUrl = process.argv[2];
const client = createClient({ hubUrl });
const { room } = await client.rooms.create({ name: "Frevo" });
const rooms = await client.rooms.list();
let firstEvent;
for await (const event of client.events.watch(room.code)) {
  firstEvent = event.type;
  break;
}
const missing = await client.rooms.get("NOPE00").catch((error) => error);
const participants = await createGambi({ hubUrl, roomCode: room.code }).listParticipants();

console.log(JSON.stringify({
  runtime: typeof Bun === "undefined" ? "node" : "bun",
  roomName: room.name,
  listed: rooms.some((listed) => listed.code === room.code),
  firstEvent,
  missing: missing instanceof ClientError ? missing.code : String(missing),
  participants,
}));
`;

layer(layerHub(), { excludeTestServices: true })(
  "the default entry in Node",
  (it) => {
    it.effect(
      "loads and talks to a hub from a Node process",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          // Inside the package, so Node resolves the entry's external
          // imports the way it would from a consumer's node_modules.
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() =>
              mkdtemp(join(sdkDir, "node_modules", ".node-entry-"))
            ),
            (created) =>
              Effect.promise(() =>
                rm(created, { force: true, recursive: true })
              )
          );
          const defaultEntry = entries.find(
            (entry) => entry.exportPath === "."
          );
          if (defaultEntry === undefined) {
            return yield* Effect.die(new Error("No default entry."));
          }
          yield* Effect.promise(() => buildEntry(defaultEntry, directory));
          yield* Effect.promise(() =>
            Bun.write(join(directory, "program.mjs"), NODE_PROGRAM)
          );

          const node = Bun.spawn(["node", "program.mjs", hub.url], {
            cwd: directory,
            stderr: "pipe",
            stdout: "pipe",
          });
          const [exitCode, stdout, stderr] = yield* Effect.promise(() =>
            Promise.all([
              node.exited,
              new Response(node.stdout).text(),
              new Response(node.stderr).text(),
            ])
          );

          expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
          expect(JSON.parse(stdout)).toEqual({
            runtime: "node",
            roomName: "Frevo",
            listed: true,
            firstEvent: "room.snapshot",
            missing: "ROOM_NOT_FOUND",
            participants: [],
          });
        }),
      30_000
    );
  }
);
