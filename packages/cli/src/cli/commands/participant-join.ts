/**
 * `gambi participant join`: hosts a participant runtime in this process until
 * it is told to stop. The participant shares a model endpoint of this
 * machine with a room.
 *
 * The command writes one event per step of the participant's life:
 * `registered`, `tunnel_connected`, `reconnecting`, `leaving`, `left`.
 */
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { HarnessCallsNotSupported } from "@gambi/core/participant/harness-not-supported";
import { providerInference } from "@gambi/core/participant/inference";
import {
  type ParticipantLifecycleEvent,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import { Context, Duration, Effect, Layer, Queue } from "effect";
import { Command, Flag } from "effect/cli";
import { participantIdFlag, roomFlag } from "../flags.ts";
import { HubUnreachable, hubFlag, withHub } from "../hub-client.ts";
import { Output } from "../output.ts";
import { Termination } from "../termination.ts";
import { CLI_VERSION } from "../version.ts";

const DEFAULT_ENDPOINT = "http://localhost:11434";

/** How long leaving waits for the hub to confirm before it gives up on telling it. */
const LEAVE_TIMEOUT = Duration.seconds(3);

interface Identity {
  readonly participantId: string;
  readonly roomCode: string;
}

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

const join = Command.make(
  "join",
  {
    room: roomFlag,
    participantId: participantIdFlag,
    model: Flag.String("model").pipe(
      Flag.withAlias("m"),
      Flag.withDescription("Model of the endpoint to share")
    ),
    endpoint: Flag.String("endpoint").pipe(
      Flag.withAlias("e"),
      Flag.withMetavar("url"),
      Flag.withDescription(
        "Where the provider listens on this machine. The hub never calls it"
      ),
      Flag.withDefault(DEFAULT_ENDPOINT)
    ),
    noSpecs: Flag.Boolean("no-specs").pipe(
      Flag.withoutNegation,
      Flag.withDescription("Do not tell the room what this machine has"),
      Flag.withDefault(false)
    ),
    hub: hubFlag,
  },
  Effect.fn("participant.join")(function* (input) {
    const output = yield* Output;
    const termination = yield* Termination;
    const identity: Identity = {
      roomCode: input.room,
      participantId: input.participantId,
    };
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

    const Host = ParticipantRuntime.layer({
      hubUrl: input.hub,
      ...identity,
      version: CLI_VERSION,
      profile: {
        nickname: `${input.model}@${input.participantId.slice(0, 6)}`,
        model: input.model,
        endpoint: input.endpoint,
      },
      onLifecycle: (event) => Queue.offer(lifecycle, event),
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          TunnelDiagnostics,
          HarnessCallsNotSupported,
          providerInference({ endpoint: input.endpoint })
        )
      )
    );

    // The scope holds the participant in the room: it closes, and the
    // tunnel with it, before `left` is written.
    const removed = yield* Effect.scoped(
      Effect.gen(function* () {
        const runtime = Context.get(
          yield* Layer.build(Host),
          ParticipantRuntime
        );
        yield* output.event(
          "registered",
          { roomCode: identity.roomCode, participant: runtime.participant },
          `Registered ${runtime.participant.nickname} (${identity.participantId}) in room ${identity.roomCode}.`
        );
        const signal = yield* Effect.raceFirst(
          termination.signal,
          untilTheRuntimeLeaves.pipe(Effect.andThen(Effect.never))
        );
        yield* output.event(
          "leaving",
          { ...identity, signal },
          `Leaving room ${identity.roomCode} (${signal})...`
        );
        // The hub first, so the room hears one thing: the participant left.
        // Closing the tunnel first would show it offline in between.
        return yield* leaveRoom(input.hub, identity);
      })
    ).pipe(
      // The runtime names the same failure without saying what to do.
      Effect.catchTag("HubUnreachable", ({ cause, hubUrl }) =>
        Effect.fail(new HubUnreachable({ hubUrl, cause }))
      )
    );
    yield* output.event(
      "left",
      { ...identity, reason: "stopped", removed },
      removed
        ? `Left room ${identity.roomCode}.`
        : `Stopped. The hub did not confirm: it takes the participant out of room ${identity.roomCode} by itself in a minute.`
    );
  })
).pipe(
  Command.withDescription(
    "Join a room with a model endpoint of this machine, until Ctrl+C"
  )
);

export { join };
