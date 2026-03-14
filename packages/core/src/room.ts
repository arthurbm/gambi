import { nanoid } from "nanoid";
import { Participant } from "./participant.ts";
import {
  PARTICIPANT_TIMEOUT,
  type ParticipantAuthHeaders,
  type ParticipantInfo,
  type ParticipantInfoInternal,
  type RoomInfo,
  type RoomInfoPublic,
  type RuntimeConfig,
} from "./types.ts";

// Password hashing utilities using Bun's native password API
// Uses argon2id with automatic salting for secure password storage
async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password);
}

async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

// Converts internal RoomInfo to public RoomInfo (strips sensitive fields)
function toPublic(room: RoomInfo): RoomInfoPublic {
  const { passwordHash, defaults, ...publicRoom } = room;
  return {
    ...publicRoom,
    defaults: defaults ? Participant.toPublicConfig(defaults) : undefined,
  };
}

const rooms = new Map<string, RoomState>();
const codeToRoomId = new Map<string, string>();

interface RoomState {
  info: RoomInfo;
  participants: Map<string, StoredParticipant>;
}

export interface StoredParticipant {
  authHeaders: ParticipantAuthHeaders;
  info: ParticipantInfoInternal;
}

async function create(
  name: string,
  hostId: string,
  password?: string,
  defaults?: RuntimeConfig
): Promise<RoomInfo> {
  const id = nanoid();
  const code = nanoid(6).toUpperCase();

  const info: RoomInfo = {
    id,
    code,
    name,
    hostId,
    createdAt: Date.now(),
    defaults,
    passwordHash: password ? await hashPassword(password) : undefined,
  };

  rooms.set(id, {
    info,
    participants: new Map(),
  });
  codeToRoomId.set(code, id);

  return info;
}

function get(id: string): RoomInfo | undefined {
  return rooms.get(id)?.info;
}

function getByCode(code: string): RoomInfo | undefined {
  const id = codeToRoomId.get(code.toUpperCase());
  return id ? rooms.get(id)?.info : undefined;
}

function list(): RoomInfoPublic[] {
  return Array.from(rooms.values()).map((r) => toPublic(r.info));
}

function listWithParticipantCount(): (RoomInfoPublic & {
  participantCount: number;
})[] {
  return Array.from(rooms.values()).map((r) => ({
    ...toPublic(r.info),
    participantCount: r.participants.size,
  }));
}

function remove(id: string): boolean {
  const room = rooms.get(id);
  if (!room) {
    return false;
  }

  codeToRoomId.delete(room.info.code);
  rooms.delete(id);
  return true;
}

function addParticipant(
  roomId: string,
  participant: ParticipantInfoInternal,
  authHeaders: ParticipantAuthHeaders = {}
): boolean {
  const room = rooms.get(roomId);
  if (!room) {
    return false;
  }

  room.participants.set(participant.id, {
    info: participant,
    authHeaders,
  });
  return true;
}

function removeParticipant(roomId: string, participantId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) {
    return false;
  }

  return room.participants.delete(participantId);
}

function getParticipants(roomId: string): ParticipantInfo[] {
  const room = rooms.get(roomId);
  return room
    ? Array.from(room.participants.values(), (entry) =>
        Participant.toPublicInfo(entry.info)
      )
    : [];
}

function getParticipant(
  roomId: string,
  participantId: string
): ParticipantInfo | undefined {
  const participant = rooms.get(roomId)?.participants.get(participantId)?.info;
  return participant ? Participant.toPublicInfo(participant) : undefined;
}

function getParticipantRecord(
  roomId: string,
  participantId: string
): StoredParticipant | undefined {
  return rooms.get(roomId)?.participants.get(participantId);
}

function updateParticipantStatus(
  roomId: string,
  participantId: string,
  status: ParticipantInfoInternal["status"]
): boolean {
  const participant = rooms.get(roomId)?.participants.get(participantId)?.info;
  if (!participant) {
    return false;
  }

  participant.status = status;
  return true;
}

function updateLastSeen(roomId: string, participantId: string): boolean {
  const participant = rooms.get(roomId)?.participants.get(participantId)?.info;
  if (!participant) {
    return false;
  }

  participant.lastSeen = Date.now();
  participant.status = "online";
  return true;
}

function findParticipantByModel(
  roomId: string,
  model: string
): ParticipantInfoInternal | undefined {
  const room = rooms.get(roomId);
  if (!room) {
    return undefined;
  }

  for (const entry of room.participants.values()) {
    if (entry.info.model === model && entry.info.status === "online") {
      return entry.info;
    }
  }
  return undefined;
}

function getRandomOnlineParticipant(
  roomId: string
): ParticipantInfoInternal | undefined {
  const room = rooms.get(roomId);
  if (!room) {
    return undefined;
  }

  const online = Array.from(
    room.participants.values(),
    (entry) => entry.info
  ).filter((participant) => participant.status === "online");

  if (online.length === 0) {
    return undefined;
  }
  return online[Math.floor(Math.random() * online.length)];
}

function checkStaleParticipants(): { roomId: string; participantId: string }[] {
  const stale: { roomId: string; participantId: string }[] = [];
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    for (const entry of room.participants.values()) {
      const participant = entry.info;
      if (now - participant.lastSeen > PARTICIPANT_TIMEOUT) {
        participant.status = "offline";
        stale.push({ roomId, participantId: participant.id });
      }
    }
  }

  return stale;
}

function clear(): void {
  rooms.clear();
  codeToRoomId.clear();
}

async function validatePassword(
  roomId: string,
  password: string
): Promise<boolean> {
  const room = rooms.get(roomId);
  if (!room) {
    return false;
  }

  // If room has no password, allow access
  if (!room.info.passwordHash) {
    return true;
  }

  // If room has password but none provided, deny access
  if (!password) {
    return false;
  }

  // Verify password
  return await verifyPassword(password, room.info.passwordHash);
}

export const Room = {
  create,
  get,
  getByCode,
  list,
  listWithParticipantCount,
  remove,
  addParticipant,
  removeParticipant,
  getParticipants,
  getParticipant,
  getParticipantRecord,
  updateParticipantStatus,
  updateLastSeen,
  findParticipantByModel,
  getRandomOnlineParticipant,
  checkStaleParticipants,
  validatePassword,
  toPublic,
  clear,
} as const;
