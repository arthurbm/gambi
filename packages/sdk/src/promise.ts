/**
 * The `Promise` boundary of the SDK: one `ManagedRuntime` per thing a
 * consumer creates (a client, and later a hub or a participant), and the two
 * ways out of it. An Effect leaves as a `Promise`, a `Stream` as an
 * `AsyncIterable`. Nothing of Effect appears in what they hand back.
 *
 * Internal: an entry of the SDK builds its public object on top of this and
 * exports only that object.
 */
import { Effect, type Layer, ManagedRuntime, Stream } from "effect";

export interface IterateOptions {
  /** Ends the iteration, without an error, when it aborts. */
  readonly signal?: AbortSignal | undefined;
}

export interface PromiseBoundary<R> {
  /**
   * Releases what the layer acquired and ends every open iteration. Later
   * calls are refused.
   */
  readonly close: () => Promise<void>;
  /**
   * The stream as an `AsyncIterable`. Nothing runs until the first `next()`.
   * It is pulled one element at a time, so a slow consumer slows the stream
   * instead of buffering it. Leaving the loop early (`break`, `return()`)
   * interrupts the stream. A failure of the stream is thrown from the loop as
   * it is: fail with the error the consumer should catch.
   */
  readonly iterate: <A>(
    stream: Stream.Stream<A, unknown, R>,
    options?: IterateOptions
  ) => AsyncIterable<A>;
  /**
   * Runs the Effect. The promise rejects with the failure as it is: fail with
   * the error the consumer should catch.
   */
  readonly run: <A>(effect: Effect.Effect<A, unknown, R>) => Promise<A>;
}

/** Completes when `signal` aborts. */
const aborted = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = () => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const DONE: IteratorReturnResult<undefined> = { done: true, value: undefined };

/**
 * Builds the boundary over `layer`. The layer is built by the first call and
 * released by `close`. `what` names the thing in the error of a call made
 * after `close` ("The client").
 */
export const makePromiseBoundary = <R, E>(
  layer: Layer.Layer<R, E>,
  what: string
): PromiseBoundary<R> => {
  const runtime = ManagedRuntime.make(layer);
  // Iterations run on fibers the runtime does not own, so `close` ends them
  // through this signal.
  const closing = new AbortController();
  let closed: Promise<void> | undefined;

  const refuseWhenClosed = (): void => {
    if (closed !== undefined) {
      throw new Error(`${what} is closed.`);
    }
  };

  return {
    run: async (effect) => {
      refuseWhenClosed();
      return await runtime.runPromise(effect);
    },
    iterate: <A>(
      stream: Stream.Stream<A, unknown, R>,
      options: IterateOptions = {}
    ): AsyncIterable<A> => {
      refuseWhenClosed();
      const stop =
        options.signal === undefined
          ? closing.signal
          : AbortSignal.any([closing.signal, options.signal]);
      return {
        [Symbol.asyncIterator]: (): AsyncIterator<A, undefined> => {
          let opened: AsyncIterator<A> | undefined;
          return {
            next: async () => {
              if (stop.aborted) {
                return DONE;
              }
              opened ??= Stream.toAsyncIterableWith(
                stream.pipe(Stream.interruptWhen(aborted(stop))),
                await runtime.context()
              )[Symbol.asyncIterator]();
              const result = await opened.next();
              return result.done === true ? DONE : result;
            },
            return: async () => {
              await opened?.return?.();
              return DONE;
            },
          };
        },
      };
    },
    close: () => {
      closing.abort();
      closed ??= runtime.dispose();
      return closed;
    },
  };
};
