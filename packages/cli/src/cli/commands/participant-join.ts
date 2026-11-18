/**
 * `gambi participant join`: hosts a participant runtime in this process until
 * it is told to stop. The participant shares a model endpoint of this
 * machine with a room.
 *
 * The command writes one event per step of the participant's life:
 * `registered`, `tunnel_connected`, `reconnecting`, `leaving`, `left`.
 */
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { probeEndpoint } from "@gambi/core/participant/endpoint-capabilities";
import { HarnessCallsNotSupported } from "@gambi/core/participant/harness-not-supported";
import {
  type ParticipantAuthHeaders,
  providerInference,
} from "@gambi/core/participant/inference";
import {
  type ParticipantLifecycleEvent,
  type ParticipantProfile,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import {
  Config,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Redacted,
  Schema,
} from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { participantIdFlag, roomFlag, runtimeConfigFlag } from "../flags.ts";
import { HubUnreachable, hubFlag, withHub } from "../hub-client.ts";
import { detectMachineSpecs } from "../machine-specs.ts";
import { Output } from "../output.ts";
import { Termination } from "../termination.ts";
import { CLI_VERSION } from "../version.ts";

const DEFAULT_ENDPOINT = "http://localhost:11434";

/** What a preview shows in the place of a secret. */
const REDACTED = "[redacted]";

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

/** Nothing at the endpoint answered like a provider: no model list, no inference API. */
export class EndpointUnreachable extends Schema.TaggedError<EndpointUnreachable>()(
  "EndpointUnreachable",
  { endpoint: Schema.String }
) {
  override get message(): string {
    return `No provider answered at ${this.endpoint}.`;
  }

  get hint(): string {
    return "Check that the provider is running on this machine and that --endpoint points at it.";
  }
}

/** The provider answered, and the model to share is not one it lists. */
export class ModelNotOnEndpoint extends Schema.TaggedError<ModelNotOnEndpoint>()(
  "ModelNotOnEndpoint",
  {
    endpoint: Schema.String,
    model: Schema.String,
    available: Schema.Array(Schema.String),
  }
) {
  override get message(): string {
    return `The endpoint ${this.endpoint} does not list the model '${this.model}'.`;
  }

  get hint(): string {
    return this.available.length === 0
      ? "The endpoint lists no model at all."
      : `Models it lists: ${this.available.join(", ")}.`;
  }
}

/**
 * `--header Name=Value`, repeatable: a `ParticipantAuthHeader`. It is added
 * to every request this machine makes to its provider, and never leaves it.
 */
const headerFlag = Flag.KeyValuePair("header").pipe(
  Flag.withMetavar("Name=Value"),
  Flag.withDescription(
    "Header for the requests to the provider, such as Authorization. Repeatable. It stays on this machine"
  ),
  Flag.withDefault({})
);

/** `--header-env Name=VARIABLE`, repeatable: the same, with the value read from the environment. */
const headerEnvFlag = Flag.KeyValuePair("header-env").pipe(
  Flag.withMetavar("Name=VARIABLE"),
  Flag.withDescription(
    "Header for the requests to the provider, with its value read from an environment variable. Repeatable"
  ),
  Flag.mapEffect(
    Effect.fnUntraced(function* (pairs) {
      const headers: Record<string, string> = {};
      for (const [name, variable] of Object.entries(pairs)) {
        headers[name] = yield* Config.NonEmptyString(variable).pipe(
          Effect.mapError(
            () =>
              new CliError.InvalidValue({
                option: "header-env",
                value: `${name}=${variable}`,
                expected: `the environment variable ${variable} to be set`,
                kind: "flag",
              })
          )
        );
      }
      return headers;
    })
  ),
  Flag.withDefault({})
);

/** The last line a person reads: how the stay in the room ended. */
const leftText = (
  roomCode: string,
  stay: { readonly reason: string; readonly removed: boolean }
): string => {
  if (stay.reason !== "stopped") {
    return `No longer in room ${roomCode} (${stay.reason}).`;
  }
  return stay.removed
    ? `Left room ${roomCode}.`
    : `Stopped. The hub did not confirm: it takes the participant out of room ${roomCode} by itself in a minute.`;
};

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
    nickname: Flag.String("nickname").pipe(
      Flag.withAlias("n"),
      Flag.withDescription(
        "Name the room shows for the participant. Default: <model>@<participant id>"
      ),
      Flag.optional
    ),
    password: Flag.Redacted("password").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("Password of the room, when it has one"),
      Flag.optional
    ),
    config: runtimeConfigFlag(
      "Runtime config of the participant (temperature, instructions, ...) as JSON: a file, or - for stdin"
    ),
    headers: headerFlag,
    headersFromEnvironment: headerEnvFlag,
    noSpecs: Flag.Boolean("no-specs").pipe(
      Flag.withoutNegation,
      Flag.withDescription("Do not tell the room what this machine has"),
      Flag.withDefault(false)
    ),
    hub: hubFlag,
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print what would be registered, after probing the endpoint, without joining"
      ),
      Flag.withDefault(false)
    ),
  },
  Effect.fn("participant.join")(
    function* (input) {
      const output = yield* Output;
      const termination = yield* Termination;
      const identity: Identity = {
        roomCode: input.room,
        participantId: input.participantId,
      };
      const lifecycle = yield* Queue.unbounded<ParticipantLifecycleEvent>();
      // `ParticipantAuthHeaders`: they go to the probe and to the handler that
      // calls the provider. The runtime, and so the hub, never sees them.
      const authHeaders: ParticipantAuthHeaders = {
        ...input.headers,
        ...input.headersFromEnvironment,
      };
      const provider = { endpoint: input.endpoint, authHeaders };

      // What the provider lists and which inference APIs it answers, found on
      // this machine. The hub never probes a provider.
      const probe = yield* probeEndpoint(provider);
      if (!probe.reachable) {
        return yield* new EndpointUnreachable({ endpoint: input.endpoint });
      }
      if (!probe.models.includes(input.model)) {
        return yield* new ModelNotOnEndpoint({
          endpoint: input.endpoint,
          model: input.model,
          available: probe.models,
        });
      }

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

      const specs = input.noSpecs ? undefined : yield* detectMachineSpecs();

      // A field that is present has a value: the registration refuses
      // `undefined`.
      const profile: ParticipantProfile = {
        nickname: Option.getOrElse(
          input.nickname,
          () => `${input.model}@${input.participantId.slice(0, 6)}`
        ),
        model: input.model,
        endpoint: input.endpoint,
        capabilities: probe.capabilities,
        ...(specs === undefined ? {} : { specs }),
        ...Option.match(input.config, {
          onNone: () => ({}),
          onSome: (config) => ({ config }),
        }),
      };

      if (input.dryRun) {
        const preview = {
          hubUrl: input.hub,
          ...identity,
          ...(Option.isSome(input.password) ? { password: REDACTED } : {}),
          ...(Object.keys(authHeaders).length === 0
            ? {}
            : {
                authHeaders: Object.fromEntries(
                  Object.keys(authHeaders).map((name) => [name, REDACTED])
                ),
              }),
          profile,
        };
        return yield* output.result(
          preview,
          () =>
            `Would join room ${identity.roomCode} on ${input.hub} as ${identity.participantId}.\n${JSON.stringify(preview, null, 2)}`
        );
      }

      const Host = ParticipantRuntime.layer({
        hubUrl: input.hub,
        ...identity,
        ...Option.match(input.password, {
          onNone: () => ({}),
          onSome: (password) => ({ password: Redacted.value(password) }),
        }),
        version: CLI_VERSION,
        profile,
        onLifecycle: (event) => Queue.offer(lifecycle, event),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            TunnelDiagnostics,
            HarnessCallsNotSupported,
            providerInference(provider)
          )
        )
      );

      // The scope holds the participant in the room: it closes, and the
      // tunnel with it, before `left` is written.
      const stay = yield* Effect.scoped(
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
          const ending = yield* Effect.raceFirst(
            Effect.map(termination.signal, (signal) => ({ signal })),
            Effect.map(untilTheRuntimeLeaves, (left) => ({ left }))
          );
          if ("left" in ending) {
            // The runtime ended by itself: the hub refused it on its way back,
            // or gave its place to another runtime. The hub is told nothing:
            // the participant with this id in the room, if there is one, is
            // not this runtime any more.
            return {
              reason: ending.left.reason,
              removed: false,
              ended: yield* Effect.exit(runtime.ended),
            };
          }
          yield* output.event(
            "leaving",
            { ...identity, signal: ending.signal },
            `Leaving room ${identity.roomCode} (${ending.signal})...`
          );
          // The hub first, so the room hears one thing: the participant left.
          // Closing the tunnel first would show it offline in between.
          return {
            reason: "stopped" as const,
            removed: yield* leaveRoom(input.hub, identity),
            ended: Exit.void,
          };
        })
      );
      yield* output.event(
        "left",
        { ...identity, reason: stay.reason, removed: stay.removed },
        leftText(identity.roomCode, stay)
      );
      // A runtime that ended by itself is a failure, with the name of why.
      yield* stay.ended;
    },
    // The runtime names the same failure without saying what to do.
    Effect.catchTag("HubUnreachable", ({ cause, hubUrl }) =>
      Effect.fail(new HubUnreachable({ hubUrl, cause }))
    )
  )
).pipe(
  Command.withDescription(
    "Join a room with a model endpoint of this machine, until Ctrl+C"
  )
);

export { join };
