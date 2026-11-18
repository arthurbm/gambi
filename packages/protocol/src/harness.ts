/**
 * The schemas of the harness layer (ADR-0006): what a harness participant
 * sends up to the hub, and what a management client attached to it reads.
 *
 * The hub relays and never interprets an ACP message: `AcpMessage` is opaque
 * on purpose. ACP stays pinned to v1.
 */
import { Schema } from "effect";

/**
 * The harnesses a participant can contribute. `fake` is the deterministic
 * test harness, which calls no model. `pi` is accepted by the schema and has
 * no adapter yet (ADR-0006).
 */
export const HarnessId = Schema.Literals([
  "opencode",
  "claude-code",
  "codex",
  "pi",
  "fake",
]);
export type HarnessId = typeof HarnessId.Type;

/** What a harness participant says about its harness when it registers. */
export const HarnessProfile = Schema.Struct({
  id: HarnessId,
  /** The model the harness runs on, when the participant chose to say. */
  model: Schema.optionalKey(Schema.NonEmptyString),
  /** `true` when the room host runs this harness for someone who brought none. */
  hosted: Schema.optionalKey(Schema.Boolean),
});
export type HarnessProfile = typeof HarnessProfile.Type;

/** One ACP v1 message: a JSON-RPC 2.0 object. Relayed as it is. */
export const AcpMessage = Schema.Record(Schema.String, Schema.Unknown);
export type AcpMessage = typeof AcpMessage.Type;

/**
 * The id of a harness session, as the hub and the attached clients know it.
 * The client that opens the session picks it; the participant runtime maps it
 * to the id the harness itself gave the session, which never leaves the
 * participant's machine.
 */
export const HarnessSessionId = Schema.NonEmptyString;
export type HarnessSessionId = typeof HarnessSessionId.Type;

/** An ACP message the harness wrote, for the clients of one harness session. */
export const HarnessMessage = Schema.Struct({
  type: Schema.tag("harness.message"),
  sessionId: HarnessSessionId,
  message: AcpMessage,
});
export type HarnessMessage = typeof HarnessMessage.Type;

/**
 * A harness session changed: it opened, it closed, or something about it
 * failed (`message` says what).
 */
export const HarnessSessionStatus = Schema.Struct({
  type: Schema.tag("harness.session"),
  sessionId: HarnessSessionId,
  status: Schema.Literals(["opened", "closed", "error"]),
  message: Schema.optionalKey(Schema.String),
});
export type HarnessSessionStatus = typeof HarnessSessionStatus.Type;

/**
 * One file of an artifact: its path inside the Workspace, with `/` between
 * the segments on every platform, and its whole content. A file that is valid
 * UTF-8 travels as it is (`utf8`); any other travels in `base64`.
 */
export const ArtifactFile = Schema.Struct({
  path: Schema.NonEmptyString,
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String,
});
export type ArtifactFile = typeof ArtifactFile.Type;

/**
 * The largest artifact a participant runtime sends, in bytes of the JSON text
 * of its event. A Workspace that does not fit sends no artifact at all.
 *
 * An artifact is one event, and two things on its way have a limit, both
 * measured: the hub drops a tunnel that receives a WebSocket message of 16 MiB
 * (the default of Bun's server), and the client derived from the contract
 * fails a stream on a Server-Sent Event above 10 MiB (the default of
 * `effect/encoding/Sse`). This stays under both.
 */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

/**
 * An artifact: the files of the participant's Workspace at one moment. It is
 * a whole snapshot, never a difference, so each one replaces the one before:
 * a file that is not in `files` is not in the Workspace any more. `version`
 * counts the artifacts of one participant runtime from 1.
 *
 * `reason` says why it was taken: `watch` when the Workspace changed and then
 * stayed still, `final` when the participant runtime was closing.
 *
 * Artifacts only go up, from the participant to the hub. Nothing in the
 * tunnel writes a file on the participant's machine (ADR-0006).
 */
export const HarnessArtifact = Schema.Struct({
  type: Schema.tag("harness.artifact"),
  /** The harness session the runtime opened at start. */
  sessionId: HarnessSessionId,
  version: Schema.Int,
  reason: Schema.Literals(["watch", "final"]),
  files: Schema.Array(ArtifactFile),
});
export type HarnessArtifact = typeof HarnessArtifact.Type;

/**
 * Everything that is born on a harness participant and goes up to the hub: one
 * chunk of the `HarnessEvents` tunnel call. A new kind of thing the
 * participant produces is a new member here.
 */
export const HarnessEvent = Schema.Union([
  HarnessMessage,
  HarnessSessionStatus,
  HarnessArtifact,
]);
export type HarnessEvent = typeof HarnessEvent.Type;

/**
 * The hub is receiving the harness participant's events: its tunnel is open
 * and the participant serves the `HarnessEvents` call.
 */
export const HarnessConnected = Schema.Struct({
  type: Schema.tag("harness.connected"),
});
export type HarnessConnected = typeof HarnessConnected.Type;

/**
 * The hub is not receiving the harness participant's events. `reason` names
 * why: `NoTunnel` when the participant has no open tunnel yet, otherwise the
 * error that ended the stream (`SocketCloseError`, `SocketReadError`,
 * `CallNotSupported`, ...). A client stays attached and hears
 * `harness.connected` when the participant is back.
 */
export const HarnessDisconnected = Schema.Struct({
  type: Schema.tag("harness.disconnected"),
  reason: Schema.String,
  message: Schema.optionalKey(Schema.String),
});
export type HarnessDisconnected = typeof HarnessDisconnected.Type;

/**
 * This client read too slowly: the hub dropped the `count` oldest events it
 * was holding for it, at this point of the stream.
 */
export const HarnessEventsDropped = Schema.Struct({
  type: Schema.tag("harness.dropped"),
  count: Schema.Int,
});
export type HarnessEventsDropped = typeof HarnessEventsDropped.Type;

/**
 * The participant is out of the room, so the client is detached: this is the
 * last event of its stream. `reason` is the one of the room's
 * `participant.removed` event.
 */
export const HarnessDetached = Schema.Struct({
  type: Schema.tag("harness.detached"),
  reason: Schema.Literals(["left", "reconnectDeadlinePassed"]),
});
export type HarnessDetached = typeof HarnessDetached.Type;

/**
 * What a management client attached to a harness participant reads: the
 * participant's events, plus what the hub itself has to say about the stream.
 */
export const HarnessAttachEvent = Schema.Union([
  HarnessMessage,
  HarnessSessionStatus,
  HarnessArtifact,
  HarnessConnected,
  HarnessDisconnected,
  HarnessEventsDropped,
  HarnessDetached,
]);

/** One ACP message for one session of a harness, as a management client sends it. */
export const SendHarnessMessage = Schema.Struct({
  sessionId: HarnessSessionId,
  message: AcpMessage,
});
export type SendHarnessMessage = typeof SendHarnessMessage.Type;

/** Where a harness session a client opens runs. */
export const OpenHarnessSession = Schema.Struct({
  /** A folder inside the participant's Workspace. Default: the Workspace itself. */
  cwd: Schema.optionalKey(Schema.NonEmptyString),
});
export type OpenHarnessSession = typeof OpenHarnessSession.Type;

/** The harness session a call was about. */
export const HarnessSessionRef = Schema.Struct({
  sessionId: HarnessSessionId,
});
export type HarnessSessionRef = typeof HarnessSessionRef.Type;
export type HarnessAttachEvent = typeof HarnessAttachEvent.Type;
