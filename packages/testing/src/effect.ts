/**
 * Effect tests on `bun test`, with the API shape of `@effect/vitest`
 * (`it.effect`, `it.live`, `layer`). ADR-0007 explains why the repo does not
 * use `@effect/vitest` itself. How to use it: `docs/reference/effect-conventions.md`.
 */
import {
  afterAll,
  beforeAll,
  describe,
  type TestOptions,
  test,
} from "bun:test";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  pipe,
  Schedule,
  Scope,
} from "effect";
import { TestClock, TestConsole } from "effect/testing";

/** A test body. `Args` is the row of `each`, and empty everywhere else. */
export type TestFunction<A, E, R, Args extends unknown[] = []> = (
  ...args: Args
) => Effect.Effect<A, E, R>;

export type Test<R> = <A, E>(
  name: string,
  self: TestFunction<A, E, R>,
  timeout?: number | TestOptions
) => void;

export interface Tester<R> extends Test<R> {
  each: <T>(
    cases: readonly T[]
  ) => <A, E>(
    name: string,
    self: TestFunction<A, E, R, [T]>,
    timeout?: number | TestOptions
  ) => void;
  /** The test passes only when the Effect fails. */
  fails: Test<R>;
  only: Test<R>;
  runIf: (condition: unknown) => Test<R>;
  skip: Test<R>;
  skipIf: (condition: unknown) => Test<R>;
}

export interface LayerOptions {
  /**
   * Leave `TestClock` and `TestConsole` out, so `it.effect` inside the block
   * runs on the real clock. For blocks that share a socket or a subprocess.
   */
  readonly excludeTestServices?: boolean;
  readonly memoMap?: Layer.MemoMap;
  /** Time limit for building and for releasing the layer. */
  readonly timeout?: Duration.Input;
}

export interface MethodsNonLive<R = never> {
  readonly effect: Tester<R | Scope.Scope>;
  readonly flakyTest: typeof flakyTest;
  /** A nested shared layer, built on top of the enclosing one. */
  readonly layer: <R2, E>(
    layer: Layer.Layer<R2, E, R>,
    options?: Pick<LayerOptions, "timeout">
  ) => LayerBlock<R | R2>;
}

export interface Methods extends MethodsNonLive {
  readonly layer: <R, E>(
    layer: Layer.Layer<R, E>,
    options?: LayerOptions
  ) => LayerBlock<R>;
  readonly live: Tester<Scope.Scope>;
}

export interface LayerBlock<R> {
  (f: (it: MethodsNonLive<R>) => void): void;
  (name: string, f: (it: MethodsNonLive<R>) => void): void;
}

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer());

/**
 * Logs every error of a failed test before rejecting, so the report shows the
 * whole cause and not only the first error.
 */
const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      if (Exit.isFailure(exit)) {
        for (const error of Cause.prettyErrors(exit.cause)) {
          yield* Effect.logError(error);
        }
      }
      return yield* exit;
    })
  );

const makeTester = <R>(
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E>
): Tester<R> => {
  const run = <A, E, Args extends unknown[]>(
    self: TestFunction<A, E, R, Args>,
    args: Args
  ) =>
    pipe(
      Effect.suspend(() => self(...args)),
      mapEffect,
      runPromise
    );

  // Each body is wrapped in a zero-argument function: `bun test` hands a
  // `done` callback to any test function that declares a parameter.
  const register =
    (
      runner: (
        name: string,
        fn: () => Promise<unknown>,
        options?: number | TestOptions
      ) => unknown
    ): Test<R> =>
    (name, self, timeout) => {
      runner(name, () => run(self, []), timeout);
    };

  const each: Tester<R>["each"] = (cases) => (name, self, timeout) => {
    test.each([...cases])(name, (row) => run(self, [row]), timeout);
  };

  // Read `test.only` when it is called, not here: `bun test` throws on the
  // property access itself when `CI=true`.
  const only: Test<R> = (name, self, timeout) =>
    register(test.only)(name, self, timeout);

  return Object.assign(register(test), {
    each,
    fails: register(test.failing),
    only,
    runIf: (condition: unknown) => register(test.if(Boolean(condition))),
    skip: register(test.skip),
    skipIf: (condition: unknown) => register(test.skipIf(Boolean(condition))),
  });
};

/**
 * Retries a flaky Effect up to 10 times within `timeout`, then dies. Wrap the
 * body of an `it.live` test with it; do not use it to hide a real race.
 */
export const flakyTest = <A, E, R>(
  self: Effect.Effect<A, E, R | Scope.Scope>,
  timeout: Duration.Input = Duration.seconds(30)
): Effect.Effect<A, never, Exclude<R, Scope.Scope>> =>
  pipe(
    self,
    Effect.scoped,
    Effect.sandbox,
    Effect.retry(
      pipe(
        Schedule.recurs(10),
        Schedule.while((metadata) =>
          Effect.succeed(
            Duration.isLessThanOrEqualTo(
              Duration.fromInputUnsafe(metadata.elapsed),
              Duration.fromInputUnsafe(timeout)
            )
          )
        )
      )
    ),
    Effect.orDie
  );

/**
 * Builds `layer` once for a block of tests and releases it in `afterAll`.
 * Every `it.effect` in the block sees the same service instances.
 *
 * @example
 * layer(Rooms.layerTest)("Rooms", (it) => {
 *   it.effect("creates a room", () => Effect.gen(function* () { ... }));
 * });
 */
export const layer = <R, E>(
  layer_: Layer.Layer<R, E>,
  options?: LayerOptions
): LayerBlock<R> => {
  const block = (
    ...args:
      | [f: (it: MethodsNonLive<R>) => void]
      | [name: string, f: (it: MethodsNonLive<R>) => void]
  ): void => {
    const excludeTestServices = options?.excludeTestServices ?? false;
    const withTestEnv = excludeTestServices
      ? layer_
      : Layer.provideMerge(layer_, TestEnv);
    const memoMap = options?.memoMap ?? Effect.runSync(Layer.makeMemoMap);
    const scope = Effect.runSync(Scope.make());
    const contextEffect = Layer.buildWithMemoMap(
      withTestEnv,
      memoMap,
      scope
    ).pipe(Effect.orDie, Effect.cached, Effect.runSync);
    const hookTimeout = options?.timeout
      ? Duration.toMillis(Duration.fromInputUnsafe(options.timeout))
      : undefined;

    const methods: MethodsNonLive<R> = {
      effect: makeTester<R | Scope.Scope>((effect) =>
        Effect.flatMap(contextEffect, (context) =>
          effect.pipe(Effect.scoped, Effect.provide(context))
        )
      ),
      flakyTest,
      layer: <R2, E2>(
        nestedLayer: Layer.Layer<R2, E2, R>,
        nestedOptions?: Pick<LayerOptions, "timeout">
      ) =>
        layer(Layer.provideMerge(nestedLayer, withTestEnv), {
          ...nestedOptions,
          excludeTestServices: true,
          memoMap,
        }),
    };

    const registerHooks = () => {
      beforeAll(() => runPromise(Effect.asVoid(contextEffect)), hookTimeout);
      afterAll(() => runPromise(Scope.close(scope, Exit.void)), hookTimeout);
    };

    if (args.length === 1) {
      registerHooks();
      args[0](methods);
      return;
    }
    describe(args[0], () => {
      registerHooks();
      args[1](methods);
    });
  };
  return block;
};

/** Runs on `TestClock` and `TestConsole`. Time only moves with `TestClock.adjust`. */
export const effect: Tester<Scope.Scope> = makeTester((self) =>
  self.pipe(Effect.scoped, Effect.provide(TestEnv))
);

/** Runs on the real clock. Only for tests that need a socket or a subprocess. */
export const live: Tester<Scope.Scope> = makeTester((self) =>
  Effect.scoped(self)
);

export const it: Methods = { effect, flakyTest, layer, live };
