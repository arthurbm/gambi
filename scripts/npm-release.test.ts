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

type Behavior =
  /** Publishes; npm shows it `visibleAfterMs` later. */
  | { kind: "ok"; visibleAfterMs: number }
  /** Already on npm before the run starts. */
  | { kind: "on-npm" }
  /** On npm, but `npm view` cannot see it yet (stale packument). */
  | { kind: "hidden"; visibleAfterMs: number }
  /** The first `failures` publishes fail, then it behaves like "ok". */
  | { kind: "flaky"; failures: number; visibleAfterMs: number }
  /** npm accepts it and never shows it. */
  | { kind: "never" };

/**
 * An in-memory npm registry with a fake clock: publishes take `publishMs`,
 * versions show up in `npm view` only after their delay, and publishing a
 * version that exists fails the way npm does.
 */
function fakeRegistry(behaviors: Record<string, Behavior>, publishMs = 5000) {
  let clock = 0;
  const visibleAt = new Map<string, number>();
  const failuresLeft = new Map<string, number>();
  const calls: string[] = [];

  for (const [name, behavior] of Object.entries(behaviors)) {
    if (behavior.kind === "on-npm") {
      visibleAt.set(name, 0);
    }
    if (behavior.kind === "hidden") {
      visibleAt.set(name, behavior.visibleAfterMs);
    }
    if (behavior.kind === "flaky") {
      failuresLeft.set(name, behavior.failures);
    }
  }

  const isVisible = (name: string) => {
    const at = visibleAt.get(name);
    return at !== undefined && clock >= at;
  };

  const npm: NpmClient = {
    isPublished(name) {
      calls.push(`check ${name}`);
      return Promise.resolve(isVisible(name));
    },
    publish(pkg): Promise<PublishOutcome> {
      calls.push(`publish ${pkg.name}`);
      clock += publishMs;
      const behavior = behaviors[pkg.name];
      if (!behavior) {
        throw new Error(`no behavior for ${pkg.name}`);
      }
      if (visibleAt.has(pkg.name)) {
        // Real npm: E403 "You cannot publish over the previously published
        // versions", which the client maps to already-published.
        return Promise.resolve({ status: "already-published" });
      }
      const left = failuresLeft.get(pkg.name) ?? 0;
      if (left > 0) {
        failuresLeft.set(pkg.name, left - 1);
        return Promise.resolve({
          status: "failed",
          error: "npm error code E503",
        });
      }
      if (behavior.kind === "never") {
        visibleAt.set(pkg.name, Number.POSITIVE_INFINITY);
      } else if (behavior.kind === "ok" || behavior.kind === "flaky") {
        visibleAt.set(pkg.name, clock + behavior.visibleAfterMs);
      }
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

function packagesFor(names: string[]): ReleasePackage[] {
  return names.map((name) => ({ name, dir: `/fake/${name}` }));
}

function run(
  registry: ReturnType<typeof fakeRegistry>,
  names: string[],
  logs: string[] = []
) {
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

describe("publishAndVerify", () => {
  test("publishes every package before waiting, then waits for all at once", async () => {
    const registry = fakeRegistry({
      a: { kind: "ok", visibleAfterMs: 60_000 },
      b: { kind: "ok", visibleAfterMs: 270_000 },
      c: { kind: "ok", visibleAfterMs: 200_000 },
    });

    const results = await run(registry, ["a", "b", "c"]);

    expect(results.map((result) => result.packageName)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(results.every((result) => result.verified)).toBe(true);
    // All publishes happen before the first `npm view`.
    const firstView = registry.calls.findIndex((call) =>
      call.startsWith("view ")
    );
    expect(publishes(registry.calls.slice(0, firstView))).toEqual([
      "publish a",
      "publish b",
      "publish c",
    ]);
    // The waits overlap: total ≈ 3 publishes + the slowest wait (b, 270 s
    // after it was published at 10 s), not the sum of the waits.
    expect(registry.now()).toBeLessThanOrEqual(10_000 + 270_000 + 15_000);
  });

  test("does not publish a version that is already on npm", async () => {
    const registry = fakeRegistry({
      a: { kind: "on-npm" },
      b: { kind: "ok", visibleAfterMs: 30_000 },
    });

    const results = await run(registry, ["a", "b"]);

    expect(results).toHaveLength(2);
    expect(publishes(registry.calls)).toEqual(["publish b"]);
  });

  test("treats an 'already published' publish error as published", async () => {
    // npm view cannot see it yet, so the pre-check says "not on npm" and the
    // publish fails with the conflict error.
    const registry = fakeRegistry({
      a: { kind: "hidden", visibleAfterMs: 45_000 },
    });
    const logs: string[] = [];

    const results = await run(registry, ["a"], logs);

    expect(results[0]?.verified).toBe(true);
    expect(publishes(registry.calls)).toEqual(["publish a"]);
    expect(logs.join("\n")).toContain("already on npm");
    expect(logs.join("\n")).not.toContain("Round 2");
  });

  test("retries only the package whose publish failed", async () => {
    const registry = fakeRegistry({
      a: { kind: "ok", visibleAfterMs: 60_000 },
      b: { kind: "flaky", failures: 1, visibleAfterMs: 60_000 },
      c: { kind: "ok", visibleAfterMs: 60_000 },
    });
    const logs: string[] = [];

    const results = await run(registry, ["a", "b", "c"], logs);

    expect(results.map((result) => result.packageName)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(publishes(registry.calls)).toEqual([
      "publish a",
      "publish b",
      "publish c",
      "publish b",
    ]);
    expect(logs.join("\n")).toContain("Round 2/3: retrying b");
  });

  test("publishes again a package npm still does not show when the round times out", async () => {
    const registry = fakeRegistry({
      a: { kind: "ok", visibleAfterMs: 30_000 },
      // Shows up 12 minutes after publish: past the 10-minute round.
      slow: { kind: "ok", visibleAfterMs: 12 * 60_000 },
    });
    const logs: string[] = [];

    const results = await run(registry, ["a", "slow"], logs);

    expect(results).toHaveLength(2);
    // Round 2 publishes `slow` again; npm answers "already published", and
    // the next poll sees it.
    expect(publishes(registry.calls)).toEqual([
      "publish a",
      "publish slow",
      "publish slow",
    ]);
    expect(logs.join("\n")).toContain("Round 2/3: retrying slow");
    expect(logs.join("\n")).toContain("slow@0.7.2 is already on npm");
  });

  test("fails with the missing packages and keeps the verified ones", async () => {
    const registry = fakeRegistry({
      a: { kind: "ok", visibleAfterMs: 30_000 },
      lost: { kind: "never" },
      broken: { kind: "flaky", failures: 99, visibleAfterMs: 0 },
    });

    const error = await run(registry, ["a", "lost", "broken"]).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(NpmReleaseError);
    const releaseError = error as NpmReleaseError;
    expect(releaseError.message).toContain("lost@0.7.2 (npm view: E404)");
    expect(releaseError.message).toContain(
      "broken@0.7.2 (publish failed: npm error code E503)"
    );
    expect(releaseError.verified.map((result) => result.packageName)).toEqual([
      "a",
    ]);
    expect(publishes(registry.calls)).toEqual([
      "publish a",
      "publish lost",
      "publish broken",
      "publish lost",
      "publish broken",
      "publish lost",
      "publish broken",
    ]);
  });

  test("requires the dist-tag to point at the new version", async () => {
    let tagMoved = false;
    let clock = 0;
    const npm: NpmClient = {
      isPublished: () => Promise.resolve(false),
      publish: () => Promise.resolve({ status: "published" }),
      view: () =>
        Promise.resolve({
          publishedVersion: VERSION,
          distTagVersion: tagMoved ? VERSION : "0.7.1",
        }),
    };

    const result = publishAndVerify({
      packages: packagesFor(["a"]),
      tag: TAG,
      version: VERSION,
      npm,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        tagMoved = clock >= 30_000;
        return Promise.resolve();
      },
      log: () => undefined,
    });

    expect((await result)[0]?.distTagVersion).toBe(VERSION);
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

describe("parseNpmViewVersion", () => {
  test("reads npm 11 and npm 12 output", () => {
    expect(parseNpmViewVersion('"0.7.1"\n')).toBe("0.7.1");
    expect(parseNpmViewVersion('["0.7.1"]\n')).toBe("0.7.1");
    expect(parseNpmViewVersion("")).toBe("");
  });
});

describe("parseNpmViewDistTags", () => {
  test("reads npm 11 and npm 12 output", () => {
    expect(parseNpmViewDistTags('{\n  "latest": "0.7.1"\n}\n')).toEqual({
      latest: "0.7.1",
    });
    expect(
      parseNpmViewDistTags('[\n  {\n    "latest": "0.7.1"\n  }\n]\n')
    ).toEqual({ latest: "0.7.1" });
  });
});
