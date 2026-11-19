/**
 * What the two participant sessions of the SDK share (`./participant-session.ts`
 * and `./harness-participant-session.ts`): one participant runtime hosted in
 * this process behind a `Promise` boundary, followed through its life, and
 * the two ways out of the room.
 *
 * Internal: nothing of Effect leaves through the sessions built on this, and
 * their public types live in `./session-types.ts`.
 */
import { BunServices, BunSocket } from "@effect/platform-bun";
import type { ParticipantLifecycleEvent as RuntimeLifecycleEvent } from "@gambi/core/participant/runtime";
import { Effect, Layer } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import type { Socket } from "effect/socket";
import { createClient } from "./client.ts";
import { calling, failingWith, failureTo, host, logsTo } from "./hosting.ts";
import type { ParticipantError } from "./participant-error.ts";
import {
  type ParticipantFailure,
  toParticipantError,
} from "./participant-failure.ts";
import type { PromiseBoundary } from "./promise.ts";
import type {
  ParticipantSessionEnd,
  SessionControls,
  SessionOptions,
} from "./session-types.ts";

/** What a hosted participant runtime needs from this machine. */
export type Platform =
  | BunServices.BunServices
  | HttpClient.HttpClient
  | Socket.WebSocketConstructor;

export const DEFAULT_LEAVE_TIMEOUT_MS = 3000;

type EndReason = ParticipantSessionEnd["reason"];

/**
 * The ends after which the room has no participant of this runtime: another
 * runtime has its id, or someone took it out.
 */
const NOT_OURS_ANY_MORE: ReadonlySet<EndReason> = new Set([
  "replaced",
  "removed",
]);

/** The ends a session that is leaving brought about itself. */
const OUR_OWN_DOING: ReadonlySet<EndReason> = new Set([
  "removed",
  "tunnelDropped",
]);

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
  /** The participant, hosted by a runtime that takes these two as options. */
  readonly participant: (runtime: {
    readonly onLifecycle: (event: RuntimeLifecycleEvent) => Effect.Effect<void>;
    readonly runtimeId: string;
  }) => Layer.Layer<R, ParticipantFailure | ParticipantError, Platform>;
  readonly participantId: string;
  readonly roomCode: string;
}): Promise<Session<A, R>> => {
  // After `leave` or `stop` started, a drop of the tunnel is our own doing.
  let stopping = false;
  // The room has no participant of this runtime any more: another runtime
  // has its id, or someone took it out.
  let gone = false;
  // The id of the runtime this session hosts. Leaving names it, so that the
  // hub takes out this runtime's participant and no other with the same id.
  const runtimeId = crypto.randomUUID();
  // Whether the tunnel is open, as far as the runtime said.
  let online = true;
  // How the runtime ended, once it did.
  let end: ParticipantSessionEnd | undefined;
  // Releases everything the session holds. Set once the join returned.
  let release: (() => Promise<void>) | undefined;
  const ended = Promise.withResolvers<ParticipantSessionEnd>();

  /**
   * A runtime that ended holds nothing worth keeping: what it hosted (a
   * harness, a Workspace) is released, and only then does `ended` settle.
   */
  const settle = (): void => {
    if (end === undefined || release === undefined) {
      return;
    }
    const how = end;
    const resolve = () => ended.resolve(how);
    release().then(resolve, resolve);
  };

  const tellHost = calling(
    options.onLifecycle,
    failureTo(options.onLog, "The onLifecycle callback failed.")
  );

  // Releasing waits for the runtime's fibers, and this runs inside one of
  // them: whatever releases is started after the callback returned.
  const onLifecycle = (event: RuntimeLifecycleEvent) =>
    Effect.sync(() => {
      if (event.type === "left") {
        gone = NOT_OURS_ANY_MORE.has(event.reason);
        // A participant taken out while the session leaves was taken out
        // because the session asked: our own doing. So is a tunnel that
        // drops meanwhile.
        const reason =
          stopping && OUR_OWN_DOING.has(event.reason)
            ? "stopped"
            : event.reason;
        end = {
          reason,
          ...(event.error === undefined ? {} : { error: event.error }),
        };
        queueMicrotask(settle);
        tellHost({ ...event, reason });
        return;
      }
      online = event.type === "connected";
      if (stopping) {
        // The same closing, seen by a runtime that reconnects: it stops
        // here, before it registers again as if that were a drop to come
        // back from.
        if (event.type === "reconnecting") {
          // `leave` awaits the same release and hears how it went.
          queueMicrotask(() => release?.().catch(() => undefined));
        }
        return;
      }
      tellHost(event);
    });

  const { boundary, value } = await host(
    options
      .participant({ onLifecycle, runtimeId })
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

  release = boundary.close;
  // The runtime may have ended before the join returned.
  settle();

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
        .remove(options.roomCode, options.participantId, runtimeId)
        .catch(() => undefined),
      gaveUp.promise,
    ]);
    // A pending timer would keep the process alive.
    clearTimeout(timer);
    await client.close();
  };

  const leave = async (): Promise<void> => {
    stopping = true;
    if (gone) {
      await boundary.close();
    } else if (options.leaves === "beforeStopping" && online) {
      await tellHub();
      await boundary.close();
    } else {
      // Also for a runtime that is waiting to come back: stopped first, it
      // cannot register again after the hub took the participant out.
      await boundary.close();
      // Closing takes a while (the last artifact), and the tunnel is open
      // meanwhile: another runtime may have taken this participant's place.
      if (!gone) {
        await tellHub();
      }
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
      return left ?? boundary.close();
    },
    [Symbol.asyncDispose]: leaveOnce,
  };
};
