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
 *
 * `left.reason` is `stopped` when a signal asked for it, and otherwise how
 * the runtime ended by itself: `refused`, `replaced`, `removed` (someone took
 * the participant out of the room, with `participant leave` for one), or
 * `harnessExited`. `left.removed` says whether the participant is out of the
 * room as far as the hub said.
 */
import type { ArtifactLifecycleEvent } from "@gambi/core/harness/artifacts";
import { Harness } from "@gambi/core/harness/harness";
import {
  makeRuntimeId,
  type ParticipantLifecycleEvent,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import type { HarnessFailed } from "@gambi/protocol";
import { Context, Duration, Effect, Exit, Layer, Option, Queue } from "effect";
import { withHub } from "./hub-client.ts";
import { Output } from "./output.ts";
import { Termination, type TerminationSignal } from "./termination.ts";

/** Who stays: one participant of one room. Every event carries it. */
export interface Identity {
  readonly participantId: string;
  readonly roomCode: string;
}

/**
 * How telling the hub that the participant left went.
 *
 * - `removed`: the hub confirmed it, or said the participant or the room is
 *   already gone.
 * - `unconfirmed`: the hub did not answer in time, or was not told. It
 *   removes an offline participant by itself once the reconnection deadline
 *   passes.
 * - `leftAlone`: the hub said the participant with that id is another
 *   runtime's, and kept it.
 */
type Leave = "removed" | "unconfirmed" | "leftAlone";

/** How long leaving waits for the hub to confirm before it gives up on telling it. */
const LEAVE_TIMEOUT = Duration.seconds(3);

/**
 * Tells the hub that the participant left the room, and answers how that
 * went (`Leave`).
 *
 * The removal names this runtime, so the hub takes out only a participant
 * that is this runtime's. That is what makes it safe to ask at any moment,
 * even for a registration that may never have reached the hub: a participant
 * another runtime holds with the same id stays.
 */
const leaveRoom = (
  hubUrl: string,
  { participantId, roomCode }: Identity,
  runtimeId: string
) =>
  withHub(hubUrl, (client) =>
    client.participants.remove({
      params: { code: roomCode, id: participantId },
      query: { runtimeId },
    })
  ).pipe(
    Effect.as<Leave>("removed"),
    Effect.catchTag(["ParticipantNotFound", "RoomNotFound"], () =>
      Effect.succeed<Leave>("removed")
    ),
    Effect.catchTag("ParticipantOfAnotherRuntime", () =>
      Effect.succeed<Leave>("leftAlone")
    ),
    Effect.timeoutOption(LEAVE_TIMEOUT),
    Effect.map(Option.getOrElse((): Leave => "unconfirmed")),
    Effect.catch(() => Effect.succeed<Leave>("unconfirmed"))
  );

/**
 * What is known of the participant of a runtime that ended by itself: out of
 * the room when the hub took it out, and otherwise not this runtime's to
 * take out.
 */
const leaveOfARuntimeThatEnded = (reason: string): Leave =>
  reason === "removed" ? "removed" : "unconfirmed";

/** The last line a person reads: how the stay ended. */
const leftText = (
  { participantId, roomCode }: Identity,
  reason: string,
  leave: Leave
): string => {
  if (reason !== "stopped") {
    return `No longer in room ${roomCode} (${reason}).`;
  }
  switch (leave) {
    case "removed":
      return `Left room ${roomCode}.`;
    case "leftAlone":
      return `Stopped. Another participant runtime holds ${participantId} in room ${roomCode}, and it stays there.`;
    default:
      return `Stopped. The hub did not confirm: it takes the participant out of room ${roomCode} by itself in a minute.`;
  }
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
   * `onLifecycle` and `runtimeId` to its participant runtime.
   *
   * When what is hosted has a `Harness`, it is a harness participant: the
   * stay then also ends when the harness ends by itself, and leaving tells
   * the hub last, so that the last artifact goes up while the tunnel is
   * still open.
   */
  readonly host: (runtime: {
    readonly onLifecycle: (
      event: ParticipantLifecycleEvent
    ) => Effect.Effect<void>;
    readonly runtimeId: string;
  }) => Layer.Layer<ParticipantRuntime | Hosted, E, R>;
  readonly hubUrl: string;
  readonly identity: Identity;
  /** What the harness is called in its events. */
  readonly label: string;
}

/**
 * Writes each step of the runtime's life as it arrives, and answers with the
 * one that ends it.
 */
const followLifecycle = Effect.fnUntraced(function* (
  output: Output["Service"],
  identity: Identity,
  lifecycle: Queue.Dequeue<ParticipantLifecycleEvent>
) {
  while (true) {
    const event = yield* Queue.take(lifecycle);
    if (event.type === "left") {
      return event;
    }
    if (event.type === "connected") {
      yield* output.event(
        "tunnel_connected",
        { ...identity, attempt: event.attempt, hubVersion: event.hubVersion },
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

/** What `harness_exited` carries of the failure a harness ended with. */
const exitOf = (failure: HarnessFailed) => ({
  message: failure.message,
  ...(failure.exitCode === undefined ? {} : { exitCode: failure.exitCode }),
});

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
    // Made here, before the join: leaving names it, and a signal may ask to
    // leave before the runtime exists.
    const runtimeId = yield* makeRuntimeId;
    const lifecycle = yield* Queue.unbounded<ParticipantLifecycleEvent>();
    // Whether the tunnel is open, as far as the runtime said.
    let online = false;
    const untilTheRuntimeLeaves = followLifecycle(output, identity, lifecycle);

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
            Layer.build(
              stay.host({
                onLifecycle: (event) => {
                  online = event.type === "connected";
                  return Queue.offer(lifecycle, event);
                },
                runtimeId,
              })
            ),
            (hosted) => ({ hosted })
          )
        );
        if ("signal" in joining) {
          yield* leaving(joining.signal);
          return {
            reason: "stopped" as const,
            leave: "tell" as const,
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
          // gave its place to another runtime, or took the participant out
          // of the room. The hub is told nothing: the participant with this
          // id in the room, if there is one, is not this runtime any more.
          return {
            reason: how.left.reason,
            leave: leaveOfARuntimeThatEnded(how.left.reason),
            ended: yield* Effect.exit(runtime.ended),
          };
        }
        if ("failure" in how) {
          yield* output.event(
            "harness_exited",
            { ...identity, harness: stay.label, ...exitOf(how.failure) },
            `${stay.label} ended by itself: ${how.failure.message}`
          );
          return {
            reason: "harnessExited" as const,
            leave: "tell" as const,
            ended: Exit.fail(how.failure),
          };
        }
        yield* leaving(how.signal);
        // A participant that shares a model endpoint tells the hub first, so
        // the room hears one thing: the participant left. Closing the tunnel
        // first would show it offline in between. One that is waiting to
        // come back has no tunnel to close, and stops first: it would
        // register again right after the hub took the participant out.
        return harness === undefined && online
          ? {
              reason: "stopped" as const,
              leave: yield* leaveRoom(stay.hubUrl, identity, runtimeId),
              ended: Exit.void,
            }
          : {
              reason: "stopped" as const,
              leave: "tell" as const,
              ended: Exit.void,
            };
      })
    );
    const leave =
      ending.leave === "tell"
        ? yield* leaveRoom(stay.hubUrl, identity, runtimeId)
        : ending.leave;
    yield* output.event(
      "left",
      { ...identity, reason: ending.reason, removed: leave === "removed" },
      leftText(identity, ending.reason, leave)
    );
    // A stay that ended by itself is a failure, with the name of why.
    yield* ending.ended;
  });
