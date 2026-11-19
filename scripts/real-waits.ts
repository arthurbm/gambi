import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Finds the real waits in the tests of the repository. The rule is in
 * `docs/reference/effect-conventions.md` ("Tests"): a test waits for an
 * event, never for a duration, and time moves with `TestClock.adjust`.
 *
 * It reads source text, so it sees a wait where it is written, not where it
 * is called from. `real-waits.test.ts` runs it over the repository.
 */

export interface RealWait {
  /** Path from the root of the repository, with `/`. */
  readonly file: string;
  /** 1-based. `0` for an exception that excuses nothing. */
  readonly line: number;
  readonly text: string;
  /** The API that waits, such as `setTimeout`. */
  readonly what: string;
}

/** Timers of the platform. No test clock moves them. */
const PLATFORM_TIMERS: readonly (readonly [string, RegExp])[] = [
  ["setTimeout", /\bsetTimeout\s*\(/],
  ["setInterval", /\bsetInterval\s*\(/],
  ["Bun.sleepSync", /\bBun\.sleepSync\b/],
  ["Bun.sleep", /\bBun\.sleep\b/],
  ["timers/promises", /["'](?:node:)?timers\/promises["']/],
  ["scheduler.wait", /\bscheduler\.wait\b/],
  ["Atomics.wait", /\bAtomics\.wait\b/],
];

/** Waits of Effect. They run on the clock of the test: virtual or real. */
const EFFECT_WAITS: readonly (readonly [string, RegExp])[] = [
  ["Effect.sleep", /\bEffect\.sleep\b/],
  ["Effect.delay", /\bEffect\.delay\b/],
  ["Schedule.spaced", /\bSchedule\.spaced\b/],
  ["Schedule.fixed", /\bSchedule\.fixed\b/],
  ["Schedule.exponential", /\bSchedule\.exponential\b/],
];

const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.tsx?$/;
/** The form of the test helper that runs under the test clock. */
const TEST_CLOCK = /\bit\.effect\b/;
/**
 * `it.live`, a `layer` block that keeps the real clock, or an Effect run by
 * hand (`Effect.runPromise`, a `ManagedRuntime`), which the helper's clock
 * never reaches.
 */
const REAL_CLOCK =
  /\bit\.live\b|excludeTestServices:\s*true|\bEffect\.run[A-Z]\w*|\bManagedRuntime\b/;
/**
 * A test that is not one of the helper's: `test(...)`, `it(...)`,
 * `test.each(...)`. Whatever Effect it runs, it runs on the real clock. The
 * helper's own `it.effect`, `it.live`, `it.layer` and `it.flakyTest` are not
 * plain tests.
 */
const PLAIN_TEST =
  /(?<![.\w])(?:test|it)(?:\.(?!(?:effect|live|layer|flakyTest)\b)\w+)*\s*\(/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** A file that only tests import: a `testing` or `__tests__` folder, or a `testing.ts`. */
const isTestHelper = (file: string): boolean => {
  const segments = file.split("/");
  return (
    segments.includes("testing") ||
    segments.includes("__tests__") ||
    segments.at(-1) === "testing.ts"
  );
};

/** The real waits written in `source`, the text of the test or test helper at `file`. */
export const realWaits = (file: string, source: string): RealWait[] => {
  const lines = source.split("\n");
  const code = lines.filter((line) => !COMMENT_LINE.test(line)).join("\n");
  // A helper is imported by tests of both kinds, so it is held to the real
  // clock. So is a whole test file with one test on the real clock: the check
  // does not tell the tests of a file apart.
  const onRealClock =
    !TEST_FILE.test(file) ||
    REAL_CLOCK.test(code) ||
    PLAIN_TEST.test(code) ||
    !TEST_CLOCK.test(code);
  const waits = onRealClock
    ? [...PLATFORM_TIMERS, ...EFFECT_WAITS]
    : PLATFORM_TIMERS;
  const found: RealWait[] = [];
  for (const [index, text] of lines.entries()) {
    if (COMMENT_LINE.test(text)) {
      continue;
    }
    for (const [what, pattern] of waits) {
      if (pattern.test(text)) {
        found.push({ file, line: index + 1, text: text.trim(), what });
      }
    }
  }
  return found;
};

/**
 * The waits that are real and meant. Each one says why; one that no longer
 * excuses anything is reported, so the list cannot outlive its reasons.
 */
const EXCEPTIONS: readonly {
  readonly file: string;
  readonly what: string;
  readonly why: string;
}[] = [
  {
    file: "packages/testing/src/effect.test.ts",
    what: "Effect.sleep",
    why: "The tests of the helper itself: a 20 ms sleep is how they prove that it.live and a layer without test services run on the real clock.",
  },
  {
    file: "packages/cli/src/npm-wrapper.test.ts",
    what: "setInterval",
    why: "Inside the source of a fake binary, to keep that process alive until the test signals it. The test waits for its exit, not for a duration.",
  },
  ...[...PLATFORM_TIMERS, ...EFFECT_WAITS].map(([what]) => ({
    file: "scripts/real-waits.test.ts",
    what,
    why: "The samples this check is tested with.",
  })),
];

const SKIPPED_FOLDERS = new Set(["node_modules", "dist", ".turbo", ".astro"]);

async function sourceFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) {
        files.push(...(await sourceFiles(path)));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * The real waits of every test and test helper under `apps`, `packages` and
 * `scripts`, without the exceptions, plus each exception that excuses nothing.
 */
export const realWaitsOfRepository = async (
  root: string
): Promise<RealWait[]> => {
  const found: RealWait[] = [];
  for (const group of ["apps", "packages", "scripts"]) {
    for (const path of await sourceFiles(join(root, group))) {
      const file = relative(root, path).split(sep).join("/");
      if (TEST_FILE.test(file) || isTestHelper(file)) {
        found.push(...realWaits(file, await Bun.file(path).text()));
      }
    }
  }
  const excused = (wait: RealWait) =>
    EXCEPTIONS.some(
      (exception) =>
        exception.file === wait.file && exception.what === wait.what
    );
  const unused = EXCEPTIONS.filter(
    (exception) =>
      !found.some(
        (wait) => wait.file === exception.file && wait.what === exception.what
      )
  ).map((exception) => ({
    file: exception.file,
    line: 0,
    text: exception.why,
    what: `unused exception for ${exception.what}`,
  }));
  return [...found.filter((wait) => !excused(wait)), ...unused];
};
