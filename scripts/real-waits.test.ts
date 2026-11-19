import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { realWaits, realWaitsOfRepository } from "./real-waits.ts";

/**
 * No test waits for a real duration (`docs/reference/effect-conventions.md`,
 * "Tests"). A wait is real when the test clock cannot move it: a timer of
 * the platform anywhere, or a sleep of Effect in a file that runs on the
 * real clock.
 */

const ROOT = resolve(import.meta.dir, "..");

const waitsOf = (source: string, path = "packages/core/src/hub/x.test.ts") =>
  realWaits(path, source).map((wait) => wait.what);

describe("a real wait in a test", () => {
  test.each([
    ["setTimeout", "await new Promise((resolve) => setTimeout(resolve, 25));"],
    ["setInterval", "const timer = setInterval(check, 10);"],
    ["Bun.sleep", "await Bun.sleep(25);"],
    ["Bun.sleepSync", "Bun.sleepSync(25);"],
    ["timers/promises", 'import { setTimeout } from "node:timers/promises";'],
    ["timers/promises", 'const { scheduler } = require("timers/promises");'],
    ["scheduler.wait", "await scheduler.wait(25);"],
    ["Atomics.wait", "Atomics.wait(view, 0, 0, 25);"],
  ])("%s is a timer of the platform, real under any clock", (what, line) => {
    expect(
      waitsOf(`import { it } from "@gambi/testing/effect";\n${line}\n`)
    ).toEqual([what]);
  });

  test.each([
    ["Effect.sleep", 'yield* Effect.sleep("20 millis");'],
    ["Effect.delay", 'yield* Effect.delay(check, "20 millis");'],
    ["Schedule.spaced", 'Effect.repeat(check, Schedule.spaced("10 millis"))'],
    ["Schedule.fixed", 'Effect.repeat(check, Schedule.fixed("10 millis"))'],
    [
      "Schedule.exponential",
      'Effect.retry(check, Schedule.exponential("10 millis"))',
    ],
  ])("%s is real in a file that runs on the real clock", (what, line) => {
    const live = `it.live("waits", () => Effect.gen(function* () {\n  ${line}\n}));\n`;
    const shared = `layer(layerHub(), { excludeTestServices: true })("hub", (it) => {\n  ${line}\n});\n`;
    const virtual = `it.effect("waits", () => Effect.gen(function* () {\n  ${line}\n}));\n`;

    expect(waitsOf(live)).toEqual([what]);
    expect(waitsOf(shared)).toEqual([what]);
    // Under the test clock it only moves with `TestClock.adjust`.
    expect(waitsOf(virtual)).toEqual([]);
  });

  test("a sleep of Effect run by hand, outside the helper, is on the real clock", () => {
    const source =
      'test("waits", () => Effect.runPromise(Effect.sleep("20 millis")));\n';

    expect(waitsOf(source)).toEqual(["Effect.sleep"]);
  });

  test("a plain test beside it.effect holds the file to the real clock: it may run an Effect by any name", () => {
    const source = [
      "const { runPromise } = Effect;",
      'it.effect("virtual", () => Effect.void);',
      'test("waits", () => runPromise(Effect.sleep("20 millis")));',
    ].join("\n");

    expect(waitsOf(source)).toEqual(["Effect.sleep"]);
  });

  test("a comment does not decide which clock a file runs on", () => {
    const source = [
      "// Unlike a ManagedRuntime or it.live, this runs on the test clock.",
      'it.effect("virtual", () => Effect.sleep("1 hour"));',
    ].join("\n");

    expect(waitsOf(source)).toEqual([]);
  });

  test("a test helper may run under either clock, so a sleep of Effect in it is real", () => {
    const helper = 'export const settle = Effect.sleep("20 millis");\n';

    expect(waitsOf(helper, "packages/core/src/testing/settle.ts")).toEqual([
      "Effect.sleep",
    ]);
  });

  test("says where the wait is", () => {
    const source =
      'import { expect } from "bun:test";\n\nawait Bun.sleep(25);\n';

    expect(realWaits("packages/sdk/src/client.test.ts", source)).toEqual([
      {
        file: "packages/sdk/src/client.test.ts",
        line: 3,
        text: "await Bun.sleep(25);",
        what: "Bun.sleep",
      },
    ]);
  });

  test("a comment that names a timer is not a wait", () => {
    const source = [
      "// Never setTimeout here: wait for the event.",
      "/**",
      " * `Bun.sleep` would hide the race.",
      " */",
      "const answer = 42;",
    ].join("\n");

    expect(waitsOf(source)).toEqual([]);
  });

  test("a bound on how long a test may take is not a wait", () => {
    const source =
      'it.live("answers", () => call.pipe(Effect.timeout("5 seconds")));\n';

    expect(waitsOf(source)).toEqual([]);
  });
});

test("no test and no test helper of the repository waits for a real duration", async () => {
  expect(await realWaitsOfRepository(ROOT)).toEqual([]);
});
