/**
 * The public types every participant session shares: its options, what it
 * offers once it joined, and the events of the runtime's life.
 *
 * Written by hand, like `./types.ts`: `./session.ts` proves that the events
 * are the ones the participant runtime reports.
 */
import type { LogEntry } from "./log.ts";

/** Why a participant runtime is not connected and is about to try again. */
export type ReconnectReason =
  /** The tunnel dropped: the hub closed it, or the connection was lost. */
  | "tunnelDropped"
  /** The tunnel was open but the hub went silent, as a frozen process does. */
  | "hubSilent"
  /** The hub did not answer the registration. */
  | "hubUnreachable"
  /** The hub registered the participant, but the tunnel did not open. */
  | "tunnelOpenFailed"
  /** The hub answered the registration with an internal error. */
  | "hubError";

/** The tunnel is open and the participant is `online`. */
export interface ParticipantConnected {
  /** `0` for the join; after a drop, the number of the attempt that brought it back. */
  readonly attempt: number;
  /** The Gambi version of the hub. */
  readonly hubVersion: string;
  readonly participantId: string;
  readonly roomCode: string;
  readonly type: "connected";
}

/** The runtime is not connected and tries again in `delayMillis`. */
export interface ParticipantReconnecting {
  /** Counted from `1` after each drop. */
  readonly attempt: number;
  readonly delayMillis: number;
  readonly participantId: string;
  readonly reason: ReconnectReason;
  readonly roomCode: string;
  readonly type: "reconnecting";
}

/**
 * The runtime ended and tries no more.
 *
 * - `stopped`: this program stopped it (`leave`, `stop`).
 * - `refused`: the hub refused it when it tried to come back; `error` says why.
 * - `replaced`: another runtime joined the room with the same `participantId`
 *   and the hub kept that one.
 * - `removed`: someone else took the participant out of the room
 *   (`client.participants.remove`, `gambi participant leave`).
 * - `tunnelDropped`: the tunnel dropped and the session was started with
 *   `reconnect: false`.
 */
export interface ParticipantLeft {
  /** The error behind `refused`: its name and its message. */
  readonly error?: { readonly name: string; readonly message: string };
  readonly participantId: string;
  readonly reason:
    | "stopped"
    | "refused"
    | "replaced"
    | "removed"
    | "tunnelDropped";
  readonly roomCode: string;
  readonly type: "left";
}

/**
 * What happens to a participant runtime over its life, from the join on, in
 * order. Plain JSON: print an event, or hand it to another process, as it is.
 * A session that never joined reports nothing: the join itself rejects.
 */
export type ParticipantLifecycleEvent =
  | ParticipantConnected
  | ParticipantReconnecting
  | ParticipantLeft;

/** How a session ended: the `reason` and the `error` of its `left` event. */
export type ParticipantSessionEnd = Pick<ParticipantLeft, "error" | "reason">;

/** What every participant session takes, whatever it contributes to the room. */
export interface SessionOptions {
  /** The URL of the hub, without `/v1`. Default `http://localhost:3000`. */
  readonly hubUrl?: string | undefined;
  /**
   * How long leaving waits for the hub to answer before it gives up on
   * telling it, in milliseconds. Default 3 seconds.
   */
  readonly leaveTimeoutMs?: number | undefined;
  /**
   * Called with each step of the runtime's life, in order: the join
   * (`connected`), a hub that went away (`reconnecting`), the way back
   * (`connected`), the end (`left`). The runtime waits for it: keep it quick.
   */
  readonly onLifecycle?:
    | ((event: ParticipantLifecycleEvent) => void)
    | undefined;
  /**
   * Called with each log line of the runtime. Without it the runtime logs
   * nowhere: it never writes to the stdout of the program that hosts it.
   */
  readonly onLog?: ((entry: LogEntry) => void) | undefined;
  /** The stable id of this participant. Reuse it to come back as the same one. */
  readonly participantId: string;
  /** The room password, when the room has one. */
  readonly password?: string | undefined;
  /**
   * Whether the runtime comes back by itself when its tunnel drops. Default
   * `true`. With `false` it ends on the first drop.
   */
  readonly reconnect?: boolean | undefined;
  readonly roomCode: string;
}

/** What every participant session offers once it joined. */
export interface SessionControls {
  /**
   * Resolves when the runtime ended and tries no more, with how: because
   * this program left or stopped it, or by itself. It never rejects.
   */
  readonly ended: Promise<ParticipantSessionEnd>;
  /**
   * Leaves the room: takes the participant out of it at once and stops the
   * runtime. It never rejects and never waits long for a hub that is gone.
   *
   * After `replaced` or `removed` the hub is told nothing: the participant
   * with this id in the room, if there is one, is another runtime's, and it
   * stays. The hub would refuse anyway: a session only ever takes out the
   * participant of its own runtime.
   */
  readonly leave: () => Promise<void>;
  /**
   * Stops the runtime without telling the hub that the participant left:
   * the room shows it `offline` and removes it after 60 seconds, unless a
   * runtime with the same `participantId` joins before that.
   */
  readonly stop: () => Promise<void>;
  /** The same as `leave`. */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}
