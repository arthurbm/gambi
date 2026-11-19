/**
 * Registering a participant and taking one out of a room: the operations that
 * touch the room, the participants and the tunnels. Registering answers with
 * the bootstrap token the participant runtime dials its tunnel with.
 */
import {
  InvalidPassword,
  type ParticipantLeft,
  ParticipantNotFound,
  ParticipantOfAnotherRuntime,
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
    const { password, version, authHeaders, runtimeId, ...profile } =
      registration;
    const participant = yield* participants.register(
      room.code,
      participantId,
      profile,
      runtimeId
    );
    const tunnel = yield* tunnels.issueToken(
      room.code,
      participantId,
      runtimeId
    );
    return { participant, tunnel } satisfies ParticipantRegistered;
  }
);

/**
 * Takes a participant out of a room at once, whatever its status, and closes
 * its tunnel. The room hears one event, `participant.removed`.
 *
 * Only for the participant runtime the participant belongs to (`runtimeId`):
 * a removal that names another one arrived late, after another runtime
 * joined with the same id, and is refused. The runtime is told that it left
 * for good (`Tunnels.close`).
 */
export const leaveRoom = Effect.fn("Hub.leaveRoom")(function* (
  roomCode: string,
  participantId: string,
  runtimeId: string
) {
  const rooms = yield* Rooms;
  const participants = yield* Participants;
  const tunnels = yield* Tunnels;

  const room = yield* rooms.get(roomCode);
  // Out of the room first: the tunnel then drops for a participant that is
  // no longer there, which is no change of status and no event.
  const left = yield* participants.transition(
    room.code,
    participantId,
    "left",
    runtimeId
  );
  if (left === undefined) {
    const identity = { roomCode: room.code, participantId };
    // Nothing changed: it is not in the room, or it is another runtime's.
    return (yield* participants.get(room.code, participantId)) === undefined
      ? yield* new ParticipantNotFound(identity)
      : yield* new ParticipantOfAnotherRuntime(identity);
  }
  yield* tunnels.close(
    room.code,
    participantId,
    "the participant left the room",
    runtimeId
  );
  return { participantId } satisfies ParticipantLeft;
});
