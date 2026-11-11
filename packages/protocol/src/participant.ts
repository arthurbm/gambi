/** The schemas of a participant, as the management plane shows it. */
import { Schema } from "effect";
import { ParticipantStatus } from "./participant-status.ts";
import { RuntimeConfig, RuntimeConfigPublic } from "./room.ts";

/** The stable id a participant picks for itself and keeps across reconnections. */
export const ParticipantId = Schema.NonEmptyString;
export type ParticipantId = typeof ParticipantId.Type;

/** What the participant's machine has. Informational. */
export const MachineSpecs = Schema.Struct({
  gpu: Schema.optionalKey(Schema.String),
  vram: Schema.optionalKey(Schema.Finite),
  ram: Schema.optionalKey(Schema.Finite),
  cpu: Schema.optionalKey(Schema.String),
});
export type MachineSpecs = typeof MachineSpecs.Type;

export const ProtocolSupport = Schema.Literals([
  "supported",
  "unsupported",
  "unknown",
]);
export type ProtocolSupport = typeof ProtocolSupport.Type;

/** Which inference APIs the participant's provider answers, as probed on its machine. */
export const ParticipantCapabilities = Schema.Struct({
  openResponses: ProtocolSupport,
  chatCompletions: ProtocolSupport,
});
export type ParticipantCapabilities = typeof ParticipantCapabilities.Type;

/**
 * A participant as the hub shows it. It has one `status`, derived from its
 * tunnel; there is no separate connection state.
 */
export const ParticipantSummary = Schema.Struct({
  id: ParticipantId,
  nickname: Schema.String,
  model: Schema.String,
  /** The provider endpoint on the participant's machine. The hub never calls it. */
  endpoint: Schema.optionalKey(Schema.String),
  config: RuntimeConfigPublic,
  specs: MachineSpecs,
  capabilities: ParticipantCapabilities,
  status: ParticipantStatus,
  /** Milliseconds since the epoch. Kept across re-registrations. */
  joinedAt: Schema.Finite,
  /** Milliseconds since the epoch: the last registration or status change. */
  updatedAt: Schema.Finite,
});
export type ParticipantSummary = typeof ParticipantSummary.Type;

/**
 * What a participant runtime sends to register. Registering an id that is
 * already in the room updates it and keeps its `joinedAt` and its status.
 */
export const RegisterParticipant = Schema.Struct({
  nickname: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  endpoint: Schema.optionalKey(Schema.NonEmptyString),
  /** The room password, when the room has one. */
  password: Schema.optionalKey(Schema.String),
  specs: Schema.optionalKey(MachineSpecs),
  config: Schema.optionalKey(RuntimeConfig),
  capabilities: Schema.optionalKey(ParticipantCapabilities),
  /**
   * The Gambi version of the participant runtime (`GAMBI_VERSION`). The hub
   * refuses a minor different from its own.
   */
  version: Schema.NonEmptyString,
  /**
   * Never accepted. `ParticipantAuthHeaders` stay in the participant runtime
   * and are applied only when it calls its local provider; a registration
   * that carries them is refused instead of silently dropping them.
   */
  authHeaders: Schema.optionalKey(Schema.Never),
});
export type RegisterParticipant = typeof RegisterParticipant.Type;

/**
 * The single-use token that authenticates the tunnel's WebSocket upgrade.
 * It is valid for 60 seconds and for one participant of one room.
 */
export const BootstrapToken = Schema.Struct({
  token: Schema.String,
  /** Milliseconds since the epoch, on the hub's clock. */
  expiresAt: Schema.Finite,
});
export type BootstrapToken = typeof BootstrapToken.Type;

export const ParticipantRegistered = Schema.Struct({
  participant: ParticipantSummary,
  tunnel: BootstrapToken,
});
export type ParticipantRegistered = typeof ParticipantRegistered.Type;
