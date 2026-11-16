/**
 * The participant runtime, on Effect (ADR-0007). It lives beside the current
 * `../participant-session.ts` until the migration replaces it.
 *
 * It does three things, each a function of this file:
 *
 * 1. `register`: tells the hub about the participant, over HTTP, and gets the
 *    bootstrap token of the tunnel.
 * 2. `openTunnel`: dials the hub's WebSocket and *serves* the tunnel calls on
 *    it. The participant always dials; the hub never connects back.
 * 3. `ParticipantRuntime.layer`: the participant in the room for as long as
 *    the layer lives. It joins with one registration and one tunnel, and
 *    when the tunnel drops it comes back by itself: it registers again, for
 *    a new bootstrap token, and dials again, as the same participant.
 *
 * The handlers of the tunnel calls come from the environment: whoever hosts
 * the runtime decides what a call does on this machine. That is also where
 * `ParticipantAuthHeaders` live. The runtime never sees them, so nothing it
 * sends to the hub can carry them.
 */
import {
  GAMBI_VERSION,
  type InternalError,
  type InvalidPassword,
  type InvalidRequest,
  makeManagementClient,
  type ParticipantRegistered,
  type ParticipantSummary,
  type RegisterParticipant,
  type RoomNotFound,
  TunnelRpcs,
  tunnelUrl,
  type VersionMismatch,
} from "@gambi/protocol";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
  Scope,
} from "effect";
import type { HttpClient } from "effect/http";
import { NetAddress } from "effect/net";
import {
  type Rpc,
  type RpcGroup,
  RpcSerialization,
  RpcServer,
} from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";

/** What the participant tells the room about itself. */
export type ParticipantProfile = Omit<
  RegisterParticipant,
  "authHeaders" | "password" | "version"
>;

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

/**
 * What happens to a participant runtime over its life, as its host is told
 * (`ParticipantRuntimeOptions.onLifecycle`). Plain JSON, so a host can print
 * an event or hand it to another process as it is.
 *
 * - `connected`: the tunnel is open and the participant is `online`.
 *   `attempt` is `0` for the join and, after a drop, the number of the
 *   attempt that brought it back.
 * - `reconnecting`: the runtime is not connected and tries again in
 *   `delayMillis`. One event per attempt, counted from `1` after each drop.
 * - `left`: the runtime ended and tries no more. `stopped`: its host stopped
 *   it. `refused`: the hub refused it when it tried to come back, and
 *   `error` says why. `tunnelDropped`: the tunnel dropped and the runtime was
 *   started with `reconnect: false`.
 *
 * A runtime that never joined reports nothing: the join itself fails.
 */
export type ParticipantLifecycleEvent =
  | {
      readonly type: "connected";
      readonly roomCode: string;
      readonly participantId: string;
      readonly attempt: number;
      /** The Gambi version of the hub. */
      readonly hubVersion: string;
    }
  | {
      readonly type: "reconnecting";
      readonly roomCode: string;
      readonly participantId: string;
      readonly attempt: number;
      readonly delayMillis: number;
      readonly reason: ReconnectReason;
    }
  | {
      readonly type: "left";
      readonly roomCode: string;
      readonly participantId: string;
      readonly reason: "stopped" | "refused" | "tunnelDropped";
      /** The typed error behind `refused`: its name and its message. */
      readonly error?: { readonly name: string; readonly message: string };
    };

/** The wait before the first attempt to come back; it doubles after each attempt that fails. */
export const RECONNECT_FIRST_DELAY = Duration.seconds(1);
/** The longest wait between two attempts to come back. */
export const RECONNECT_MAX_DELAY = Duration.seconds(30);
/**
 * How many ping intervals of the hub a tunnel may stay silent before the
 * runtime takes the hub for frozen and drops the tunnel. The hub says its
 * interval in `Welcome`; with the default of 5 s that is 15 s.
 */
export const HUB_SILENCE_PING_INTERVALS = 3;

export interface ParticipantRuntimeOptions {
  /** Where the hub is, for example `http://192.168.0.10:3000`. */
  readonly hubUrl: string;
  /**
   * Called with each lifecycle event, in order, from the join on. The runtime
   * waits for it, so keep it quick.
   */
  readonly onLifecycle?:
    | ((event: ParticipantLifecycleEvent) => Effect.Effect<void>)
    | undefined;
  /** The stable id of this participant. Reuse it to come back as the same one. */
  readonly participantId: string;
  /** The room password, when the room has one. */
  readonly password?: string | undefined;
  readonly profile: ParticipantProfile;
  /**
   * Whether the runtime comes back by itself when its tunnel drops. Default
   * `true`. With `false` it ends on the first drop.
   */
  readonly reconnect?: boolean | undefined;
  /**
   * How long to wait for the hub to answer a registration. Default 10
   * seconds. A hub that froze accepts the connection and never answers.
   */
  readonly registrationTimeout?: Duration.Input | undefined;
  readonly roomCode: string;
  /**
   * How long to wait for the hub to accept the tunnel, from the dial to its
   * `Welcome`. Default 10 seconds.
   */
  readonly tunnelOpenTimeout?: Duration.Input | undefined;
  /**
   * The Gambi version this runtime registers with. The hub refuses another
   * minor. Default: `GAMBI_VERSION`, the version of this build.
   */
  readonly version?: string | undefined;
}

/**
 * The handlers of the tunnel calls that the host of the runtime provides:
 * every call of `TunnelRpcs` but `Welcome`, which the runtime answers itself.
 * Build them with `TunnelRpcs.toLayerHandler(tag, handler)`.
 */
export type TunnelHandlers = Exclude<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof TunnelRpcs>>,
  Rpc.Handler<"Welcome">
>;

/** The hub did not answer the registration: it is unreachable, or it is not a Gambi hub. */
export class HubUnreachable extends Schema.TaggedError<HubUnreachable>()(
  "HubUnreachable",
  { hubUrl: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `No Gambi hub answered at ${this.hubUrl}.`;
  }
}

/** The tunnel did not open: the dial failed, or the hub did not accept it in time. */
export class TunnelOpenFailed extends Schema.TaggedError<TunnelOpenFailed>()(
  "TunnelOpenFailed",
  {
    hubUrl: Schema.String,
    roomCode: Schema.String,
    participantId: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message(): string {
    return `Participant '${this.participantId}' could not open its tunnel to the hub at ${this.hubUrl}.`;
  }
}

/** Why a registration was refused, as the hub said it, or `HubUnreachable`. */
export type RegistrationError =
  | RoomNotFound
  | InvalidPassword
  | VersionMismatch
  | InvalidRequest
  | InternalError
  | HubUnreachable;

/**
 * Registers the participant in the room. Registering again with the same
 * `participantId` updates it, and every registration answers with a new
 * bootstrap token: that is how a runtime comes back after its tunnel drops.
 */
export const register = Effect.fn("ParticipantRuntime.register")(function* (
  options: ParticipantRuntimeOptions
): Effect.fn.Return<
  ParticipantRegistered,
  RegistrationError,
  HttpClient.HttpClient
> {
  const client = yield* makeManagementClient(options.hubUrl);
  return yield* client.participants
    .register({
      params: { code: options.roomCode, id: options.participantId },
      payload: {
        ...options.profile,
        ...(options.password === undefined
          ? {}
          : { password: options.password }),
        version: options.version ?? GAMBI_VERSION,
      },
    })
    .pipe(
      Effect.catchTags({
        HttpClientError: (cause) =>
          Effect.fail(new HubUnreachable({ hubUrl: options.hubUrl, cause })),
        SchemaError: (cause) =>
          Effect.fail(new HubUnreachable({ hubUrl: options.hubUrl, cause })),
      }),
      Effect.timeoutOrElse({
        duration: options.registrationTimeout ?? Duration.seconds(10),
        orElse: () =>
          Effect.fail(
            new HubUnreachable({
              hubUrl: options.hubUrl,
              cause: new Error("The hub did not answer the registration."),
            })
          ),
      })
    );
});

/** An open tunnel, as the participant runtime sees it. */
export interface OpenTunnel {
  /**
   * Completes when the tunnel drops, and says why: `tunnelDropped` when it
   * was closed or lost, `hubSilent` when the runtime dropped it because the
   * hub went silent.
   */
  readonly dropped: Effect.Effect<"tunnelDropped" | "hubSilent">;
  /** The Gambi version of the hub, as it said in its `Welcome`. */
  readonly hubVersion: string;
}

/**
 * Dials the tunnel with a bootstrap token and serves the tunnel calls on it,
 * until the scope closes or the tunnel drops. It returns once the hub has
 * welcomed the tunnel, which is when the participant is `online`.
 *
 * It dials once. A token is single-use, so coming back after a drop means
 * `register` again and then `openTunnel` again.
 *
 * It also watches the hub. Only the hub pings, so a hub that froze would
 * leave the tunnel looking open forever: when no frame arrives for
 * `HUB_SILENCE_PING_INTERVALS` ping intervals, the runtime drops the tunnel
 * itself.
 */
export const openTunnel = Effect.fn("ParticipantRuntime.openTunnel")(function* (
  options: ParticipantRuntimeOptions,
  token: string
): Effect.fn.Return<
  OpenTunnel,
  TunnelOpenFailed,
  Socket.WebSocketConstructor | TunnelHandlers | Scope.Scope
> {
  const welcomed = yield* Deferred.make<{
    readonly hubVersion: string;
    readonly pingIntervalMillis: number;
  }>();
  const closed = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
  const dropped = yield* Deferred.make<"tunnelDropped" | "hubSilent">();
  const clock = yield* Clock.Clock;
  // The socket and the server on it live here, so that the watchdog can
  // close them before the caller's scope ends.
  const tunnelScope = yield* Scope.fork(yield* Effect.scope);
  const dialed = yield* Socket.makeWebSocket(
    tunnelUrl(options.hubUrl, options.roomCode, options.participantId, token)
  );
  // Every frame of the hub passes here, its pings included: this is where
  // the runtime learns when it last heard from the hub.
  let lastFrameAt = clock.currentTimeMillisUnsafe();
  const watched = Socket.make({
    reader: Effect.map(dialed.reader, (reader) => ({
      ...reader,
      pull: Effect.tap(reader.pull, () =>
        Effect.sync(() => {
          lastFrameAt = clock.currentTimeMillisUnsafe();
        })
      ),
    })),
    writer: dialed.writer,
  });

  // `layerProtocolSocketServer` wants a server that accepts sockets. This
  // one "accepts" the single socket the participant dialed.
  const DialedSocketServer = Layer.succeed(
    SocketServer.SocketServer,
    SocketServer.SocketServer.of({
      address: NetAddress.unixPathAddress("gambi-tunnel"),
      run: (handler) =>
        handler(watched).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Deferred.succeed(closed, exit).pipe(
              Effect.andThen(Deferred.succeed(dropped, "tunnelDropped"))
            )
          ),
          Effect.andThen(Effect.never)
        ),
    })
  );
  const WelcomeHandler = TunnelRpcs.toLayerHandler("Welcome", (welcome) =>
    Effect.asVoid(Deferred.succeed(welcomed, welcome))
  );

  yield* Layer.buildWithScope(
    RpcServer.layer(TunnelRpcs).pipe(
      Layer.provide(WelcomeHandler),
      Layer.provide(RpcServer.layerProtocolSocketServer),
      Layer.provide(DialedSocketServer),
      Layer.provide(RpcSerialization.layerJson)
    ),
    tunnelScope
  );

  const failed = (cause: unknown) =>
    new TunnelOpenFailed({
      hubUrl: options.hubUrl,
      roomCode: options.roomCode,
      participantId: options.participantId,
      cause,
    });
  const welcome = yield* Effect.raceFirst(
    Deferred.await(welcomed),
    Deferred.await(closed).pipe(
      Effect.flatMap((exit) => Effect.fail(failed(exit)))
    )
  ).pipe(
    Effect.timeoutOrElse({
      duration: options.tunnelOpenTimeout ?? Duration.seconds(10),
      orElse: () =>
        Effect.fail(failed(new Error("The hub did not welcome the tunnel."))),
    }),
    Effect.onError(() => Scope.close(tunnelScope, Exit.void))
  );
  const annotations = {
    roomCode: options.roomCode,
    participantId: options.participantId,
  };
  yield* Effect.logInfo("tunnel open").pipe(Effect.annotateLogs(annotations));

  // The watchdog: sleeps until the hub has been silent for too long, or
  // until the tunnel drops by itself.
  const silenceLimit = welcome.pingIntervalMillis * HUB_SILENCE_PING_INTERVALS;
  const untilSilent = Effect.gen(function* () {
    let silentFor = clock.currentTimeMillisUnsafe() - lastFrameAt;
    while (silentFor < silenceLimit) {
      yield* Effect.sleep(silenceLimit - silentFor);
      silentFor = clock.currentTimeMillisUnsafe() - lastFrameAt;
    }
  });
  yield* Effect.raceFirst(untilSilent, Deferred.await(dropped)).pipe(
    Effect.andThen(Deferred.succeed(dropped, "hubSilent")),
    Effect.flatMap((silent) =>
      silent
        ? Effect.logWarning("hub silent, dropping the tunnel").pipe(
            Effect.annotateLogs({ ...annotations, silenceLimit }),
            Effect.andThen(Scope.close(tunnelScope, Exit.void))
          )
        : Effect.void
    ),
    Effect.forkScoped
  );
  return {
    dropped: Deferred.await(dropped),
    hubVersion: welcome.hubVersion,
  };
});

/** Whether trying again can help: the hub's refusals are final, the rest is not. */
const reasonToRetry = (
  error: RegistrationError | TunnelOpenFailed
): ReconnectReason | undefined => {
  switch (error._tag) {
    case "HubUnreachable":
      return "hubUnreachable";
    case "TunnelOpenFailed":
      return "tunnelOpenFailed";
    case "InternalError":
      return "hubError";
    default:
      return;
  }
};

/** How an exit of the runtime reads as a `left` event. A defect is not one. */
const howItLeft = (
  exit: Exit.Exit<void, RegistrationError | TunnelOpenFailed>
):
  | Pick<
      Extract<ParticipantLifecycleEvent, { type: "left" }>,
      "reason" | "error"
    >
  | undefined => {
  if (Exit.isSuccess(exit)) {
    return { reason: "tunnelDropped" };
  }
  if (Cause.hasInterruptsOnly(exit.cause)) {
    return { reason: "stopped" };
  }
  const error = Cause.findErrorOption(exit.cause);
  return Option.isSome(error)
    ? {
        reason: "refused",
        error: { name: error.value._tag, message: error.value.message },
      }
    : undefined;
};

// 1 s, 2 s, 4 s... up to 30 s.
const reconnectBackoff = Schedule.min([
  Schedule.exponential(RECONNECT_FIRST_DELAY),
  Schedule.spaced(RECONNECT_MAX_DELAY),
]);

export class ParticipantRuntime extends Context.Service<
  ParticipantRuntime,
  {
    /**
     * Completes when the runtime has ended and tries no more: with the hub's
     * refusal as its error when the hub refused it on its way back, and
     * without one when it was stopped or, with `reconnect: false`, when its
     * tunnel dropped.
     */
    readonly ended: Effect.Effect<void, RegistrationError | TunnelOpenFailed>;
    /** The participant as the hub registered it when it joined. */
    readonly participant: ParticipantSummary;
    /**
     * Completes when the tunnel that is open now drops; at once when none is
     * open. The runtime dials again unless it was started with
     * `reconnect: false`.
     */
    readonly tunnelDropped: Effect.Effect<void>;
  }
>()("gambi/core/ParticipantRuntime") {
  /**
   * A participant in a room: registered, with its tunnel open, serving the
   * tunnel calls with the handlers of the environment. Building the layer
   * returns when the participant is `online`, and fails when the join fails;
   * releasing it closes the tunnel and stops any attempt to come back.
   *
   * After the join, a tunnel that drops is opened again, waiting longer after
   * each attempt that fails (`RECONNECT_FIRST_DELAY`, doubling up to
   * `RECONNECT_MAX_DELAY`). Each attempt registers again, because a bootstrap
   * token opens one tunnel, and keeps the `participantId`. A refusal of the
   * hub (another version, a room that is gone, a wrong password) ends the
   * runtime instead: see `ended`.
   *
   * The environment provides the platform (`HttpClient`, a
   * `Socket.WebSocketConstructor`) and the handlers (`TunnelHandlers`).
   */
  static readonly layer = (
    options: ParticipantRuntimeOptions
  ): Layer.Layer<
    ParticipantRuntime,
    RegistrationError | TunnelOpenFailed,
    HttpClient.HttpClient | Socket.WebSocketConstructor | TunnelHandlers
  > =>
    Layer.effect(
      ParticipantRuntime,
      Effect.gen(function* () {
        type Failure = RegistrationError | TunnelOpenFailed;
        const joined = yield* Deferred.make<ParticipantSummary, Failure>();
        const ended = yield* Deferred.make<void, Failure>();
        const identity = {
          roomCode: options.roomCode,
          participantId: options.participantId,
        };
        const tell = (event: ParticipantLifecycleEvent) =>
          Effect.logInfo(`participant ${event.type}`).pipe(
            Effect.annotateLogs(event),
            Effect.andThen(options.onLifecycle?.(event) ?? Effect.void)
          );
        let tunnelDropped: Effect.Effect<unknown> = Effect.void;
        let connectedOnce = false;

        // One registration and one tunnel. It fails when the tunnel does not
        // open, and returns when a tunnel that did open drops.
        const connection = (attempt: number) =>
          Effect.gen(function* () {
            const registered = yield* register(options);
            const tunnel = yield* openTunnel(options, registered.tunnel.token);
            tunnelDropped = tunnel.dropped;
            // The host hears `connected` before the join returns, and from
            // then on it is owed a `left`.
            connectedOnce = true;
            yield* tell({
              type: "connected",
              ...identity,
              attempt,
              hubVersion: tunnel.hubVersion,
            });
            yield* Deferred.succeed(joined, registered.participant);
            return yield* tunnel.dropped;
          }).pipe(Effect.scoped);

        // After a drop: tries until a tunnel opens, waiting longer after each
        // attempt that fails, and returns when that tunnel drops in its turn.
        // It fails with what no further attempt can fix.
        const comeBack = Effect.fnUntraced(function* (
          dropped: ReconnectReason
        ) {
          const nextDelay = yield* Schedule.toStep(reconnectBackoff);
          let reason = dropped;
          for (let attempt = 1; ; attempt++) {
            const [, delay] = yield* Effect.orDie(
              nextDelay(yield* Clock.currentTimeMillis, undefined)
            );
            yield* tell({
              type: "reconnecting",
              ...identity,
              attempt,
              delayMillis: Duration.toMillis(delay),
              reason,
            });
            yield* Effect.sleep(delay);
            const outcome = yield* Effect.result(connection(attempt));
            if (Result.isSuccess(outcome)) {
              return outcome.success;
            }
            const retry = reasonToRetry(outcome.failure);
            if (retry === undefined) {
              return yield* Effect.fail(outcome.failure);
            }
            reason = retry;
          }
        });

        // A join that fails is not retried: the host hears it at once.
        const run = Effect.gen(function* () {
          let dropped = yield* connection(0);
          while (options.reconnect !== false) {
            dropped = yield* comeBack(dropped);
          }
        });

        // How the runtime ended, told to whoever waits for it: the build of
        // the layer when it never joined, the host afterwards.
        const conclude = (exit: Exit.Exit<void, Failure>) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              // Does nothing when the join already succeeded.
              yield* Deferred.failCause(joined, exit.cause);
            }
            const left = connectedOnce ? howItLeft(exit) : undefined;
            if (left !== undefined) {
              yield* tell({ type: "left", ...identity, ...left });
            }
            // Being stopped is not a failure of the runtime.
            yield* Deferred.done(
              ended,
              left?.reason === "stopped" ? Exit.void : exit
            );
          });

        yield* run.pipe(Effect.onExit(conclude), Effect.forkScoped);

        const participant = yield* Deferred.await(joined);
        return ParticipantRuntime.of({
          ended: Deferred.await(ended),
          participant,
          tunnelDropped: Effect.suspend(() => Effect.asVoid(tunnelDropped)),
        });
      })
    );
}
