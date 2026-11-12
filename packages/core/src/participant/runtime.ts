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
 * 3. `ParticipantRuntime.layer`: one registration and one tunnel, for as long
 *    as the layer lives.
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
  Context,
  Deferred,
  Duration,
  Effect,
  type Exit,
  Layer,
  Schema,
  type Scope,
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

export interface ParticipantRuntimeOptions {
  /** Where the hub is, for example `http://192.168.0.10:3000`. */
  readonly hubUrl: string;
  /** The stable id of this participant. Reuse it to come back as the same one. */
  readonly participantId: string;
  /** The room password, when the room has one. */
  readonly password?: string | undefined;
  readonly profile: ParticipantProfile;
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
      })
    );
});

/** An open tunnel, as the participant runtime sees it. */
export interface OpenTunnel {
  /** Completes when the tunnel drops, for any reason. */
  readonly dropped: Effect.Effect<void>;
}

/**
 * Dials the tunnel with a bootstrap token and serves the tunnel calls on it,
 * until the scope closes or the tunnel drops. It returns once the hub has
 * welcomed the tunnel, which is when the participant is `online`.
 *
 * It dials once. A token is single-use, so coming back after a drop means
 * `register` again and then `openTunnel` again.
 */
export const openTunnel = Effect.fn("ParticipantRuntime.openTunnel")(function* (
  options: ParticipantRuntimeOptions,
  token: string
): Effect.fn.Return<
  OpenTunnel,
  TunnelOpenFailed,
  Socket.WebSocketConstructor | TunnelHandlers | Scope.Scope
> {
  const welcomed = yield* Deferred.make<void>();
  const ended = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
  const dialed = yield* Socket.makeWebSocket(
    tunnelUrl(options.hubUrl, options.roomCode, options.participantId, token)
  );

  // `layerProtocolSocketServer` wants a server that accepts sockets. This
  // one "accepts" the single socket the participant dialed. Whoever needs
  // to watch the frames of the tunnel wraps `dialed` here.
  const DialedSocketServer = Layer.succeed(
    SocketServer.SocketServer,
    SocketServer.SocketServer.of({
      address: NetAddress.unixPathAddress("gambi-tunnel"),
      run: (handler) =>
        handler(dialed).pipe(
          Effect.exit,
          Effect.flatMap((exit) => Deferred.succeed(ended, exit)),
          Effect.andThen(Effect.never)
        ),
    })
  );
  const WelcomeHandler = TunnelRpcs.toLayerHandler("Welcome", () =>
    Effect.asVoid(Deferred.succeed(welcomed, undefined))
  );

  yield* Layer.build(
    RpcServer.layer(TunnelRpcs).pipe(
      Layer.provide(WelcomeHandler),
      Layer.provide(RpcServer.layerProtocolSocketServer),
      Layer.provide(DialedSocketServer),
      Layer.provide(RpcSerialization.layerJson)
    )
  );

  const failed = (cause: unknown) =>
    new TunnelOpenFailed({
      hubUrl: options.hubUrl,
      roomCode: options.roomCode,
      participantId: options.participantId,
      cause,
    });
  yield* Effect.raceFirst(
    Deferred.await(welcomed),
    Deferred.await(ended).pipe(
      Effect.flatMap((exit) => Effect.fail(failed(exit)))
    )
  ).pipe(
    Effect.timeoutOrElse({
      duration: options.tunnelOpenTimeout ?? Duration.seconds(10),
      orElse: () =>
        Effect.fail(failed(new Error("The hub did not welcome the tunnel."))),
    })
  );
  yield* Effect.logInfo("tunnel open").pipe(
    Effect.annotateLogs({
      roomCode: options.roomCode,
      participantId: options.participantId,
    })
  );
  return { dropped: Effect.asVoid(Deferred.await(ended)) };
});

export class ParticipantRuntime extends Context.Service<
  ParticipantRuntime,
  {
    /** The participant as the hub registered it. */
    readonly participant: ParticipantSummary;
    /** Completes when the tunnel drops. The runtime does not redial. */
    readonly tunnelDropped: Effect.Effect<void>;
  }
>()("gambi/core/ParticipantRuntime") {
  /**
   * A participant in a room: registered, with its tunnel open, serving the
   * tunnel calls with the handlers of the environment. Building the layer
   * returns when the participant is `online`; releasing it closes the tunnel.
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
        const registered = yield* register(options);
        const tunnel = yield* openTunnel(options, registered.tunnel.token);
        return ParticipantRuntime.of({
          participant: registered.participant,
          tunnelDropped: tunnel.dropped,
        });
      })
    );
}
