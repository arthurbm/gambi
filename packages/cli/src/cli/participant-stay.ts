/**
 * A participant's stay in a room, as `participant join` hosts it: from the
 * moment the participant is online to the moment it is out of the room, with
 * one event written per step.
 *
 * | Event | When |
 * |---|---|
 * | `harness_started` | a harness participant only: its harness is running |
 * | `registered` | the hub registered the participant |
 * | `tunnel_connected` | the tunnel opened; again after each reconnection |
 * | `reconnecting` | the tunnel is down and the runtime tries again |
 * | `artifact_sent`, `artifact_skipped` | a harness participant only: what happened to an artifact of its Workspace |
 * | `harness_exited` | a harness participant only: the harness ended by itself |
 * | `leaving` | a signal asked the participant to leave |
 * | `left` | the stay is over, and `reason` says why |
 */
import type { ArtifactLifecycleEvent } from "@gambi/core/harness/artifacts";
import { Harness } from "@gambi/core/harness/harness";
import {
  type ParticipantLifecycleEvent,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import { Context, Duration, Effect, Exit, Layer, Option, Queue } from "effect";
import { withHub } from "./hub-client.ts";
import { Output } from "./output.ts";
import { Termination, type TerminationSignal } from "./termination.ts";

/** Who stays: one participant of one room. Every event carries it. */
export interface Identity {
  readonly participantId: string;
  readonly roomCode: string;
}

/** How long leaving waits for the hub to confirm before it gives up on telling it. */
const LEAVE_TIMEOUT = Duration.seconds(3);

/**
 * Tells the hub that the participant left the room. `true` when the hub
 * confirmed it, or said the participant or the room is already gone; `false`
 * when the hub did not answer in time, and then it removes the participant
 * by itself once the reconnection deadline passes.
 */
const leaveRoom = (hubUrl: string, { participantId, roomCode }: Identity) =>
  withHub(hubUrl, (client) =>
    client.participants.remove({
      params: { code: roomCode, id: participantId },
    })
  ).pipe(
    Effect.as(true),
    Effect.catchTag(["ParticipantNotFound", "RoomNotFound"], () =>
      Effect.succeed(true)
    ),
    Effect.timeoutOption(LEAVE_TIMEOUT),
    Effect.map((left) => left._tag === "Some" && left.value),
    Effect.catch(() => Effect.succeed(false))
  );

/** The last line a person reads: how the stay ended. */
const leftText = (
  roomCode: string,
  reason: string,
  removed: boolean
): string => {
  if (reason !== "stopped") {
    return `No longer in room ${roomCode} (${reason}).`;
  }
  return removed
    ? `Left room ${roomCode}.`
    : `Stopped. The hub did not confirm: it takes the participant out of room ${roomCode} by itself in a minute.`;
};

/**
 * Writes what happened to an artifact of the Workspace. A host gives it to
 * `harnessParticipant` as `onArtifact`.
 */
export const reportArtifact = (identity: Identity) =>
  Effect.fnUntraced(function* (event: ArtifactLifecycleEvent) {
    const output = yield* Output;
    const { type, ...data } = event;
    yield* output.event(
      type === "artifactSent" ? "artifact_sent" : "artifact_skipped",
      { ...identity, ...data },
      event.type === "artifactSent"
        ? `Sent artifact v${event.version} (${event.fileCount} files, ${event.reason}).`
        : `Sent no artifact (${event.cause}, ${event.reason}).`
    );
  });

export interface Stay<Hosted, E, R> {
  /**
   * The participant in the room, for as long as the layer lives. It hands
   * `onLifecycle` to its participant runtime.
   *
   * When what is hosted has a `Harness`, it is a harness participant: the
   * stay then also ends when the harness ends by itself, and leaving tells
   * the hub last, so that the last artifact goes up while the tunnel is
   * still open.
   */
  readonly host: (
    onLifecycle: (event: ParticipantLifecycleEvent) => Effect.Effect<void>
  ) => Layer.Layer<ParticipantRuntime | Hosted, E, R>;
  readonly hubUrl: string;
  readonly identity: Identity;
  /** What the harness is called in its events. */
  readonly label: string;
}

/**
 * Joins the room and stays until a signal asks to leave, or until what is
 * hosted ends by itself. A stay that a signal ended is a success; one that
 * ended by itself fails with the name of why, after `left` is written.
 */
export const stayInRoom = <Hosted, E, R>(stay: Stay<Hosted, E, R>) =>
  // A generator given to `Effect.fn` loses these type parameters.
  Effect.gen(function* () {
    const output = yield* Output;
    const termination = yield* Termination;
    const { identity } = stay;
    const lifecycle = yield* Queue.unbounded<ParticipantLifecycleEvent>();

    /** Writes each step of the runtime's life, until the one that ends it. */
    const untilTheRuntimeLeaves = Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(lifecycle);
        if (event.type === "left") {
          return event;
        }
        if (event.type === "connected") {
          yield* output.event(
            "tunnel_connected",
            {
              ...identity,
              attempt: event.attempt,
              hubVersion: event.hubVersion,
            },
            event.attempt === 0
              ? "Tunnel connected. Press Ctrl+C to leave."
              : "Tunnel connected again."
          );
        } else {
          yield* output.event(
            "reconnecting",
            {
              ...identity,
              attempt: event.attempt,
              delayMillis: event.delayMillis,
              reason: event.reason,
            },
            `Lost the hub (${event.reason}). Trying again in ${event.delayMillis / 1000} s (attempt ${event.attempt})...`
          );
        }
      }
    });

    const leaving = (signal: TerminationSignal) =>
      output.event(
        "leaving",
        { ...identity, signal },
        `Leaving room ${identity.roomCode} (${signal})...`
      );

    // The scope holds the participant in the room. When it closes, a harness
    // participant sends its last artifact, the tunnel closes and the harness
    // stops, in that order, before `left` is written.
    const ending = yield* Effect.scoped(
      Effect.gen(function* () {
        // The signal is listened for from here on, not only once the
        // participant is online: the hub may already have registered a
        // participant whose tunnel is still opening.
        const joining = yield* Effect.raceFirst(
          Effect.map(termination.signal, (signal) => ({ signal })),
          Effect.map(
            Layer.build(stay.host((event) => Queue.offer(lifecycle, event))),
            (hosted) => ({ hosted })
          )
        );
        if ("signal" in joining) {
          yield* leaving(joining.signal);
          return {
            reason: "stopped" as const,
            removed: false,
            tellTheHub: true,
            ended: Exit.void,
          };
        }
        const { hosted } = joining;
        const runtime = Context.get(hosted, ParticipantRuntime);
        const harness = Option.getOrUndefined(
          Context.getOption(hosted, Harness)
        );
        if (harness !== undefined) {
          yield* output.event(
            "harness_started",
            {
              ...identity,
              harness: stay.label,
              pid: harness.pid,
              sessionId: harness.sessionId,
              workspace: harness.workspacePath,
            },
            `Started ${stay.label} (pid ${harness.pid}) in ${harness.workspacePath}.`
          );
        }
        yield* output.event(
          "registered",
          { roomCode: identity.roomCode, participant: runtime.participant },
          `Registered ${runtime.participant.nickname} (${identity.participantId}) in room ${identity.roomCode}.`
        );

        const how = yield* Effect.raceFirst(
          Effect.map(termination.signal, (signal) => ({ signal })),
          Effect.raceFirst(
            Effect.map(untilTheRuntimeLeaves, (left) => ({ left })),
            harness === undefined
              ? Effect.never
              : Effect.map(harness.exited, (failure) => ({ failure }))
          )
        );
        if ("left" in how) {
          // The runtime ended by itself: the hub refused it on its way back,
          // or gave its place to another runtime. The hub is told nothing:
          // the participant with this id in the room, if there is one, is not
          // this runtime any more.
          return {
            reason: how.left.reason,
            removed: false,
            tellTheHub: false,
            ended: yield* Effect.exit(runtime.ended),
          };
        }
        if ("failure" in how) {
          yield* output.event(
            "harness_exited",
            {
              ...identity,
              harness: stay.label,
              message: how.failure.message,
              ...(how.failure.exitCode === undefined
                ? {}
                : { exitCode: how.failure.exitCode }),
            },
            `${stay.label} ended by itself: ${how.failure.message}`
          );
          return {
            reason: "harnessExited" as const,
            removed: false,
            tellTheHub: true,
            ended: Exit.fail(how.failure),
          };
        }
        yield* leaving(how.signal);
        // A participant that shares a model endpoint tells the hub first, so
        // the room hears one thing: the participant left. Closing the tunnel
        // first would show it offline in between.
        return harness === undefined
          ? {
              reason: "stopped" as const,
              removed: yield* leaveRoom(stay.hubUrl, identity),
              tellTheHub: false,
              ended: Exit.void,
            }
          : {
              reason: "stopped" as const,
              removed: false,
              tellTheHub: true,
              ended: Exit.void,
            };
      })
    );
    const removed = ending.tellTheHub
      ? yield* leaveRoom(stay.hubUrl, identity)
      : ending.removed;
    yield* output.event(
      "left",
      { ...identity, reason: ending.reason, removed },
      leftText(identity.roomCode, ending.reason, removed)
    );
    // A stay that ended by itself is a failure, with the name of why.
    yield* ending.ended;
  });
