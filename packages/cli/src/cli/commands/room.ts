import { type RoomSummary, RuntimeConfig } from "@gambi/protocol";
import { DateTime, Effect, Option, Redacted, Schema } from "effect";
import { Command, Flag, Prompt } from "effect/cli";
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

const create = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("Name of the room"),
      Flag.withFallbackPrompt(Prompt.String({ message: "Room name" })),
      Flag.withSchema(Schema.NonEmptyString)
    ),
    password: Flag.Redacted("password").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("Password participants must give to join"),
      Flag.optional
    ),
    defaults: Flag.FileSchema("config", RuntimeConfig, { format: "json" }).pipe(
      Flag.withMetavar("file"),
      Flag.withDescription(
        "JSON file with the runtime defaults of the room (temperature, instructions, ...)"
      ),
      Flag.optional
    ),
    hub: hubFlag,
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print the request without creating the room"),
      Flag.withDefault(false)
    ),
  },
  Effect.fn("room.create")(function* ({
    defaults,
    dryRun,
    hub,
    name,
    password,
  }) {
    const output = yield* Output;
    const payload = {
      name,
      ...Option.match(defaults, {
        onNone: () => ({}),
        onSome: (value) => ({ defaults: value }),
      }),
    };

    if (dryRun) {
      const preview = {
        hubUrl: hub,
        payload: {
          ...payload,
          ...(Option.isSome(password) ? { password: "[redacted]" } : {}),
        },
      };
      return yield* output.result(
        preview,
        () =>
          `Would create room '${name}' on ${hub}.\n${JSON.stringify(preview.payload, null, 2)}`
      );
    }

    const created = yield* withHub(hub, (client) =>
      client.rooms.create({
        payload: {
          ...payload,
          ...Option.match(password, {
            onNone: () => ({}),
            onSome: (value) => ({ password: Redacted.value(value) }),
          }),
        },
      })
    );
    yield* output.result(
      created,
      () =>
        `Created room ${created.room.code} (${created.room.name}).\nhost_id: ${created.hostId}`
    );
  })
).pipe(
  Command.withDescription("Create a room on a hub"),
  Command.withExamples([
    {
      command: "gambi room create --name Demo",
      description: "Create a room on the local hub",
    },
    {
      command:
        "gambi room create --name Demo --config ./room.json --hub http://192.168.1.10:3000",
      description: "Create a room with runtime defaults on another hub",
    },
  ])
);

const get = Command.make(
  "get",
  {
    code: Flag.String("code").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Code of the room"),
      Flag.withFallbackPrompt(Prompt.String({ message: "Room code" }))
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

const ROOM_SORTS = ["participant-count", "created-at", "name"] as const;

const newestFirst = (left: RoomSummary, right: RoomSummary) =>
  right.createdAt - left.createdAt;

const roomOrders: Record<
  (typeof ROOM_SORTS)[number],
  (left: RoomSummary, right: RoomSummary) => number
> = {
  "created-at": newestFirst,
  name: (left, right) => left.name.localeCompare(right.name),
  "participant-count": (left, right) =>
    right.participantCount - left.participantCount || newestFirst(left, right),
};

const list = Command.make(
  "list",
  {
    hub: hubFlag,
    sort: Flag.Literals("sort", ROOM_SORTS).pipe(
      Flag.withDescription("Order of the rooms"),
      Flag.withDefault("participant-count")
    ),
    reverse: Flag.Boolean("reverse").pipe(
      Flag.withDescription("Reverse the order"),
      Flag.withDefault(false)
    ),
  },
  Effect.fn("room.list")(function* ({ hub, reverse, sort }) {
    const output = yield* Output;
    const listed = yield* withHub(hub, (client) => client.rooms.list());
    const sorted = listed.toSorted(roomOrders[sort]);
    const rooms = reverse ? sorted.toReversed() : sorted;
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
  Command.withSubcommands([create, get, list])
);
