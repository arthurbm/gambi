/**
 * The `Promise` boundary of the SDK: one `ManagedRuntime` per thing a
 * consumer creates (a client, and later a hub or a participant), and the two
 * ways out of it. An Effect leaves as a `Promise`, a `Stream` as an
 * `AsyncIterable`. Nothing of Effect appears in what they hand back.
 *
 * Internal: an entry of the SDK builds its public object on top of this and
 * exports only that object.
 */
import {
  Cause,
  type Effect,
  Exit,
  type Layer,
  ManagedRuntime,
  Stream,
} from "effect";

export interface IterateOptions {
  /** Ends the iteration, without an error, when it aborts. */
  readonly signal?: AbortSignal | undefined;
}

export interface PromiseBoundary<R> {
  /**
   * Releases what the layer acquired, ends every open iteration and
   * interrupts the calls in flight, which reject. Later calls are refused.
   */
  readonly close: () => Promise<void>;
  /**
   * The stream as an `AsyncIterable`. Nothing runs until the first `next()`.
   * It is pulled one element at a time, so a slow consumer slows the stream
   * instead of buffering it. The stream is interrupted as soon as the
   * consumer leaves the loop (`break`, `return()`), `signal` aborts or the
   * boundary closes, whether or not a `next()` is waiting. A failure of the
   * stream is thrown from the loop as it is: fail with the error the consumer
   * should catch.
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

const DONE: IteratorReturnResult<undefined> = { done: true, value: undefined };

/**
 * The iterator `open` yields, opened by the first `next()` and interrupted,
 * once, when the consumer leaves it or one of `stops` aborts.
 */
const stoppable = <A>(
  open: () => Promise<AsyncIterator<A>>,
  stops: readonly AbortSignal[]
): AsyncIterator<A, undefined> => {
  let opening: Promise<AsyncIterator<A>> | undefined;
  let finished = false;

  /** Safe to call at any moment, and more than once. */
  const finish = async (): Promise<typeof DONE> => {
    if (!finished) {
      finished = true;
      for (const stop of stops) {
        stop.removeEventListener("abort", onStop);
      }
      // Closing the inner iterator also settles a `next()` that waits.
      await opening?.then(
        (opened) => opened.return?.(),
        () => undefined
      );
    }
    return DONE;
  };
  const onStop = (): void => {
    finish().catch(() => undefined);
  };
  const start = (): Promise<AsyncIterator<A>> => {
    for (const stop of stops) {
      stop.addEventListener("abort", onStop, { once: true });
    }
    return open();
  };

  const pull = async (): Promise<IteratorResult<A, undefined>> => {
    if (finished || stops.some((stop) => stop.aborted)) {
      return finish();
    }
    opening ??= start();
    try {
      const result = await (await opening).next();
      return result.done === true ? await finish() : result;
    } catch (error) {
      await finish();
      throw error;
    }
  };
  // The inner iterator takes one pull at a time: two at once would each open
  // the stream. A `next()` waits for the one before it; `finish` does not
  // wait, so leaving or stopping still interrupts the pull in progress.
  let previous: Promise<unknown> = Promise.resolve();

  return {
    next: () => {
      const result = previous.then(pull, pull);
      previous = result;
      return result;
    },
    return: finish,
  };
};

/**
 * Builds the boundary over `layer`. The layer is built by the first call and
 * released by `close`. `what` names the thing in the error of a call refused
 * because of `close` ("The client").
 */
export const makePromiseBoundary = <R, E>(
  layer: Layer.Layer<R, E>,
  what: string,
  closedError: () => Error = () => new Error(`${what} is closed.`)
): PromiseBoundary<R> => {
  const runtime = ManagedRuntime.make(layer);
  // Iterations run on fibers the runtime does not own, so `close` ends them
  // through this signal.
  const closing = new AbortController();
  let closed: Promise<void> | undefined;

  return {
    run: async (effect) => {
      if (closed !== undefined) {
        throw closedError();
      }
      const exit = await runtime.runPromiseExit(effect);
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      // Nothing but `close` interrupts a call.
      throw Cause.hasInterruptsOnly(exit.cause)
        ? closedError()
        : Cause.squash(exit.cause);
    },
    iterate: <A>(
      stream: Stream.Stream<A, unknown, R>,
      options: IterateOptions = {}
    ): AsyncIterable<A> => {
      if (closed !== undefined) {
        throw closedError();
      }
      const stops =
        options.signal === undefined
          ? [closing.signal]
          : [closing.signal, options.signal];
      return {
        [Symbol.asyncIterator]: () =>
          stoppable(
            () =>
              runtime
                .context()
                .then((context) =>
                  Stream.toAsyncIterableWith(stream, context)[
                    Symbol.asyncIterator
                  ]()
                ),
            stops
          ),
      };
    },
    close: () => {
      closing.abort();
      closed ??= runtime.dispose();
      return closed;
    },
  };
};
