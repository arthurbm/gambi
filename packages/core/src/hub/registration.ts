/**
 * Registering a participant: the one operation that touches the room, the
 * participants and the tunnels. It answers with the bootstrap token the
 * participant runtime dials its tunnel with.
 */
import {
  InvalidPassword,
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
