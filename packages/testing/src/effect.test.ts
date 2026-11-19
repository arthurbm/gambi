import { expect, test } from "bun:test";
import { Cause, Context, Effect, Exit, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { it, layer } from "./effect.ts";

it.effect("advancing the test clock fires a timeout without a real wait", () =>
  Effect.gen(function* () {
    const wallClockStart = performance.now();
    const fiber = yield* Effect.never.pipe(
      Effect.timeout("5 minutes"),
      Effect.forkChild
    );

    yield* TestClock.adjust("4 minutes");
    expect(fiber.pollUnsafe()).toBeUndefined();

    yield* TestClock.adjust("1 minute");
    const exit = yield* Fiber.await(fiber);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isTimeoutError(Cause.squash(exit.cause))).toBe(true);
    }
    expect(performance.now() - wallClockStart).toBeLessThan(1000);
  })
);

it.live("a live test sleeps on the real clock", () =>
  Effect.gen(function* () {
    const wallClockStart = performance.now();
    yield* Effect.sleep("20 millis");
    expect(performance.now() - wallClockStart).toBeGreaterThanOrEqual(15);
  })
);

it.effect.fails("a failed Effect fails the test", () =>
  Effect.fail(new Error("boom"))
);

it.effect.fails("a failed expectation inside the Effect fails the test", () =>
  Effect.sync(() => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: Biome does not see `it.effect.fails` as a test
    expect(1).toBe(2);
  })
);

const scopeLifecycle = { released: 0 };

it.effect("gives each test a scope", () =>
  Effect.addFinalizer(() =>
    Effect.sync(() => {
      scopeLifecycle.released += 1;
    })
  )
);

it.effect("closes that scope when the test ends", () =>
  Effect.sync(() => {
    expect(scopeLifecycle.released).toBe(1);
  })
);

it.effect.each([
  { input: " Ada ", expected: "ada" },
  { input: "LIN", expected: "lin" },
])("each runs the body once per row: $input", ({ input, expected }) =>
  Effect.sync(() => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: Biome does not see `it.effect.each` as a test
    expect(input.trim().toLowerCase()).toBe(expected);
  })
);

it.effect.skipIf(true)("skipIf skips a test that would fail", () =>
  Effect.fail(new Error("must not run"))
);

it.effect.runIf(false)("runIf skips a test that would fail", () =>
  Effect.fail(new Error("must not run"))
);

it.effect.skip("skip skips a test that would fail", () =>
  Effect.fail(new Error("must not run"))
);

const counterLifecycle = { built: 0, released: 0 };

class Counter extends Context.Service<Counter, Ref.Ref<number>>()(
  "gambi/testing/Counter"
) {
  static readonly layer = Layer.effect(
    Counter,
    Effect.acquireRelease(
      Effect.suspend(() => {
        counterLifecycle.built += 1;
        return Ref.make(0);
      }),
      () =>
        Effect.sync(() => {
          counterLifecycle.released += 1;
        })
    )
  );
}

layer(Counter.layer)("a shared layer", (it) => {
  it.effect("is built once for the block", () =>
    Effect.gen(function* () {
      const counter = yield* Counter;
      expect(yield* Ref.updateAndGet(counter, (n) => n + 1)).toBe(1);
      expect(counterLifecycle).toEqual({ built: 1, released: 0 });
    })
  );

  it.effect("keeps its state between tests", () =>
    Effect.gen(function* () {
      const counter = yield* Counter;
      expect(yield* Ref.updateAndGet(counter, (n) => n + 1)).toBe(2);
      expect(counterLifecycle).toEqual({ built: 1, released: 0 });
    })
  );

  it.effect("still runs each test on the test clock", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.sleep("1 hour"));
      yield* TestClock.adjust("1 hour");
      yield* Fiber.join(fiber);
    })
  );
});

class Doubled extends Context.Service<Doubled, number>()(
  "gambi/testing/Doubled"
) {
  static readonly layer = Layer.effect(
    Doubled,
    Effect.gen(function* () {
      const counter = yield* Counter;
      return (yield* Ref.get(counter)) * 2;
    })
  );
}

layer(Counter.layer)("a nested layer", (it) => {
  it.effect("sets up the outer layer", () =>
    Effect.gen(function* () {
      const counter = yield* Counter;
      yield* Ref.set(counter, 21);
    })
  );

  it.layer(Doubled.layer)("inside", (it) => {
    it.effect("reads the instance the outer block built", () =>
      Effect.gen(function* () {
        expect(yield* Doubled).toBe(42);
        expect(yield* Ref.get(yield* Counter)).toBe(21);
      })
    );
  });
});

layer(Layer.empty, { excludeTestServices: true })(
  "a layer without test services",
  (it) => {
    it.effect("runs on the real clock", () =>
      Effect.gen(function* () {
        const wallClockStart = performance.now();
        yield* Effect.sleep("20 millis");
        expect(performance.now() - wallClockStart).toBeGreaterThanOrEqual(15);
      })
    );
  }
);

// Runs after the blocks above: each `layer` block releases in its own `afterAll`.
test("a shared layer is released when its block ends", () => {
  expect(counterLifecycle).toEqual({ built: 2, released: 2 });
});
