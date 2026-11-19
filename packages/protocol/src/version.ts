/**
 * The Gambi version this code was built from, and the rule that decides
 * whether a hub and a participant runtime can share a tunnel.
 *
 * The tunnel speaks the wire format of `effect/rpc`, which has no version
 * field (ADR-0007). So registration carries the participant's version and the
 * hub refuses a different minor.
 */
import manifest from "../package.json";

/**
 * The version of this build. Every Gambi package is released with the same
 * version (ADR-0005), and this package is embedded in the CLI and in the SDK,
 * so it is the version of whatever runs it.
 */
export const GAMBI_VERSION: string = manifest.version;

const MAJOR_MINOR = /^(\d+)\.(\d+)\./;

/** `"0.8"` for `"0.8.3"`; `undefined` for anything that is not `x.y.z`. */
export const minorOf = (version: string): string | undefined => {
  const match = MAJOR_MINOR.exec(version);
  return match === null ? undefined : `${match[1]}.${match[2]}`;
};

/**
 * Whether two versions share major and minor, which is what a tunnel needs.
 * A version that is not `x.y.z` is compatible with nothing.
 */
export const sameMinor = (left: string, right: string): boolean => {
  const minor = minorOf(left);
  return minor !== undefined && minor === minorOf(right);
};
