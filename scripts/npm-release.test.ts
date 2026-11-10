import { describe, expect, test } from "bun:test";
import {
  isAlreadyPublishedError,
  type NpmClient,
  NpmReleaseError,
  type PublishOutcome,
  parseNpmViewDistTags,
  parseNpmViewVersion,
  publishAndVerify,
  type ReleasePackage,
} from "./npm-release";

const VERSION = "0.7.2";
const TAG = "latest";
const MINUTE = 60_000;

interface Behavior {
  /** The publish fails. */
  fails?: boolean;
  /** Already on npm before the run (visible after `visibleAfterMs`). */
  onNpm?: boolean;
  /** npm shows the version this long after the publish. Infinity = never. */
  visibleAfterMs?: number;
}

/**
 * An in-memory npm registry with a fake clock: publishes take `publishMs`,
 * versions show up in `npm view` only after their delay, and publishing a
 * version that exists fails the way npm does.
 */
function fakeRegistry(behaviors: Record<string, Behavior>, publishMs = 5000) {
  let clock = 0;
  const visibleAt = new Map<string, number>();
  const calls: string[] = [];

  for (const [name, behavior] of Object.entries(behaviors)) {
    if (behavior.onNpm) {
      visibleAt.set(name, behavior.visibleAfterMs ?? 0);
    }
  }
  const isVisible = (name: string) =>
    clock >= (visibleAt.get(name) ?? Number.POSITIVE_INFINITY);

  const npm: NpmClient = {
    isPublished(name) {
      calls.push(`check ${name}`);
      return Promise.resolve(isVisible(name));
    },
    publish(pkg): Promise<PublishOutcome> {
      calls.push(`publish ${pkg.name}`);
      clock += publishMs;
      const behavior = behaviors[pkg.name] ?? {};
      if (visibleAt.has(pkg.name)) {
        // Real npm: "You cannot publish over the previously published
        // versions", which the client maps to already-published.
        return Promise.resolve({ status: "already-published" });
      }
      if (behavior.fails) {
        return Promise.resolve({ status: "failed", error: "npm error E503" });
      }
      visibleAt.set(pkg.name, clock + (behavior.visibleAfterMs ?? 0));
      return Promise.resolve({ status: "published" });
    },
    view(name) {
      calls.push(`view ${name}`);
      if (!isVisible(name)) {
        return Promise.reject(new Error("E404"));
      }
      return Promise.resolve({
        publishedVersion: VERSION,
        distTagVersion: VERSION,
      });
    },
  };

  return {
    npm,
    calls,
    now: () => clock,
    sleep: (ms: number) => {
      clock += ms;
      return Promise.resolve();
    },
  };
}

type Registry = ReturnType<typeof fakeRegistry>;

function packagesFor(names: string[]): ReleasePackage[] {
  return names.map((name) => ({ name, tarball: `/fake/${name}.tgz` }));
}

function run(registry: Registry, names: string[], logs: string[] = []) {
  return publishAndVerify({
    packages: packagesFor(names),
    tag: TAG,
    version: VERSION,
    npm: registry.npm,
    now: registry.now,
    sleep: registry.sleep,
    log: (message) => logs.push(message),
  });
}

const publishes = (calls: string[]) =>
  calls.filter((call) => call.startsWith("publish "));

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof NpmReleaseError)) {
    throw new Error(`expected an NpmReleaseError, got ${String(error)}`);
  }
  return error;
}

describe("publishAndVerify", () => {
  test("publishes every package before waiting, then waits for all at once", async () => {
    const registry = fakeRegistry({
      a: { visibleAfterMs: MINUTE },
      b: { visibleAfterMs: 4.5 * MINUTE },
      c: { visibleAfterMs: 3.5 * MINUTE },
    });

    const results = await run(registry, ["a", "b", "c"]);

    expect(results.map((result) => result.packageName)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const firstView = registry.calls.findIndex((call) =>
      call.startsWith("view ")
    );
    expect(publishes(registry.calls.slice(0, firstView))).toEqual([
      "publish a",
      "publish b",
      "publish c",
    ]);
    // The waits overlap: 3 publishes + the slowest wait (b, published at
    // 10 s), not the sum of the waits.
    expect(registry.now()).toBeLessThanOrEqual(10_000 + 4.5 * MINUTE + 15_000);
  });

  test("does not publish a version that is already on npm", async () => {
    const registry = fakeRegistry({
      a: { onNpm: true },
      b: { visibleAfterMs: 30_000 },
    });

    expect(await run(registry, ["a", "b"])).toHaveLength(2);
    expect(publishes(registry.calls)).toEqual(["publish b"]);
  });

  test("treats an 'already published' publish error as published", async () => {
    // npm view cannot see it yet, so the pre-check says "not on npm" and the
    // publish fails with the conflict error.
    const registry = fakeRegistry({
      a: { onNpm: true, visibleAfterMs: 45_000 },
    });
    const logs: string[] = [];

    const results = await run(registry, ["a"], logs);

    expect(results[0]?.verified).toBe(true);
    expect(publishes(registry.calls)).toEqual(["publish a"]);
    expect(logs.join("\n")).toContain("a@0.7.2 is already on npm");
  });

  test("waits up to 30 minutes and publishes each package only once", async () => {
    const registry = fakeRegistry({
      a: { visibleAfterMs: MINUTE },
      // Past the earlier timeouts (5 and 20 minutes), inside 30.
      slow: { visibleAfterMs: 25 * MINUTE },
    });

    expect(await run(registry, ["a", "slow"])).toHaveLength(2);
    expect(publishes(registry.calls)).toEqual(["publish a", "publish slow"]);
  });

  test("does not publish again when npm still does not show a package at the timeout", async () => {
    const registry = fakeRegistry({
      a: { visibleAfterMs: MINUTE },
      lost: { visibleAfterMs: Number.POSITIVE_INFINITY },
    });

    const error = await failure(run(registry, ["a", "lost"]));

    expect(publishes(registry.calls)).toEqual(["publish a", "publish lost"]);
    expect(error.message).toContain(
      "npm does not show lost@0.7.2 (npm view: E404) after 1800 s"
    );
    expect(error.message).toContain("this is not a failed publish");
    expect(error.verified.map((result) => result.packageName)).toEqual(["a"]);
    expect(registry.now()).toBeGreaterThanOrEqual(30 * MINUTE);
    expect(registry.now()).toBeLessThan(31 * MINUTE);
  });

  test("fails without waiting when a publish fails, after trying the rest", async () => {
    const registry = fakeRegistry({
      a: { visibleAfterMs: MINUTE },
      broken: { fails: true },
      c: { visibleAfterMs: MINUTE },
    });

    const error = await failure(run(registry, ["a", "broken", "c"]));

    expect(publishes(registry.calls)).toEqual([
      "publish a",
      "publish broken",
      "publish c",
    ]);
    expect(registry.calls.some((call) => call.startsWith("view "))).toBe(false);
    expect(error.message).toContain("broken@0.7.2 (npm error E503)");
    expect(error.message).toContain("Re-run the failed job");
  });

  test("a re-run publishes only what is missing", async () => {
    const registry = fakeRegistry({
      a: { onNpm: true },
      b: { onNpm: true },
      c: { visibleAfterMs: MINUTE },
    });

    expect(await run(registry, ["a", "b", "c"])).toHaveLength(3);
    expect(publishes(registry.calls)).toEqual(["publish c"]);
  });

  test("requires the dist-tag to point at the new version", async () => {
    let clock = 0;
    const npm: NpmClient = {
      isPublished: () => Promise.resolve(false),
      publish: () => Promise.resolve({ status: "published" }),
      view: () =>
        Promise.resolve({
          publishedVersion: VERSION,
          distTagVersion: clock >= 30_000 ? VERSION : "0.7.1",
        }),
    };

    const results = await publishAndVerify({
      packages: packagesFor(["a"]),
      tag: TAG,
      version: VERSION,
      npm,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      log: () => undefined,
    });

    expect(results[0]?.distTagVersion).toBe(VERSION);
    expect(clock).toBe(30_000);
  });
});

describe("isAlreadyPublishedError", () => {
  test("matches npm's and Verdaccio's conflict errors", () => {
    expect(
      isAlreadyPublishedError(
        "npm error You cannot publish over the previously published versions: 0.7.1."
      )
    ).toBe(true);
    expect(
      isAlreadyPublishedError(
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/gambi-sdk - You cannot publish over the previously published versions: 0.7.1."
      )
    ).toBe(true);
    expect(
      isAlreadyPublishedError(
        "npm error code EPUBLISHCONFLICT\nnpm error publish fail Cannot publish over existing version."
      )
    ).toBe(true);
  });

  test("does not match other publish errors", () => {
    expect(
      isAlreadyPublishedError(
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/gambi-sdk - You do not have permission to publish"
      )
    ).toBe(false);
    expect(isAlreadyPublishedError("npm error code EOTP")).toBe(false);
  });
});

describe("npm view parsers", () => {
  test("read npm 11 and npm 12 output", () => {
    expect(parseNpmViewVersion('"0.7.1"\n')).toBe("0.7.1");
    expect(parseNpmViewVersion('["0.7.1"]\n')).toBe("0.7.1");
    expect(parseNpmViewVersion("")).toBe("");
    expect(parseNpmViewDistTags('{\n  "latest": "0.7.1"\n}\n')).toEqual({
      latest: "0.7.1",
    });
    expect(
      parseNpmViewDistTags('[\n  {\n    "latest": "0.7.1"\n  }\n]\n')
    ).toEqual({ latest: "0.7.1" });
  });
});
