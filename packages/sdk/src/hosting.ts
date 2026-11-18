/**
 * What the two hosting entries of the SDK (`./hub.ts`, `./participant.ts`)
 * share: how something hosted in this process starts behind a `Promise`
 * boundary, where its log lines go, and what an input loses on its way in.
 *
 * Internal: an entry embeds its own copy of this file. Nothing here crosses
 * from one entry to another, and nothing here is exported from an entry but
 * the `LogEntry` type.
 */
import { Effect, Layer, Logger } from "effect";
import { makePromiseBoundary, type PromiseBoundary } from "./promise.ts";

/** One log line of something hosted in this process. Plain JSON. */
export interface LogEntry {
  /** What the line was annotated with: a room code, a participant id, an operation. */
  readonly annotations: Readonly<Record<string, unknown>>;
  /** The failure behind the line, rendered, when it has one. */
  readonly cause?: string;
  /** `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` or `FATAL`. */
  readonly level: string;
  readonly message: unknown;
  /** ISO 8601. */
  readonly timestamp: string;
}

/**
 * Where the log lines of something hosted go: to `onLog`, or nowhere. Never
 * to stdout by themselves, which belongs to the program that hosts.
 */
export const logsTo = (
  onLog: ((entry: LogEntry) => void) | undefined
): Layer.Layer<never> =>
  Logger.layer(
    onLog === undefined
      ? []
      : [
          Logger.map(Logger.formatStructured, (line) => {
            onLog({
              annotations: line.annotations,
              level: line.level,
              message: line.message,
              timestamp: line.timestamp,
              ...(line.cause === undefined ? {} : { cause: line.cause }),
            });
          }),
        ]
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * `value` without the keys that hold `undefined`, at any depth of its plain
 * objects. A form, or a spread of optional values, leaves such keys behind,
 * and the contract refuses a field that is present without a value: to a
 * consumer the two mean the same, "not given".
 */
export const withoutUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, withoutUndefined(field)])
  ) as T;
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
