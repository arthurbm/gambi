// Re-export Room namespace from core (DRY - zero duplication)
import { Room } from "@gambi/core/room";

/**
 * Room management namespace
 *
 * Provides functions for creating, managing, and querying rooms.
 * Rooms are the core organizational unit in Gambi, containing participants
 * and managing their lifecycle.
 */
export const rooms = {
  /**
   * Create a new room
   * @param name - Room name
   * @param hostId - Host identifier
   * @param password - Optional password to protect the room
   */
  create: Room.create,

  /** Get room by ID */
  get: Room.get,

  /** Get room by code (case-insensitive) */
  getByCode: Room.getByCode,

  /** List all rooms */
  list: Room.list,

  /** List all rooms with participant count */
  listWithParticipantCount: Room.listWithParticipantCount,

  /** Remove a room */
  remove: Room.remove,

  /** Add a participant to a room */
  addParticipant: Room.addParticipant,

  /** Remove a participant from a room */
  removeParticipant: Room.removeParticipant,

  /** Get all participants in a room */
  getParticipants: Room.getParticipants,

  /** Get a specific participant in a room */
  getParticipant: Room.getParticipant,

  /** Update participant status */
  updateParticipantStatus: Room.updateParticipantStatus,

  /** Update participant's last seen timestamp */
  updateLastSeen: Room.updateLastSeen,

  /** Find online participant by model name */
  findParticipantByModel: Room.findParticipantByModel,

  /** Get random online participant from room */
  getRandomOnlineParticipant: Room.getRandomOnlineParticipant,

  /** Check for stale participants and mark them offline */
  checkStaleParticipants: Room.checkStaleParticipants,

  /** Validate password for a room */
  validatePassword: Room.validatePassword,

  /** Convert internal RoomInfo to public (strips sensitive fields) */
  toPublic: Room.toPublic,

  /** Clear all rooms (useful for testing) */
  clear: Room.clear,
} as const;
