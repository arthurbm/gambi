/**
 * Registering a participant and taking one out of a room: the operations that
 * touch the room, the participants and the tunnels. Registering answers with
 * the bootstrap token the participant runtime dials its tunnel with.
 */
import {
  InvalidPassword,
  type ParticipantLeft,
  ParticipantNotFound,
  type ParticipantRegistered,
  type RegisterParticipant,
  sameMinor,
  VersionMismatch,
} from "@gambi/protocol";
import { Effect } from "effect";
import { Participants } from "./participants.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
import { Tunnels } from "./tunnels.ts";

export const registerParticipant = Effect.fn("Hub.registerParticipant")(
  function* (
    roomCode: string,
    participantId: string,
    registration: RegisterParticipant
  ) {
    const settings = yield* HubSettings;
    const rooms = yield* Rooms;
    const participants = yield* Participants;
    const tunnels = yield* Tunnels;

    // The version comes first: a participant on another minor must hear that
    // it has to update, whatever else is wrong with the request.
    if (!sameMinor(settings.version, registration.version)) {
      return yield* new VersionMismatch({
        hubVersion: settings.version,
        participantVersion: registration.version,
      });
    }
    const room = yield* rooms.get(roomCode);
    if (!(yield* rooms.checkPassword(room.code, registration.password))) {
      return yield* new InvalidPassword({ roomCode: room.code });
    }
    const { password, version, authHeaders, ...profile } = registration;
    const participant = yield* participants.register(
      room.code,
      participantId,
      profile
    );
    const tunnel = yield* tunnels.issueToken(room.code, participantId);
    return { participant, tunnel } satisfies ParticipantRegistered;
  }
);

/**
 * Takes a participant out of a room at once, whatever its status, and closes
 * its tunnel. The room hears one event, `participant.removed`.
 */
export const leaveRoom = Effect.fn("Hub.leaveRoom")(function* (
  roomCode: string,
  participantId: string
) {
  const rooms = yield* Rooms;
  const participants = yield* Participants;
  const tunnels = yield* Tunnels;

  const room = yield* rooms.get(roomCode);
  // Out of the room first: the tunnel then drops for a participant that is
  // no longer there, which is no change of status and no event.
  const left = yield* participants.transition(room.code, participantId, "left");
  if (left === undefined) {
    return yield* new ParticipantNotFound({
      roomCode: room.code,
      participantId,
    });
  }
  yield* tunnels.close(
    room.code,
    participantId,
    "the participant left the room"
  );
  return { participantId } satisfies ParticipantLeft;
});
