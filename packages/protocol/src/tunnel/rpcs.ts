/**
 * The tunnel calls (ADR-0007): what the hub can ask of a participant runtime
 * over its tunnel. The roles are inverted on purpose. The participant dials
 * the WebSocket and serves these calls; the hub accepts the socket and makes
 * them. The hub never originates a connection.
 *
 * Every call here is hub to participant. What is born on the participant
 * (harness messages, artifacts) travels as the chunks of a stream call the
 * hub opens, never as a call in the other direction.
 *
 * To add a call: define it with `Rpc.make`, add it to `TunnelRpcs`, and
 * implement its handler where the participant runtime is hosted. The compiler
 * points at every runtime that is missing the handler.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * The hub's first call on a new tunnel. It tells the participant runtime
 * that the hub accepted the tunnel and that the participant is `online`
 * from now on. The runtime answers it itself.
 */
export const Welcome = Rpc.make("Welcome", {
  payload: {
    roomCode: Schema.String,
    participantId: Schema.String,
    /** The Gambi version of the hub. */
    hubVersion: Schema.String,
  },
});

/**
 * Diagnostic: the participant runtime answers with the same text. A cheap
 * round trip through the whole tunnel.
 */
export const Echo = Rpc.make("Echo", {
  payload: { text: Schema.String },
  success: Schema.String,
});

/**
 * Diagnostic: the participant runtime streams the integers from `0` up to
 * `count`, exclusive. Exercises streaming and backpressure through the tunnel.
 */
export const Ticks = Rpc.make("Ticks", {
  payload: { count: Schema.Int },
  success: Schema.Int,
  stream: true,
});

/** Every call of the tunnel. The hub's client and the participant's server derive from it. */
export class TunnelRpcs extends RpcGroup.make(Welcome, Echo, Ticks) {}

/** The path of the tunnel's WebSocket upgrade on the hub. */
export const tunnelPath = (roomCode: string, participantId: string): string =>
  `/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(participantId)}/tunnel`;

const HTTP_SCHEME = /^http/;
const TRAILING_SLASHES = /\/+$/;

/**
 * The URL a participant runtime dials to open its tunnel: the hub URL it
 * registered at, with the WebSocket scheme, and the bootstrap token.
 *
 * @example
 * tunnelUrl("http://192.168.0.10:3000", "AB12CD", "arthur-1", token);
 * // "ws://192.168.0.10:3000/v1/rooms/AB12CD/participants/arthur-1/tunnel?token=..."
 */
export const tunnelUrl = (
  hubUrl: string,
  roomCode: string,
  participantId: string,
  token: string
): string =>
  `${hubUrl.replace(HTTP_SCHEME, "ws").replace(TRAILING_SLASHES, "")}${tunnelPath(roomCode, participantId)}?token=${encodeURIComponent(token)}`;
