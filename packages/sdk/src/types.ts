/**
 * The public types of the management plane: rooms, participants and room
 * events, as a hub answers them.
 *
 * They are written by hand, with no import, so the published declarations
 * never reach for a package the consumer does not have. `contract.ts` proves
 * at compile time that each one is the type of its schema in the management
 * contract, so a change there fails the type check here until this file
 * follows.
 */

/** Generation defaults, compatible with OpenAI-like providers. */
export interface GenerationConfig {
  readonly frequency_penalty?: number;
  readonly max_tokens?: number;
  readonly presence_penalty?: number;
  readonly seed?: number;
  readonly stop?: readonly string[];
  readonly temperature?: number;
  readonly top_p?: number;
}

/** The defaults a room or a participant applies to requests that leave a field out. */
export interface RuntimeConfig extends GenerationConfig {
  readonly instructions?: string;
}

/** `RuntimeConfig` as a hub shows it: the instructions text never leaves the hub. */
export interface RuntimeConfigPublic extends GenerationConfig {
  readonly hasInstructions: boolean;
}

export interface RoomSummary {
  /** The short code that identifies the room: six characters of `0-9A-Z`. */
  readonly code: string;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  readonly defaults?: RuntimeConfigPublic;
  readonly hostId: string;
  readonly id: string;
  readonly name: string;
  readonly participantCount: number;
  readonly passwordProtected: boolean;
}

/** What `rooms.create` takes. */
export interface CreateRoomInput {
  readonly defaults?: RuntimeConfig;
  readonly name: string;
  readonly password?: string;
}

export interface RoomCreated {
  readonly hostId: string;
  readonly room: RoomSummary;
}

/**
 * The one status of a participant, derived from its tunnel:
 *
 * - `offline`: registered, no open tunnel. Receives no routes.
 * - `online`: the tunnel is open and the participant is idle. Only this
 *   status receives routes.
 * - `busy`: the hub dispatched a request that has not ended yet.
 */
export type ParticipantStatus = "offline" | "online" | "busy";

/** What the participant's machine has. Informational. */
export interface MachineSpecs {
  readonly cpu?: string;
  readonly gpu?: string;
  readonly ram?: number;
  readonly vram?: number;
}

export type ProtocolSupport = "supported" | "unsupported" | "unknown";

/** Which inference APIs the participant's provider answers, as probed on its machine. */
export interface ParticipantCapabilities {
  readonly chatCompletions: ProtocolSupport;
  readonly openResponses: ProtocolSupport;
}

export interface ParticipantSummary {
  readonly capabilities: ParticipantCapabilities;
  readonly config: RuntimeConfigPublic;
  /** The provider endpoint on the participant's machine. The hub never calls it. */
  readonly endpoint?: string;
  /** The stable id the participant picked for itself. */
  readonly id: string;
  /** Milliseconds since the epoch. Kept across re-registrations. */
  readonly joinedAt: number;
  readonly model: string;
  readonly nickname: string;
  readonly specs: MachineSpecs;
  readonly status: ParticipantStatus;
  /** Milliseconds since the epoch: the last registration or status change. */
  readonly updatedAt: number;
}

/**
 * What `participants.register` takes. `ParticipantAuthHeaders` are not part
 * of it: they stay on the participant's machine and a hub refuses a
 * registration that carries them.
 */
export interface RegisterParticipantInput {
  readonly capabilities?: ParticipantCapabilities;
  readonly config?: RuntimeConfig;
  readonly endpoint?: string;
  readonly model: string;
  readonly nickname: string;
  /** The room password, when the room has one. */
  readonly password?: string;
  readonly specs?: MachineSpecs;
  /**
   * The Gambi version of the participant runtime. A hub refuses a minor
   * different from its own. Default: the version of this SDK.
   */
  readonly version?: string;
}

/**
 * The single-use token that authenticates the tunnel's WebSocket upgrade. It
 * is valid for 60 seconds and for one participant of one room.
 */
export interface BootstrapToken {
  /** Milliseconds since the epoch, on the hub's clock. */
  readonly expiresAt: number;
  readonly token: string;
}

export interface ParticipantRegistered {
  readonly participant: ParticipantSummary;
  readonly tunnel: BootstrapToken;
}

/** What leaving a room answers: who is no longer in it. */
export interface ParticipantLeft {
  readonly participantId: string;
}

export interface HubHealth {
  readonly status: "ok";
  /** Milliseconds since the epoch, on the hub's clock. */
  readonly timestamp: number;
}

/** What every room event carries. */
interface RoomEventBase {
  readonly roomCode: string;
  /** Milliseconds since the epoch, on the hub's clock. */
  readonly timestamp: number;
}

/**
 * The first event of every stream: the room and its participants when the
 * stream started. Every later event happened after it.
 */
export interface RoomSnapshot extends RoomEventBase {
  readonly participants: readonly ParticipantSummary[];
  readonly room: RoomSummary;
  readonly type: "room.snapshot";
}

/** A participant registered in the room. It starts `offline`. */
export interface ParticipantJoined extends RoomEventBase {
  readonly participant: ParticipantSummary;
  readonly type: "participant.joined";
}

/** A participant already in the room registered again. Its status did not change. */
export interface ParticipantUpdated extends RoomEventBase {
  readonly participant: ParticipantSummary;
  readonly type: "participant.updated";
}

/** What a change of status carries: the participant after it, and the status it had. */
interface StatusChange extends RoomEventBase {
  readonly participant: ParticipantSummary;
  readonly previousStatus: ParticipantStatus;
}

/** The participant can receive routes: its tunnel opened, or its request ended. */
export interface ParticipantOnline extends StatusChange {
  readonly type: "participant.online";
}

/** The hub dispatched a request into the participant's tunnel. */
export interface ParticipantBusy extends StatusChange {
  readonly type: "participant.busy";
}

/** The participant's tunnel dropped. It stays in the room until it reconnects or the deadline passes. */
export interface ParticipantOffline extends StatusChange {
  readonly type: "participant.offline";
}

/** Why a participant is no longer in the room. */
export type RemovalReason = "left" | "reconnectDeadlinePassed";

/** The participant is no longer in the room. */
export interface ParticipantRemoved extends RoomEventBase {
  readonly participantId: string;
  readonly reason: RemovalReason;
  readonly type: "participant.removed";
}

/** Every event a room's stream can carry, told apart by `type`. */
export type RoomEvent =
  | RoomSnapshot
  | ParticipantJoined
  | ParticipantUpdated
  | ParticipantOnline
  | ParticipantBusy
  | ParticipantOffline
  | ParticipantRemoved;
