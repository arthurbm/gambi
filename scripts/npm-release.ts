/**
 * Publishes a group of npm packages, then waits for npm to show all of them.
 *
 * npm records a version minutes after `npm publish` returns: in v0.7.1, from
 * 58 s (`gambi-sdk`) to 4.4 minutes (the binaries). Waiting for each package
 * before publishing the next one added those waits up (about 25 minutes for
 * 8 packages). Here every package in the group is published first, then one
 * polling loop checks all of them at once, so the waits overlap.
 *
 * Each package is published at most once per run. A package that npm does not
 * show before the timeout is not published again: the registry may still be
 * processing it, and a second upload of a 50 MB tarball can fail in a way that
 * hides a healthy publish. Re-running the job resumes instead: it skips every
 * version that is already on npm.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

/** Published from `tarball` with scripts off, or from `dir` with scripts. */
export type ReleasePackage =
  | { dir: string; name: string; tarball?: undefined }
  | { dir?: undefined; name: string; tarball: string };

export interface NpmVerificationResult {
  distTagVersion: string;
  packageName: string;
  publishedVersion: string;
  tag: string;
  verified: boolean;
}

export type PublishOutcome =
  | { status: "published" }
  | { status: "already-published" }
  | { status: "failed"; error: string };

export interface NpmView {
  distTagVersion: string;
  publishedVersion: string;
}

export interface NpmClient {
  /** True when `name@version` is already on npm. Throws when npm cannot tell. */
  isPublished(name: string, version: string): Promise<boolean>;
  publish(pkg: ReleasePackage, tag: string): Promise<PublishOutcome>;
  /** What npm shows for `name@version` and the dist-tag. Throws on 404. */
  view(name: string, version: string, tag: string): Promise<NpmView>;
}

export interface PublishAndVerifyOptions {
  log?: (message: string) => void;
  now?: () => number;
  npm?: NpmClient;
  /** Published in this order. */
  packages: ReleasePackage[];
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  tag: string;
  version: string;
  /** How long to wait for npm to show every package of the group. */
  waitTimeoutMs?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60_000;

export class NpmReleaseError extends Error {
  readonly verified: NpmVerificationResult[];

  constructor(message: string, verified: NpmVerificationResult[]) {
    super(message);
    this.name = "NpmReleaseError";
    this.verified = verified;
  }
}

// npm 12 prints `["x.y.z"]` for `npm view <pkg>@<version> version --json`;
// older npm prints `"x.y.z"`.
export function parseNpmViewVersion(output: string) {
  const text = output.trim();
  if (text === "") {
    return "";
  }

  const parsed = JSON.parse(text) as string | string[];
  return Array.isArray(parsed) ? (parsed.at(-1) ?? "") : parsed;
}

// Same for `npm view <pkg> dist-tags --json`: npm 12 wraps the object in an
// array.
export function parseNpmViewDistTags(output: string) {
  const parsed = JSON.parse(output.trim()) as
    | Record<string, string>
    | Record<string, string>[];
  return (Array.isArray(parsed) ? parsed.at(-1) : parsed) ?? {};
}

// npm checks the packument before uploading and throws "You cannot publish
// over the previously published versions"; the registry answers a stale
// client with E403 and the same text. Other registries (Verdaccio) answer
// EPUBLISHCONFLICT.
const ALREADY_PUBLISHED_PATTERN =
  /EPUBLISHCONFLICT|cannot publish over the previously published version/i;

export function isAlreadyPublishedError(output: string) {
  return ALREADY_PUBLISHED_PATTERN.test(output);
}

function lastLines(output: string, count: number) {
  return output.trim().split("\n").slice(-count).join("\n");
}

async function runPublish(pkg: ReleasePackage, tag: string) {
  if (pkg.tarball !== undefined) {
    // From an empty directory, so no project config can change the registry.
    const cwd = await mkdtemp(join(tmpdir(), "gambi-publish-"));
    return await $`npm publish ${pkg.tarball} --access public --tag ${tag} --ignore-scripts`
      .cwd(cwd)
      .nothrow();
  }
  // gambi-sdk and gambi-tui build in prepublishOnly.
  return await $`npm publish --access public --tag ${tag}`
    .cwd(pkg.dir)
    .nothrow();
}

export const npmCli: NpmClient = {
  async isPublished(name, version) {
    const result =
      await $`npm view --prefer-online ${`${name}@${version}`} version --json`
        .quiet()
        .nothrow();
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;

    if (result.exitCode === 0) {
      return parseNpmViewVersion(result.stdout.toString()) === version;
    }

    if (output.includes("E404")) {
      return false;
    }

    throw new Error(
      `Could not check whether ${name}@${version} is on npm: ${output.trim()}`
    );
  },

  async publish(pkg, tag) {
    const result = await runPublish(pkg, tag);
    if (result.exitCode === 0) {
      return { status: "published" };
    }

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    if (isAlreadyPublishedError(output)) {
      return { status: "already-published" };
    }

    return {
      status: "failed",
      error: `npm publish exited with ${result.exitCode}: ${lastLines(output, 5)}`,
    };
  },

  async view(name, version, tag) {
    const publishedVersion = parseNpmViewVersion(
      await $`npm view --prefer-online ${`${name}@${version}`} version --json`
        .quiet()
        .text()
    );
    const distTags = parseNpmViewDistTags(
      await $`npm view --prefer-online ${name} dist-tags --json`.quiet().text()
    );

    return { publishedVersion, distTagVersion: distTags[tag] ?? "" };
  },
};

function errorMessage(error: unknown) {
  if (error instanceof $.ShellError) {
    return `exit ${error.exitCode}: ${lastLines(error.stderr.toString(), 2)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

interface RunState {
  lastError: Map<string, string>;
  log: (message: string) => void;
  now: () => number;
  npm: NpmClient;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  tag: string;
  verified: Map<string, NpmVerificationResult>;
  version: string;
  waitTimeoutMs: number;
}

async function publishOne(
  state: RunState,
  pkg: ReleasePackage
): Promise<PublishOutcome> {
  try {
    return (await state.npm.isPublished(pkg.name, state.version))
      ? { status: "already-published" }
      : await state.npm.publish(pkg, state.tag);
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

/** Publishes each package once, in order, and returns the ones that failed. */
async function publishAll(state: RunState, packages: ReleasePackage[]) {
  const failed: string[] = [];
  for (const pkg of packages) {
    const label = `${pkg.name}@${state.version}`;
    const outcome = await publishOne(state, pkg);

    if (outcome.status === "failed") {
      failed.push(`${label} (${outcome.error})`);
      state.log(`  ✗ ${label}: publish failed: ${lastLines(outcome.error, 1)}`);
      continue;
    }

    state.log(
      outcome.status === "published"
        ? `  ↑ ${label} published`
        : `  = ${label} is already on npm; not publishing again`
    );
  }
  return failed;
}

/** One `npm view` check; records the result in `verified` or `lastError`. */
async function checkVisible(state: RunState, pkg: ReleasePackage) {
  const { tag, version } = state;
  try {
    const view = await state.npm.view(pkg.name, version, tag);
    if (view.publishedVersion === version && view.distTagVersion === version) {
      state.verified.set(pkg.name, {
        packageName: pkg.name,
        tag,
        publishedVersion: view.publishedVersion,
        distTagVersion: view.distTagVersion,
        verified: true,
      });
      state.lastError.delete(pkg.name);
      return true;
    }
    state.lastError.set(
      pkg.name,
      `npm shows version=${view.publishedVersion || "none"}, ${tag}=${view.distTagVersion || "none"}`
    );
  } catch (error) {
    state.lastError.set(pkg.name, `npm view: ${errorMessage(error)}`);
  }
  return false;
}

/** Polls all packages together until npm shows them or the wait times out. */
async function waitUntilVisible(state: RunState, packages: ReleasePackage[]) {
  const start = state.now();
  const deadline = start + state.waitTimeoutMs;
  let waiting = packages;

  while (waiting.length > 0) {
    const visible = await Promise.all(
      waiting.map((pkg) => checkVisible(state, pkg))
    );
    const elapsedSeconds = Math.round((state.now() - start) / 1000);
    for (const [index, pkg] of waiting.entries()) {
      if (visible[index]) {
        state.log(
          `  ✓ npm shows ${pkg.name}@${state.version} (${elapsedSeconds}s)`
        );
      }
    }

    waiting = waiting.filter((_, index) => !visible[index]);
    if (waiting.length === 0 || state.now() >= deadline) {
      return waiting;
    }

    state.log(
      `  waiting for npm to show ${waiting.map((pkg) => pkg.name).join(", ")} (${elapsedSeconds}s of ${Math.round(state.waitTimeoutMs / 1000)}s)`
    );
    await state.sleep(state.pollIntervalMs);
  }
  return waiting;
}

export async function publishAndVerify(
  options: PublishAndVerifyOptions
): Promise<NpmVerificationResult[]> {
  const { packages } = options;
  const state: RunState = {
    tag: options.tag,
    version: options.version,
    npm: options.npm ?? npmCli,
    log: options.log ?? console.log,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? Bun.sleep,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    waitTimeoutMs: options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    verified: new Map(),
    lastError: new Map(),
  };
  const verifiedInOrder = () =>
    packages.flatMap((pkg) => {
      const result = state.verified.get(pkg.name);
      return result ? [result] : [];
    });

  const failed = await publishAll(state, packages);
  if (failed.length > 0) {
    throw new NpmReleaseError(
      `npm publish failed for ${failed.join("; ")}. Re-run the failed job: it skips the versions already on npm.`,
      verifiedInOrder()
    );
  }

  const missing = await waitUntilVisible(state, packages);
  if (missing.length > 0) {
    const details = missing
      .map(
        (pkg) =>
          `${pkg.name}@${state.version} (${state.lastError.get(pkg.name)})`
      )
      .join("; ");
    throw new NpmReleaseError(
      `npm does not show ${details} after ${Math.round(state.waitTimeoutMs / 1000)} s. npm accepted the publish and may still be processing it, so this is not a failed publish: re-run the failed job later; it skips the versions npm shows by then.`,
      verifiedInOrder()
    );
  }

  return verifiedInOrder();
}
