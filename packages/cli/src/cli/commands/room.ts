import type { RoomSummary } from "@gambi/protocol";
import { DateTime, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { hubFlag, withHub } from "../hub-client.ts";
import { Output } from "../output.ts";

const describeRoom = (room: RoomSummary, indent = ""): string =>
  [
    `participants: ${room.participantCount}`,
    `protected: ${room.passwordProtected ? "yes" : "no"}`,
    `created_at: ${DateTime.formatIso(DateTime.makeUnsafe(room.createdAt))}`,
  ]
    .map((line) => `${indent}${line}`)
    .join("\n");

const get = Command.make(
  "get",
  {
    code: Flag.String("code").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Code of the room")
    ),
    hub: hubFlag,
  },
  Effect.fn("room.get")(function* ({ code, hub }) {
    const output = yield* Output;
    const room = yield* withHub(hub, (client) =>
      client.rooms.get({ params: { code } })
    );
    yield* output.result(
      room,
      () => `${room.code}  ${room.name}\n${describeRoom(room)}`
    );
  })
).pipe(Command.withDescription("Read one room by its code"));

const list = Command.make(
  "list",
  { hub: hubFlag },
  Effect.fn("room.list")(function* ({ hub }) {
    const output = yield* Output;
    const rooms = yield* withHub(hub, (client) => client.rooms.list());
    yield* output.result(rooms, () =>
      rooms.length === 0
        ? "No rooms found."
        : rooms
            .map(
              (room) =>
                `${room.code}  ${room.name}\n${describeRoom(room, "  ")}`
            )
            .join("\n\n")
    );
  })
).pipe(Command.withDescription("List the rooms of a hub"));

export const room = Command.make("room").pipe(
  Command.withDescription("Create, list and read the rooms of a hub"),
  Command.withSubcommands([get, list])
);
