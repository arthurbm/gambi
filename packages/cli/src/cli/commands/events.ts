import type { RoomEvent } from "@gambi/protocol";
import { DateTime, Effect, Stream } from "effect";
import { Command, Flag, Prompt } from "effect/cli";
import { hubFlag, NotAHub, withHub } from "../hub-client.ts";
import { Output } from "../output.ts";
import { Termination } from "../termination.ts";

/** What a person reads of an event, after its time and its type. */
const summaryOf = (event: RoomEvent): string => {
  switch (event.type) {
    case "room.snapshot":
      return `${event.room.name} (${event.participants.length} participants)`;
    case "participant.joined":
    case "participant.updated":
      return `${event.participant.id} (${event.participant.nickname})`;
    case "participant.online":
    case "participant.busy":
    case "participant.offline":
      return `${event.participant.id} (was ${event.previousStatus})`;
    case "participant.removed":
      return `${event.participantId} (${event.reason})`;
    case "llm.request":
      return `${event.participantId} ${event.requestId} ${event.model}`;
    case "llm.complete":
      return `${event.participantId} ${event.requestId} HTTP ${event.status} in ${event.metrics.durationMs} ms`;
    default:
      return `${event.participantId} ${event.requestId} ${event.code}: ${event.error}`;
  }
};

const describeEvent = (event: RoomEvent): string =>
  `${DateTime.formatIso(DateTime.makeUnsafe(event.timestamp))} ${event.type} ${summaryOf(event)}`;

const watch = Command.make(
  "watch",
  {
    room: Flag.String("room").pipe(
      Flag.withAlias("r"),
      Flag.withDescription("Code of the room"),
      Flag.withFallbackPrompt(Prompt.String({ message: "Room code" }))
    ),
    hub: hubFlag,
  },
  Effect.fn("events.watch")(function* ({ hub, room }) {
    const output = yield* Output;
    const termination = yield* Termination;
    // The stream starts with the snapshot of the room and ends, without an
    // error, when the hub closes.
    const watching = withHub(hub, (client) =>
      client.events.watch({ params: { code: room } }).pipe(
        Stream.unwrap,
        Stream.runForEach((event) => output.record(event, describeEvent)),
        // A hub never asks a watcher to retry (`Retry`) and never sends
        // what is not an event.
        Effect.catchTag(["SseError", "Retry"], (cause) =>
          Effect.fail(new NotAHub({ hubUrl: hub, cause }))
        )
      )
    );
    yield* Effect.raceFirst(termination.signal, watching);
  })
).pipe(
  Command.withDescription(
    "Write the events of a room as they happen, until Ctrl+C or until the hub closes"
  ),
  Command.withExamples([
    {
      command: "gambi events watch --room ABC123",
      description: "Follow a room of the local hub",
    },
    {
      command: "gambi events watch --room ABC123 --format ndjson | jq .type",
      description: "Read the events as JSON lines",
    },
  ])
);

export const events = Command.make("events").pipe(
  Command.withDescription("Follow what happens in a room"),
  Command.withSubcommands([watch])
);
