/**
 * The public types of the management plane: rooms, participants, room
 * events and what a client attached to a harness participant reads and
 * sends, as a hub answers them.
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

/**
 * The harnesses a participant can contribute. `fake` is the deterministic
 * test harness, which calls no model.
 */
export type HarnessId = "opencode" | "claude-code" | "codex" | "fake";

/** What a harness participant says about its harness when it registers. */
export interface HarnessProfile {
  /** `true` when the room host runs this harness for someone who brought none. */
  readonly hosted?: boolean;
  readonly id: HarnessId;
  /** The model the harness runs on, when the participant chose to say. */
  readonly model?: string;
}

export interface ParticipantSummary {
  readonly capabilities: ParticipantCapabilities;
  readonly config: RuntimeConfigPublic;
  /** The provider endpoint on the participant's machine. The hub never calls it. */
  readonly endpoint?: string;
  /** Present on a harness participant: the harness it contributes instead of a model endpoint. */
  readonly harness?: HarnessProfile;
  /** The stable id the participant picked for itself. */
  readonly id: string;
  /** Milliseconds since the epoch. Kept across re-registrations. */
  readonly joinedAt: number;
  readonly model: string;
  readonly nickname: string;
  /**
   * The participant runtime this participant belongs to: the one that
   * registered it, until another registers it while it is `offline` or opens
   * its tunnel. It is what `participants.remove` names. Not a secret.
   */
  readonly runtimeId: string;
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
  /** The harness this participant contributes, which makes it a harness participant. */
  readonly harness?: HarnessProfile;
  readonly model: string;
  readonly nickname: string;
  /** The room password, when the room has one. */
  readonly password?: string;
  /**
   * The id of the participant runtime that registers: any string the runtime
   * makes for itself (a UUID, for one), the same in every registration of
   * its life. `participants.remove` names it.
   */
  readonly runtimeId: string;
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

/** The inference API a request came through. */
export type InferenceProtocol = "chatCompletions" | "openResponses";

/** What the three events of one inference request have in common. */
interface InferenceRequestEvent extends RoomEventBase {
  /** The participant's model, which is the one the provider was asked for. */
  readonly model: string;
  /** The participant the request was dispatched to. */
  readonly participantId: string;
  readonly protocol: InferenceProtocol;
  /** The id of the HTTP request on the hub: the same in the three events and in the hub's log. */
  readonly requestId: string;
}

/**
 * The hub dispatched an inference request to a participant. One of
 * `llm.complete` and `llm.error` follows, with the same `requestId`.
 */
export interface LlmRequest extends InferenceRequestEvent {
  /** The model selector the app asked for. */
  readonly modelSelector: string;
  readonly type: "llm.request";
}

/**
 * How long a request took, as the hub saw it, and the tokens the provider
 * reported. The token counts come from the `usage` of an answer that is not
 * a stream; a streamed answer has none.
 */
export interface RequestMetrics {
  /** Milliseconds from the dispatch to the end of the answer. */
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly tokensPerSecond?: number;
  readonly totalTokens?: number;
  /** Milliseconds from the dispatch to the first piece of the answer's body. */
  readonly ttftMs: number;
}

/**
 * The provider's answer to a request ended. It may be an error of the
 * provider itself: `status` is the HTTP status it answered with.
 */
export interface LlmComplete extends InferenceRequestEvent {
  readonly metrics: RequestMetrics;
  readonly status: number;
  readonly type: "llm.complete";
}

/** A dispatched request ended without the provider's whole answer. */
export interface LlmError extends InferenceRequestEvent {
  /**
   * The `code` of the inference error the app got (`participant_disconnected`,
   * `inference_timeout`, ...), or `request_cancelled` when the app itself gave
   * the request up.
   */
  readonly code: string;
  /** The message of the error. */
  readonly error: string;
  /**
   * `dispatch` when the app had received nothing yet, `stream` when a
   * streamed answer was already on its way.
   */
  readonly stage: "dispatch" | "stream";
  readonly type: "llm.error";
}

/** Every event a room's stream can carry, told apart by `type`. */
export type RoomEvent =
  | RoomSnapshot
  | ParticipantJoined
  | ParticipantUpdated
  | ParticipantOnline
  | ParticipantBusy
  | ParticipantOffline
  | ParticipantRemoved
  | LlmRequest
  | LlmComplete
  | LlmError;

/**
 * One ACP v1 message: a JSON-RPC 2.0 object. The hub and the participant
 * runtime relay it as it is; what it means is between the client and the
 * harness.
 */
export type AcpMessage = Readonly<Record<string, unknown>>;

/** An ACP message the harness wrote, for the clients of one harness session. */
export interface HarnessMessage {
  readonly message: AcpMessage;
  readonly sessionId: string;
  readonly type: "harness.message";
}

/**
 * A harness session changed: it opened, it closed, or something about it
 * failed (`message` says what).
 */
export interface HarnessSessionStatus {
  readonly message?: string;
  readonly sessionId: string;
  readonly status: "opened" | "closed" | "error";
  readonly type: "harness.session";
}

/**
 * One file of an artifact: its path inside the Workspace, with `/` between
 * the segments on every platform, and its whole content. A file that is
 * valid UTF-8 travels as it is (`utf8`); any other travels in `base64`.
 */
export interface ArtifactFile {
  readonly content: string;
  readonly encoding: "utf8" | "base64";
  readonly path: string;
}

/**
 * An artifact: the files of the participant's Workspace at one moment. It is
 * a whole snapshot, never a difference, so each one replaces the one before:
 * a file that is not in `files` is not in the Workspace any more. `version`
 * counts the artifacts of one participant runtime from 1, and may skip.
 *
 * `reason` says why it was taken: `watch` when the Workspace changed and
 * then stayed still, `final` when the participant runtime was closing.
 */
export interface HarnessArtifact {
  readonly files: readonly ArtifactFile[];
  readonly reason: "watch" | "final";
  /** The harness session the participant runtime opened at start. */
  readonly sessionId: string;
  readonly type: "harness.artifact";
  readonly version: number;
}

/** The hub is receiving the harness participant's events: its tunnel is open. */
export interface HarnessConnected {
  readonly type: "harness.connected";
}

/**
 * The hub is not receiving the harness participant's events. `reason` names
 * why: `NoTunnel` when the participant has no open tunnel yet, otherwise the
 * error that ended the stream. The client stays attached and hears
 * `harness.connected` when the participant is back.
 */
export interface HarnessDisconnected {
  readonly message?: string;
  readonly reason: string;
  readonly type: "harness.disconnected";
}

/**
 * This client read too slowly: the hub dropped the `count` oldest events it
 * was holding for it, at this point of the stream.
 */
export interface HarnessEventsDropped {
  readonly count: number;
  readonly type: "harness.dropped";
}

/**
 * The participant is out of the room, so the client is detached: this is the
 * last event of its stream.
 */
export interface HarnessDetached {
  readonly reason: RemovalReason;
  readonly type: "harness.detached";
}

/**
 * Everything a client attached to a harness participant reads, told apart by
 * `type`: what the harness says, plus what the hub has to say about the
 * stream itself.
 */
export type HarnessAttachEvent =
  | HarnessMessage
  | HarnessSessionStatus
  | HarnessArtifact
  | HarnessConnected
  | HarnessDisconnected
  | HarnessEventsDropped
  | HarnessDetached;

/** Where a harness session a client opens runs. */
export interface OpenHarnessSessionInput {
  /** A folder inside the participant's Workspace. Default: the Workspace itself. */
  readonly cwd?: string;
}

/** The harness session a call was about. */
export interface HarnessSessionRef {
  readonly sessionId: string;
}
