/**
 * The streams one hub is serving that have no end of their own: the events
 * of a room, the attach stream of a harness participant.
 *
 * Each is a response the HTTP server is still writing, and a server that
 * stops waits its whole graceful shutdown timeout (20 s) for those. So a
 * handler passes such a stream through `untilHubCloses`, and `Hub.layer`
 * runs `closeAll` before the server stops: the streams end, the responses
 * complete, and the hub closes at once.
 */
import { Context, Deferred, Effect, Layer, Stream } from "effect";

export class OpenStreams extends Context.Service<
  OpenStreams,
  {
    /**
     * Ends every stream that went through `untilHubCloses`. One that goes
     * through it later ends at once.
     */
    readonly closeAll: Effect.Effect<void>;
    /**
     * The same stream, ended when the hub closes. The client sees its
     * response complete, not an error.
     *
     * @example
     * return streams.untilHubCloses(events.watch(room.code, snapshot));
     */
    readonly untilHubCloses: <A, E, R>(
      stream: Stream.Stream<A, E, R>
    ) => Stream.Stream<A, E, R>;
  }
>()("gambi/core/OpenStreams") {
  static readonly layer = Layer.effect(
    OpenStreams,
    Effect.gen(function* () {
      const closing = yield* Deferred.make<void>();
      const closeAll = Effect.asVoid(Deferred.succeed(closing, undefined));
      // No stream outlives this layer. A hub must not rely on this alone:
      // see the header.
      yield* Effect.addFinalizer(() => closeAll);
      return OpenStreams.of({
        closeAll,
        untilHubCloses: Stream.interruptWhen(Deferred.await(closing)),
      });
    })
  );
}
