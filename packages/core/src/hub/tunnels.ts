/**
 * The tunnels of one hub: the bootstrap tokens that authenticate a tunnel's
 * WebSocket upgrade, and the open tunnels themselves.
 *
 * A tunnel is `effect/rpc` over the WebSocket a participant dialed, with the
 * roles inverted: the hub accepted the socket and is the RPC *client*
 * (ADR-0007). `serve` runs one tunnel; `client` hands the calls of an open
 * one to whoever dispatches (`TunnelRpcs` in `@gambi/protocol`).
 *
 * The status of a participant derives from here and from nowhere else: a
 * tunnel that opens reports `tunnelOpened`, one that drops `tunnelDropped`.
 *
 * Three things in `serve` are load-bearing; the measurements are in
 * `docs/research/effect-v4-foundation.md`:
 *
 * 1. `retryPolicy: Schedule.recurs(0)`. The default policy redials forever,
 *    and an accepted socket cannot be redialed.
 * 2. The tunnel ends when the protocol reports `ClientProtocolError`, after
 *    the calls in flight have received it. Ending it from a connection hook
 *    would interrupt those calls instead of failing them with a typed error.
 *    For the same reason, a tunnel the hub closes hands that error to its
 *    calls before it closes the socket.
 * 3. `closeAll` runs before the HTTP server stops; `Hub.layer` sees to it.
 *    A server with an open WebSocket takes its whole graceful shutdown
 *    timeout (20 s) to stop.
 */
import {
  type BootstrapToken,
  TunnelRpcs,
  TunnelTokenInvalid,
} from "@gambi/protocol";
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Latch,
  Layer,
  Schedule,
  Schema,
  Scope,
} from "effect";
import { SecureRandom } from "effect/crypto";
import {
  RpcClient,
  RpcClientError,
  type RpcMessage,
  RpcSerialization,
} from "effect/rpc";
import { Socket } from "effect/socket";
import { Participants } from "./participants.ts";
import { HubSettings } from "./settings.ts";

/** How long a bootstrap token is valid for. */
export const BOOTSTRAP_TOKEN_TTL = Duration.seconds(60);

/**
 * The calls of one open tunnel, as the hub makes them. A unary call is an
 * `Effect` and a stream call a `Stream`; interrupting either cancels the
 * handler on the participant. When the tunnel drops, a call in flight fails
 * with `RpcClientError`.
 */
export type TunnelClient = RpcClient.FromGroup<
  typeof TunnelRpcs,
  RpcClientError.RpcClientError
>;

/** The participant has no open tunnel: it is `offline`, or not in the room. */
export class TunnelNotOpen extends Schema.TaggedError<TunnelNotOpen>()(
  "TunnelNotOpen",
  { roomCode: Schema.String, participantId: Schema.String }
) {
  override get message(): string {
    return `Participant '${this.participantId}' of room '${this.roomCode}' has no open tunnel.`;
  }
}

interface IssuedToken {
  readonly expiresAt: number;
  readonly participantId: string;
  readonly roomCode: string;
}

interface OpenTunnel {
  /** Ends the tunnel from the hub's side and waits until it is gone. */
  readonly close: (reason: string) => Effect.Effect<void>;
  /** Completes when the tunnel is gone and the participant is `offline`. */
  readonly gone: Effect.Effect<void>;
  /** The client, kept usable until the caller's scope closes. */
  readonly hold: Effect.Effect<TunnelClient, never, Scope.Scope>;
}

/** The error of a call on a tunnel the hub itself closed. */
const closedByHub = (reason: string) =>
  new RpcClientError.RpcClientError({
    reason: new Socket.SocketCloseError({ code: 1001, closeReason: reason }),
  });

// A room code never contains a space, so the pair is unambiguous.
const keyOf = (roomCode: string, participantId: string) =>
  `${roomCode} ${participantId}`;

export class Tunnels extends Context.Service<
  Tunnels,
  {
    /**
     * Completes when the participant has no open tunnel: at once when it has
     * none, otherwise when the one it has drops and the participant is
     * `offline`.
     */
    readonly awaitDrop: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<void>;
    /**
     * The calls of the participant's open tunnel. The client stays usable
     * until the caller's scope closes: if the tunnel drops meanwhile, its
     * calls fail with `RpcClientError`. Do not keep it past that scope; a
     * call on a client that was let go of is interrupted, not failed.
     */
    readonly client: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<TunnelClient, TunnelNotOpen, Scope.Scope>;
    /**
     * Closes the participant's tunnel from the hub's side and waits until it
     * is gone. Its calls in flight fail with `RpcClientError`, whose message
     * carries `reason`. Does nothing when the participant has no tunnel.
     */
    readonly close: (
      roomCode: string,
      participantId: string,
      reason: string
    ) => Effect.Effect<void>;
    /**
     * Closes every open tunnel and waits until they are gone. The calls in
     * flight fail with `RpcClientError`.
     *
     * A hub runs this before its HTTP server stops (`Hub.layer` does): each
     * tunnel is a request the server is still answering, and a server waits
     * its whole graceful shutdown timeout (20 s) for those.
     */
    readonly closeAll: Effect.Effect<void>;
    /**
     * Issues the bootstrap token for one tunnel of one participant: single
     * use, valid for `BOOTSTRAP_TOKEN_TTL`.
     */
    readonly issueToken: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<BootstrapToken>;
    /**
     * Spends a bootstrap token. It fails when the token was not issued for
     * that participant of that room, has expired or was already spent.
     */
    readonly redeemToken: (
      roomCode: string,
      participantId: string,
      token: string | undefined
    ) => Effect.Effect<void, TunnelTokenInvalid>;
    /**
     * Runs the participant's tunnel over the socket it dialed, and returns
     * when the tunnel is gone. The participant is `online` while it runs. A
     * tunnel the participant already had is closed first: the new one wins.
     */
    readonly serve: (
      roomCode: string,
      participantId: string,
      socket: Socket.Socket
    ) => Effect.Effect<void>;
  }
>()("gambi/core/Tunnels") {
  static readonly layer = Layer.effect(
    Tunnels,
    Effect.gen(function* () {
      const participants = yield* Participants;
      const random = yield* SecureRandom.SecureRandom;
      const settings = yield* HubSettings;
      const serialization = yield* RpcSerialization.RpcSerialization;
      const layerScope = yield* Effect.scope;
      const tokens = new Map<string, IssuedToken>();
      const open = new Map<string, OpenTunnel>();

      const issueToken = Effect.fn("Tunnels.issueToken")(function* (
        roomCode: string,
        participantId: string
      ) {
        const now = yield* Clock.currentTimeMillis;
        // Tokens that were never used leave here, without a timer.
        for (const [token, issued] of tokens) {
          if (issued.expiresAt <= now) {
            tokens.delete(token);
          }
        }
        const token = yield* random.uuidV4();
        const expiresAt = now + Duration.toMillis(BOOTSTRAP_TOKEN_TTL);
        tokens.set(token, { roomCode, participantId, expiresAt });
        return { token, expiresAt };
      });

      const redeemToken = Effect.fn("Tunnels.redeemToken")(function* (
        roomCode: string,
        participantId: string,
        token: string | undefined
      ) {
        const issued = token === undefined ? undefined : tokens.get(token);
        const now = yield* Clock.currentTimeMillis;
        if (
          token === undefined ||
          issued === undefined ||
          issued.roomCode !== roomCode ||
          issued.participantId !== participantId ||
          issued.expiresAt <= now
        ) {
          return yield* new TunnelTokenInvalid({ roomCode, participantId });
        }
        tokens.delete(token);
      });

      const serve = Effect.fn("Tunnels.serve")(
        function* (
          roomCode: string,
          participantId: string,
          socket: Socket.Socket
        ) {
          const key = keyOf(roomCode, participantId);
          const dropped = yield* Deferred.make<void>();
          const gone = yield* Deferred.make<void>();
          // The socket lives in `socketScope`. The RPC client lives in
          // `clientScope`, which stays open while someone holds the client:
          // closing a client interrupts whoever calls it afterwards.
          const socketScope = yield* Scope.make();
          const clientScope = yield* Scope.make();
          const unheld = Latch.makeUnsafe(true);
          let holders = 0;
          let ended: RpcClientError.RpcClientError | undefined;
          let toClient:
            | ((message: RpcMessage.FromServerEncoded) => Effect.Effect<void>)
            | undefined;
          let tunnel: OpenTunnel | undefined;

          const end = (error: RpcClientError.RpcClientError) =>
            Effect.suspend(() => {
              ended ??= error;
              return Deferred.succeed(dropped, undefined);
            });

          const teardown = Effect.gen(function* () {
            ended ??= closedByHub("the hub stopped serving the tunnel");
            // Calls still in flight fail with the typed error. When the
            // socket itself failed they already have, and this finds none.
            if (toClient !== undefined) {
              yield* toClient({ _tag: "ClientProtocolError", error: ended });
            }
            yield* Scope.close(socketScope, Exit.void);
            if (tunnel !== undefined && open.get(key) === tunnel) {
              open.delete(key);
              yield* participants.transition(
                roomCode,
                participantId,
                "tunnelDropped"
              );
              yield* Effect.logInfo("tunnel dropped").pipe(
                Effect.annotateLogs({ reason: ended.message })
              );
            }
            yield* Deferred.succeed(gone, undefined);
            yield* unheld.await.pipe(
              Effect.ensuring(Scope.close(clientScope, Exit.void)),
              Effect.forkIn(layerScope)
            );
          }).pipe(Effect.uninterruptible);

          yield* Effect.gen(function* () {
            const base = yield* RpcClient.makeProtocolSocket({
              pingInterval: settings.tunnelPingInterval,
              retryPolicy: Schedule.recurs(0),
            }).pipe(
              Effect.provideService(Socket.Socket, socket),
              Effect.provideService(
                RpcSerialization.RpcSerialization,
                serialization
              ),
              Scope.provide(socketScope)
            );
            // The protocol reports `ClientProtocolError` twice with
            // `recurs(0)`; ending twice is harmless.
            const protocol: typeof base = {
              ...base,
              run: (clientId, onMessage) => {
                toClient = onMessage;
                return base.run(clientId, (message) =>
                  message._tag === "ClientProtocolError"
                    ? Effect.ensuring(onMessage(message), end(message.error))
                    : onMessage(message)
                );
              },
              send: (clientId, request, transferables) =>
                ended === undefined
                  ? base.send(clientId, request, transferables)
                  : Effect.fail(ended),
            };
            const client = yield* RpcClient.make(TunnelRpcs).pipe(
              Effect.provideService(RpcClient.Protocol, protocol),
              Scope.provide(clientScope)
            );

            // The new tunnel wins: a participant that comes back before the
            // hub noticed its old tunnel die must not be kept out by it.
            for (
              let previous = open.get(key);
              previous !== undefined;
              previous = open.get(key)
            ) {
              yield* Effect.logInfo("tunnel superseded");
              yield* previous.close("superseded by a new tunnel");
            }
            tunnel = {
              close: (reason) =>
                end(closedByHub(reason)).pipe(
                  Effect.andThen(Deferred.await(gone))
                ),
              gone: Deferred.await(gone),
              hold: Effect.acquireRelease(
                Effect.sync(() => {
                  holders++;
                  unheld.closeUnsafe();
                  return client;
                }),
                () =>
                  Effect.sync(() => {
                    holders--;
                    if (holders === 0) {
                      unheld.openUnsafe();
                    }
                  })
              ),
            };
            open.set(key, tunnel);
            yield* participants.transition(
              roomCode,
              participantId,
              "tunnelOpened"
            );
            yield* Effect.logInfo("tunnel opened");
            // The participant runtime waits for this call to know it is
            // online. What the hub starts on every new tunnel goes here,
            // forked in `socketScope` so it ends with the tunnel.
            yield* client
              .Welcome({
                roomCode,
                participantId,
                hubVersion: settings.version,
              })
              .pipe(Effect.ignore, Effect.forkIn(socketScope));
            yield* Deferred.await(dropped);
          }).pipe(Effect.ensuring(teardown));
        },
        (effect, roomCode, participantId) =>
          Effect.annotateLogs(effect, { roomCode, participantId })
      );

      const closeAll = Effect.suspend(() =>
        Effect.forEach(
          [...open.values()],
          (tunnel) => tunnel.close("the hub is closing"),
          { concurrency: "unbounded", discard: true }
        )
      );
      // No tunnel outlives this layer. A hub must not rely on this alone:
      // see `closeAll`.
      yield* Effect.addFinalizer(() => closeAll);

      return Tunnels.of({
        awaitDrop: (roomCode, participantId) =>
          Effect.suspend(
            () => open.get(keyOf(roomCode, participantId))?.gone ?? Effect.void
          ),
        close: (roomCode, participantId, reason) =>
          Effect.suspend(
            () =>
              open.get(keyOf(roomCode, participantId))?.close(reason) ??
              Effect.void
          ),
        closeAll,
        client: (roomCode, participantId) =>
          Effect.suspend(() => {
            const tunnel = open.get(keyOf(roomCode, participantId));
            return tunnel === undefined
              ? Effect.fail(new TunnelNotOpen({ roomCode, participantId }))
              : tunnel.hold;
          }),
        issueToken,
        redeemToken,
        serve,
      });
    })
  ).pipe(Layer.provide(RpcSerialization.layerJson));
}
