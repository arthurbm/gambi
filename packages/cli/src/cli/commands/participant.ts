import { ParticipantNotFound } from "@gambi/protocol";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { participantIdFlag, roomFlag } from "../flags.ts";
import { hubFlag, withHub } from "../hub-client.ts";
import { Output } from "../output.ts";
import { join } from "./participant-join.ts";

const leave = Command.make(
  "leave",
  { room: roomFlag, participantId: participantIdFlag, hub: hubFlag },
  Effect.fn("participant.leave")(function* ({ hub, participantId, room }) {
    const output = yield* Output;
    // A removal names the runtime it takes out. This command takes out
    // whoever holds the participant now, so it asks the hub who that is.
    const left = yield* withHub(hub, (client) =>
      Effect.gen(function* () {
        const inTheRoom = (yield* client.participants.list({
          params: { code: room },
        })).find((participant) => participant.id === participantId);
        if (inTheRoom === undefined) {
          return yield* new ParticipantNotFound({
            roomCode: room,
            participantId,
          });
        }
        return yield* client.participants.remove({
          params: { code: room, id: participantId },
          query: { runtimeId: inTheRoom.runtimeId },
        });
      })
    );
    yield* output.result(
      left,
      () => `Participant ${left.participantId} left room ${room}.`
    );
  })
).pipe(
  Command.withDescription(
    "Take a participant out of a room, whoever is hosting it"
  ),
  Command.withExamples([
    {
      command:
        "gambi participant leave --room ABC123 --participant-id worker-1",
      description: "Remove a participant from a room of the local hub",
    },
  ])
);

export const participant = Command.make("participant").pipe(
  Command.withDescription("Join a room as a participant, or leave it"),
  Command.withSubcommands([join, leave])
);
