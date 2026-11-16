/**
 * How this copy of `gambi` gets updated. `resolveUpdatePlan` looks at the
 * installation and answers with the plan; `commands/self.ts` shows it or
 * carries it out.
 */
import type { Installation } from "./installation.ts";

export const PACKAGE_MANAGERS = ["bun", "npm"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Installed through a package manager: that package manager updates it. */
export interface PackageManagerUpdatePlan {
  readonly args: readonly string[];
  /** The plan as one line a person can read, or run. */
  readonly command: string;
  readonly kind: "package-manager";
  readonly manager: PackageManager;
}

export type StandalonePlatform = "darwin" | "linux" | "win32";

/** A binary from a GitHub release: download the new one and replace the file. */
export interface StandaloneUpdatePlan {
  /** The file of the release for this platform and architecture. */
  readonly assetName: string;
  /** The file to replace: the running executable. */
  readonly binaryPath: string;
  /** The plan as one line a person can read. */
  readonly command: string;
  readonly downloadUrl: string;
  readonly kind: "standalone";
  readonly platform: StandalonePlatform;
}

export type UpdatePlan = PackageManagerUpdatePlan | StandaloneUpdatePlan;

const PACKAGE_NAME = "gambi";

export const DEFAULT_RELEASE_BASE_URL =
  "https://github.com/arthurbm/gambi/releases/latest/download";

interface ReleasedBinary {
  readonly assetName: string;
  /** The name the install script gives the file. */
  readonly binaryName: string;
}

/** The binaries a release carries (`packages/cli/build.ts`). */
const RELEASED_BINARIES: Record<
  StandalonePlatform,
  Readonly<Record<string, ReleasedBinary>>
> = {
  darwin: {
    arm64: { assetName: "gambi-darwin-arm64", binaryName: "gambi" },
    x64: { assetName: "gambi-darwin-x64", binaryName: "gambi" },
  },
  linux: {
    arm64: { assetName: "gambi-linux-arm64", binaryName: "gambi" },
    x64: { assetName: "gambi-linux-x64", binaryName: "gambi" },
  },
  win32: {
    x64: { assetName: "gambi-windows-x64.exe", binaryName: "gambi.exe" },
  },
};

const isStandalonePlatform = (
  platform: string
): platform is StandalonePlatform => Object.hasOwn(RELEASED_BINARIES, platform);

const packageManagerPlan = (
  manager: PackageManager
): PackageManagerUpdatePlan => {
  const args =
    manager === "bun"
      ? ["add", "-g", `${PACKAGE_NAME}@latest`]
      : ["install", "-g", `${PACKAGE_NAME}@latest`];
  return {
    kind: "package-manager",
    manager,
    args,
    command: [manager, ...args].join(" "),
  };
};

const isPackageManager = (value: string): value is PackageManager =>
  (PACKAGE_MANAGERS as readonly string[]).includes(value);

/** Windows separators and letter case never decide where gambi is installed. */
const normalizePath = (path: string): string =>
  path.replaceAll("\\", "/").toLowerCase();

/**
 * A platform package of the npm distribution (`gambi-linux-x64`), as it shows
 * in the path of the executable or in the path Bun gives a compiled binary
 * (`/$bunfs/root/gambi-linux-x64`).
 */
const PLATFORM_PACKAGE_PATTERN =
  /(?:^|\/)gambi-(?:linux|darwin|windows)-(?:x64|arm64)(?:\/|\.exe(?:$|\/)|$)/;

const WHITESPACE_PATTERN = /\s+/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

const isInsideBunGlobalFolder = (path: string): boolean =>
  path.includes("/.bun/install/global/");

const isInsideNpmPackage = (path: string): boolean =>
  path.includes(`/node_modules/${PACKAGE_NAME}/`) ||
  path.includes(`/node_modules/${PACKAGE_NAME}-`) ||
  path.includes(`/$bunfs/root/${PACKAGE_NAME}-`) ||
  PLATFORM_PACKAGE_PATTERN.test(path);

const packageManagerOfPaths = (
  paths: readonly string[]
): PackageManager | undefined => {
  const normalized = paths.map(normalizePath);
  if (normalized.some(isInsideBunGlobalFolder)) {
    return "bun";
  }
  return normalized.some(isInsideNpmPackage) ? "npm" : undefined;
};

/** The first product of `npm_config_user_agent`: `bun/1.3.10 npm/? ...`. */
const packageManagerOfUserAgent = (
  userAgent: string | undefined
): PackageManager | undefined => {
  const name = userAgent
    ?.trim()
    .split(WHITESPACE_PATTERN)[0]
    ?.split("/")[0]
    ?.toLowerCase();
  return name !== undefined && isPackageManager(name) ? name : undefined;
};

/**
 * The plan for an executable that is a released binary on its own: named as
 * the install script names it, outside any package, on a platform a release
 * has a binary for.
 */
const standalonePlan = (
  { arch, execPath, platform }: Installation["Service"],
  releaseBaseUrl: string
): StandaloneUpdatePlan | undefined => {
  if (!isStandalonePlatform(platform)) {
    return;
  }
  const binary = RELEASED_BINARIES[platform][arch];
  const path = normalizePath(execPath);
  if (
    binary === undefined ||
    isInsideBunGlobalFolder(path) ||
    isInsideNpmPackage(path) ||
    !path.endsWith(`/${binary.binaryName}`)
  ) {
    return;
  }
  return {
    kind: "standalone",
    platform,
    binaryPath: execPath,
    assetName: binary.assetName,
    downloadUrl: `${releaseBaseUrl.replace(TRAILING_SLASHES_PATTERN, "")}/${binary.assetName}`,
    command: `download ${binary.assetName} and replace ${execPath}`,
  };
};

export interface UpdatePlanInput {
  readonly installation: Installation["Service"];
  /** `--manager`: the package manager the person asked for. */
  readonly manager: PackageManager | undefined;
  /** Where the binaries of the release are served from. */
  readonly releaseBaseUrl: string;
  /** `npm_config_user_agent`, which a package manager sets on what it runs. */
  readonly userAgent: string | undefined;
}

/**
 * The plan for this installation, or `undefined` when nothing tells how it
 * was installed. In order: `--manager`, an executable inside a package, a
 * standalone binary, the arguments of the process, and the user agent of the
 * package manager.
 *
 * The arguments come after the standalone binary because Bun gives every
 * compiled binary an internal path that looks like the npm platform package.
 */
export const resolveUpdatePlan = ({
  installation,
  manager,
  releaseBaseUrl,
  userAgent,
}: UpdatePlanInput): UpdatePlan | undefined => {
  const installedBy = manager ?? packageManagerOfPaths([installation.execPath]);
  if (installedBy !== undefined) {
    return packageManagerPlan(installedBy);
  }
  const standalone = standalonePlan(installation, releaseBaseUrl);
  if (standalone !== undefined) {
    return standalone;
  }
  const ranBy =
    packageManagerOfPaths(installation.argv) ??
    packageManagerOfUserAgent(userAgent);
  return ranBy === undefined ? undefined : packageManagerPlan(ranBy);
};
