/**
 * Publishes a group of npm packages, then waits for npm to show all of them.
 *
 * npm accepts a publish minutes before `npm view` lists the new version: in
 * v0.7.1 the binary packages took 3.5 to 4.5 minutes, and the registry serves
 * packuments with `cache-control: max-age=300`. Waiting for each package before
 * publishing the next one added those waits up (about 25 minutes for 8
 * packages). Here every package in the group is published first, then one
 * polling loop checks all of them at once, so the waits overlap.
 *
 * A package is retried in the next round only when its publish failed or npm
 * still does not show it when the round times out. Publishing a version that
 * is already on npm counts as published, so a retry or a re-run is safe.
 */
import { $ } from "bun";

export interface ReleasePackage {
  dir: string;
  name: string;
}

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
  /** Rounds of publish + wait before giving up. */
  maxRounds?: number;
  now?: () => number;
  npm?: NpmClient;
  packages: ReleasePackage[];
  pollIntervalMs?: number;
  /** How long one round waits for npm to show the packages it published. */
  roundTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  tag: string;
  version: string;
}

export const DEFAULT_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_ROUND_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_ROUNDS = 3;

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

export const npmCli: NpmClient = {
  async isPublished(name, version) {
    const result = await $`npm view ${`${name}@${version}`} version --json`
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
    const result = await $`npm publish --access public --tag ${tag}`
      .cwd(pkg.dir)
      .nothrow();
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
      await $`npm view ${`${name}@${version}`} version --json`.quiet().text()
    );
    const distTags = parseNpmViewDistTags(
      await $`npm view ${name} dist-tags --json`.quiet().text()
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
  roundTimeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  tag: string;
  verified: Map<string, NpmVerificationResult>;
  version: string;
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

/** Publishes each package in order and returns the ones npm accepted. */
async function publishAll(state: RunState, packages: ReleasePackage[]) {
  const accepted: ReleasePackage[] = [];
  for (const pkg of packages) {
    const label = `${pkg.name}@${state.version}`;
    const outcome = await publishOne(state, pkg);

    if (outcome.status === "failed") {
      state.lastError.set(pkg.name, `publish failed: ${outcome.error}`);
      state.log(`  ✗ ${label}: publish failed: ${lastLines(outcome.error, 1)}`);
      continue;
    }

    state.log(
      outcome.status === "published"
        ? `  ↑ ${label} published`
        : `  = ${label} is already on npm; not publishing again`
    );
    accepted.push(pkg);
  }
  return accepted;
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

/** Polls all packages together until npm shows them or the round times out. */
async function waitUntilVisible(state: RunState, packages: ReleasePackage[]) {
  const roundStart = state.now();
  const deadline = roundStart + state.roundTimeoutMs;
  let waiting = packages;

  while (waiting.length > 0) {
    const visible = await Promise.all(
      waiting.map((pkg) => checkVisible(state, pkg))
    );
    const elapsedSeconds = Math.round((state.now() - roundStart) / 1000);
    for (const [index, pkg] of waiting.entries()) {
      if (visible[index]) {
        state.log(
          `  ✓ ${pkg.name}@${state.version} visible on npm (${elapsedSeconds}s)`
        );
      }
    }

    waiting = waiting.filter((_, index) => !visible[index]);
    if (waiting.length === 0 || state.now() >= deadline) {
      return;
    }

    state.log(
      `  waiting for npm to show ${waiting.map((pkg) => pkg.name).join(", ")} (${elapsedSeconds}s of ${Math.round(state.roundTimeoutMs / 1000)}s)`
    );
    await state.sleep(state.pollIntervalMs);
  }
}

export async function publishAndVerify(
  options: PublishAndVerifyOptions
): Promise<NpmVerificationResult[]> {
  const { packages, maxRounds = DEFAULT_MAX_ROUNDS } = options;
  const state: RunState = {
    tag: options.tag,
    version: options.version,
    npm: options.npm ?? npmCli,
    log: options.log ?? console.log,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? Bun.sleep,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    roundTimeoutMs: options.roundTimeoutMs ?? DEFAULT_ROUND_TIMEOUT_MS,
    verified: new Map(),
    lastError: new Map(),
  };
  const notVerified = () =>
    packages.filter((pkg) => !state.verified.has(pkg.name));
  const verifiedInOrder = () =>
    packages.flatMap((pkg) => {
      const result = state.verified.get(pkg.name);
      return result ? [result] : [];
    });

  for (let round = 1; round <= maxRounds; round++) {
    const pending = notVerified();
    if (pending.length === 0) {
      break;
    }
    if (round > 1) {
      state.log(
        `\nRound ${round}/${maxRounds}: retrying ${pending.map((pkg) => pkg.name).join(", ")}`
      );
      await state.sleep(state.pollIntervalMs);
    }

    // Publish every pending package first, then wait for all of them at once.
    const accepted = await publishAll(state, pending);
    await waitUntilVisible(state, accepted);
  }

  const missing = notVerified();
  if (missing.length > 0) {
    const details = missing
      .map(
        (pkg) =>
          `${pkg.name}@${state.version} (${state.lastError.get(pkg.name)})`
      )
      .join("; ");
    throw new NpmReleaseError(
      `npm does not show ${details} after ${maxRounds} rounds`,
      verifiedInOrder()
    );
  }

  return verifiedInOrder();
}
