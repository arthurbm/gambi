/**
 * What the two hosting entries of the SDK (`./hub.ts`, `./participant.ts`)
 * share: how something hosted in this process starts behind a `Promise`
 * boundary, and where its log lines go.
 *
 * Internal: an entry embeds its own copy of this file. Nothing here crosses
 * from one entry to another, and no public type lives here: the declarations
 * of an entry must never reach this file (see `./log.ts`).
 */
import { Effect, Layer, Logger } from "effect";
import type { LogEntry } from "./log.ts";
import { makePromiseBoundary, type PromiseBoundary } from "./promise.ts";

/**
 * A callback of the consumer's, as something hosted calls it: it may throw,
 * and it may be `async` and reject later (an `async` function is a valid
 * `=> void` callback). Either way `failed` hears of it and nothing of what
 * is hosted fails for it. The callback is never awaited.
 */
export const calling =
  <Args extends readonly unknown[]>(
    callback: ((...args: Args) => void) | undefined,
    failed: (cause: unknown) => void
  ) =>
  (...args: Args): void => {
    try {
      const answer: unknown = callback?.(...args);
      if (answer instanceof Promise) {
        answer.catch(failed);
      }
    } catch (cause) {
      failed(cause);
    }
  };

/**
 * `onLog`, safe to call. A sink that fails must not fail what was only being
 * logged, and there is nowhere left to say so.
 */
const sink = (
  onLog: ((entry: LogEntry) => void) | undefined
): ((entry: LogEntry) => void) => calling(onLog, () => undefined);

/**
 * What a failure of another callback of the consumer's becomes: a log line
 * of level `ERROR`, for `onLog`.
 */
export const failureTo =
  (onLog: ((entry: LogEntry) => void) | undefined, message: string) =>
  (cause: unknown): void =>
    sink(onLog)({
      annotations: {},
      cause: String(cause),
      level: "ERROR",
      message,
      timestamp: new Date().toISOString(),
    });

/**
 * Where the log lines of something hosted go: to `onLog`, or nowhere. Never
 * to stdout by themselves, which belongs to the program that hosts.
 */
export const logsTo = (
  onLog: ((entry: LogEntry) => void) | undefined
): Layer.Layer<never> => {
  const tell = sink(onLog);
  return Logger.layer(
    onLog === undefined
      ? []
      : [
          Logger.map(Logger.formatStructured, (line) => {
            tell({
              annotations: line.annotations,
              level: line.level,
              message: line.message,
              timestamp: line.timestamp,
              ...(line.cause === undefined ? {} : { cause: line.cause }),
            });
          }),
        ]
  );
};

/** `layer`, failing with `translate(error)` instead of with its own error. */
export const failingWith =
  <E, E2>(translate: (error: E) => E2) =>
  <A, R>(layer: Layer.Layer<A, E, R>): Layer.Layer<A, E2, R> =>
    Layer.effectContext(Effect.mapError(Layer.build(layer), translate));

export interface Hosted<A, R> {
  /** The boundary that owns what was started: `close` releases it. */
  readonly boundary: PromiseBoundary<R>;
  /** What `started` read once the layer was built. */
  readonly value: A;
}

/**
 * Starts what `layer` describes and resolves once it is running, with what
 * `started` reads of it. When the layer fails to build, everything it had
 * acquired is released first and the promise rejects with the layer's
 * error: give it a layer that already fails with the public error
 * (`failingWith`).
 */
export const host = async <A, R>(
  layer: Layer.Layer<R, Error>,
  what: string,
  started: Effect.Effect<A, never, R>
): Promise<Hosted<A, R>> => {
  const boundary = makePromiseBoundary(layer, what);
  try {
    return { boundary, value: await boundary.run(started) };
  } catch (error) {
    await boundary.close();
    throw error;
  }
};
