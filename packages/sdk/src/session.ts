/**
 * What the two participant sessions of the SDK share (`./participant-session.ts`
 * and `./harness-participant-session.ts`): one participant runtime hosted in
 * this process behind a `Promise` boundary, followed through its life, and
 * the two ways out of the room.
 *
 * Internal: nothing of Effect leaves through the sessions built on this.
 */
import { BunServices, BunSocket } from "@effect/platform-bun";
import type { ParticipantLifecycleEvent as RuntimeLifecycleEvent } from "@gambi/core/participant/runtime";
import { Effect, Layer } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import type { Socket } from "effect/socket";
import { createClient } from "./client.ts";
import type { Assert, Same } from "./contract.ts";
import { failingWith, host, type LogEntry, logsTo } from "./hosting.ts";
import {
  type ParticipantError,
  type ParticipantFailure,
  toParticipantError,
} from "./participant-error.ts";
import type { PromiseBoundary } from "./promise.ts";

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
 * - `tunnelDropped`: the tunnel dropped and the session was started with
 *   `reconnect: false`.
 */
export interface ParticipantLeft {
  /** The error behind `refused`: its name and its message. */
  readonly error?: { readonly name: string; readonly message: string };
  readonly participantId: string;
  readonly reason: "stopped" | "refused" | "replaced" | "tunnelDropped";
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
   * When the runtime already ended by itself the hub is told nothing: after
   * `replaced`, the participant with this id in the room is another runtime.
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

/** What a hosted participant runtime needs from this machine. */
export type Platform =
  | BunServices.BunServices
  | HttpClient.HttpClient
  | Socket.WebSocketConstructor;

export const DEFAULT_LEAVE_TIMEOUT_MS = 3000;

export interface Session<A, R> extends SessionControls {
  readonly boundary: PromiseBoundary<R>;
  /** What `joined` read once the participant was online. */
  readonly value: A;
}

/**
 * Joins the room with what `participant` describes and resolves once it is
 * `online`. It rejects with a `ParticipantError` when the join fails, and
 * then nothing is left running.
 *
 * `leaves` says when leaving tells the hub: `beforeStopping`, so the room
 * hears one thing (the participant left) instead of seeing it `offline` in
 * between; or `afterStopping`, for a runtime that still has something to
 * send through its tunnel while it stops.
 */
export const joinRoom = async <A, R>(options: {
  readonly hubUrl: string;
  readonly joined: Effect.Effect<A, never, R>;
  readonly leaves: "beforeStopping" | "afterStopping";
  readonly leaveTimeoutMs: number | undefined;
  readonly onLifecycle: SessionOptions["onLifecycle"];
  readonly onLog: SessionOptions["onLog"];
  readonly participant: (
    onLifecycle: (event: RuntimeLifecycleEvent) => Effect.Effect<void>
  ) => Layer.Layer<R, ParticipantFailure | ParticipantError, Platform>;
  readonly participantId: string;
  readonly roomCode: string;
}): Promise<Session<A, R>> => {
  // After `leave` or `stop` started, a drop of the tunnel is our own doing.
  let stopping = false;
  let endedByItself = false;
  const ended = Promise.withResolvers<ParticipantSessionEnd>();

  const onLifecycle = (event: RuntimeLifecycleEvent) =>
    Effect.sync(() => {
      if (event.type === "left") {
        endedByItself = event.reason !== "stopped";
        ended.resolve({
          reason: event.reason,
          ...(event.error === undefined ? {} : { error: event.error }),
        });
      } else if (stopping) {
        return;
      }
      options.onLifecycle?.(event);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("The onLifecycle callback threw.", cause)
      )
    );

  const { boundary, value } = await host(
    options
      .participant(onLifecycle)
      .pipe(
        Layer.provide([
          BunServices.layer,
          BunSocket.layerWebSocketConstructor,
          FetchHttpClient.layer,
        ]),
        Layer.provide(logsTo(options.onLog)),
        failingWith(toParticipantError)
      ),
    "The participant session",
    options.joined
  );

  /**
   * Tells the hub that the participant left, with a client of its own, so
   * that giving up can take the request back: closing a client interrupts
   * its calls in flight. A request left behind would hold the process, and
   * could still take effect later, when the participant with this id may be
   * another runtime.
   */
  const tellHub = async (): Promise<void> => {
    const client = createClient({ hubUrl: options.hubUrl });
    const gaveUp = Promise.withResolvers<void>();
    const timer = setTimeout(
      gaveUp.resolve,
      options.leaveTimeoutMs ?? DEFAULT_LEAVE_TIMEOUT_MS
    );
    await Promise.race([
      client.participants
        .remove(options.roomCode, options.participantId)
        .catch(() => undefined),
      gaveUp.promise,
    ]);
    // A pending timer would keep the process alive.
    clearTimeout(timer);
    await client.close();
  };

  const leave = async (): Promise<void> => {
    stopping = true;
    if (endedByItself) {
      await boundary.close();
    } else if (options.leaves === "beforeStopping") {
      await tellHub();
      await boundary.close();
    } else {
      await boundary.close();
      await tellHub();
    }
  };

  let left: Promise<void> | undefined;
  const leaveOnce = (): Promise<void> => {
    left ??= leave();
    return left;
  };

  return {
    boundary,
    value,
    ended: ended.promise,
    leave: leaveOnce,
    stop: () => {
      stopping = true;
      left ??= boundary.close();
      return left;
    },
    [Symbol.asyncDispose]: leaveOnce,
  };
};

/** The public lifecycle events are the ones the runtime reports. */
export type LifecycleProofs = [
  Assert<Same<ParticipantLifecycleEvent, RuntimeLifecycleEvent>>,
];
