import { spawn } from "node:child_process";
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export type SupportedPackageManager = "bun" | "npm";

type StandaloneTargetPlatform = "darwin" | "linux" | "win32";
type StandaloneTargetArch = "arm64" | "x64";

interface StandaloneTarget {
  assetName: string;
  binaryName: string;
}

export interface PackageManagerUpdatePlan {
  args: string[];
  command: string;
  kind: "package-manager";
  manager: SupportedPackageManager;
}

export interface StandaloneUpdatePlan {
  assetName: string;
  binaryPath: string;
  command: string;
  downloadUrl: string;
  kind: "standalone";
  platform: StandaloneTargetPlatform;
}

export type UpdatePlan = PackageManagerUpdatePlan | StandaloneUpdatePlan;

export interface StandaloneUpdateResult {
  kind: "scheduled" | "updated";
}

interface DetectInstallSourceOptions {
  arch?: string;
  argv?: string[];
  execPath?: string;
  manager?: string | null;
  platform?: NodeJS.Platform;
  releaseBaseUrl?: string | null;
  userAgent?: string | null;
}

const PACKAGE_NAME = "gambi";
const REPO = "arthurbm/gambi";
const DEFAULT_RELEASE_BASE_URL = `https://github.com/${REPO}/releases/latest/download`;
const MANUAL_UPDATE_COMMANDS = {
  packageManagers: ["bun add -g gambi@latest", "npm install -g gambi@latest"],
  standalone: {
    posix:
      "curl -fsSL https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.sh | bash",
    windows:
      'powershell -Command "irm https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.ps1 | iex"',
  },
} as const;
const STANDALONE_RELEASE_TARGETS: Record<
  StandaloneTargetPlatform,
  Partial<Record<StandaloneTargetArch, StandaloneTarget>>
> = {
  darwin: {
    arm64: {
      assetName: "gambi-darwin-arm64",
      binaryName: "gambi",
    },
    x64: {
      assetName: "gambi-darwin-x64",
      binaryName: "gambi",
    },
  },
  linux: {
    arm64: {
      assetName: "gambi-linux-arm64",
      binaryName: "gambi",
    },
    x64: {
      assetName: "gambi-linux-x64",
      binaryName: "gambi",
    },
  },
  win32: {
    x64: {
      assetName: "gambi-windows-x64.exe",
      binaryName: "gambi.exe",
    },
  },
};
const WHITESPACE_PATTERN = /\s+/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

/** Resolves execPath and Bun single-file argv entries like `/$bunfs/root/gambi-linux-x64`. */
const NPM_GAMBI_PLATFORM_PACKAGE_RE =
  /(?:^|[\\/])gambi-(linux|darwin|windows)-(x64|arm64)(?:[\\/]|\.exe(?:$|[\\/])|$)/;

function normalizePath(pathname: string) {
  return pathname.replaceAll("\\", "/").toLowerCase();
}

function isSupportedPackageManager(
  value: string
): value is SupportedPackageManager {
  return value === "bun" || value === "npm";
}

function resolveStandaloneTarget(
  platform: NodeJS.Platform,
  arch: string
): StandaloneTarget | null {
  if (!(platform in STANDALONE_RELEASE_TARGETS)) {
    return null;
  }

  const targets =
    STANDALONE_RELEASE_TARGETS[platform as StandaloneTargetPlatform];
  const target = targets[arch as StandaloneTargetArch];
  return target ?? null;
}

function isStandaloneExecutablePath(pathname: string, binaryName: string) {
  const normalizedPath = normalizePath(pathname);
  const normalizedBinaryName = binaryName.toLowerCase();

  if (
    normalizedPath.includes("/.bun/install/global/") ||
    normalizedPath.includes(`/node_modules/${PACKAGE_NAME}/`) ||
    normalizedPath.includes(`/node_modules/${PACKAGE_NAME}-`) ||
    normalizedPath.includes("/$bunfs/root/gambi-") ||
    NPM_GAMBI_PLATFORM_PACKAGE_RE.test(normalizedPath)
  ) {
    return false;
  }

  return normalizedPath.endsWith(`/${normalizedBinaryName}`);
}

export function normalizePackageManager(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isSupportedPackageManager(normalized) ? normalized : null;
}

function detectPackageManagerFromUserAgent(userAgent?: string | null) {
  const entry = userAgent?.trim().split(WHITESPACE_PATTERN)[0];
  const candidate = entry?.split("/")[0];
  return normalizePackageManager(candidate);
}

function pathLooksLikeNpmGambiPlatformLayout(pathname: string): boolean {
  const normalizedPath = normalizePath(pathname);
  if (normalizedPath.includes("/$bunfs/root/gambi-")) {
    return true;
  }
  return NPM_GAMBI_PLATFORM_PACKAGE_RE.test(normalizedPath);
}

function detectPackageManagerFromPaths(paths: string[]) {
  const normalizedPaths = paths.map(normalizePath);

  if (
    normalizedPaths.some((pathname) =>
      pathname.includes("/.bun/install/global/")
    )
  ) {
    return "bun" satisfies SupportedPackageManager;
  }

  if (
    normalizedPaths.some(
      (pathname) =>
        pathname.includes(`/node_modules/${PACKAGE_NAME}/`) ||
        pathname.includes(`/node_modules/${PACKAGE_NAME}-`) ||
        pathLooksLikeNpmGambiPlatformLayout(pathname)
    )
  ) {
    return "npm" satisfies SupportedPackageManager;
  }

  return null;
}

export function detectPackageManager(options: DetectInstallSourceOptions = {}) {
  const explicitManager = normalizePackageManager(options.manager);
  if (explicitManager) {
    return explicitManager;
  }

  const execPathManager = detectPackageManagerFromPaths([
    options.execPath ?? process.execPath,
  ]);
  if (execPathManager) {
    return execPathManager;
  }

  const argvManager = detectPackageManagerFromPaths(
    options.argv ?? process.argv
  );
  if (argvManager) {
    return argvManager;
  }

  return detectPackageManagerFromUserAgent(
    options.userAgent ?? process.env.npm_config_user_agent
  );
}

function detectStandaloneBinaryPath(options: DetectInstallSourceOptions) {
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveStandaloneTarget(platform, arch);

  if (!target) {
    return null;
  }

  if (!isStandaloneExecutablePath(execPath, target.binaryName)) {
    return null;
  }

  return {
    binaryPath: execPath,
    platform: platform as StandaloneTargetPlatform,
    target,
  };
}

export function resolveUpdatePlan(options: DetectInstallSourceOptions = {}) {
  const explicitManager = normalizePackageManager(options.manager);
  if (explicitManager) {
    const args =
      explicitManager === "bun"
        ? ["add", "-g", `${PACKAGE_NAME}@latest`]
        : ["install", "-g", `${PACKAGE_NAME}@latest`];

    return {
      kind: "package-manager",
      manager: explicitManager,
      args,
      command: [explicitManager, ...args].join(" "),
    } satisfies PackageManagerUpdatePlan;
  }

  const execPathManager = detectPackageManagerFromPaths([
    options.execPath ?? process.execPath,
  ]);
  if (execPathManager) {
    const args =
      execPathManager === "bun"
        ? ["add", "-g", `${PACKAGE_NAME}@latest`]
        : ["install", "-g", `${PACKAGE_NAME}@latest`];

    return {
      kind: "package-manager",
      manager: execPathManager,
      args,
      command: [execPathManager, ...args].join(" "),
    } satisfies PackageManagerUpdatePlan;
  }

  const standaloneTarget = detectStandaloneBinaryPath(options);
  if (standaloneTarget) {
    const releaseBaseUrl = (
      options.releaseBaseUrl ??
      process.env.GAMBI_UPDATE_BASE_URL ??
      DEFAULT_RELEASE_BASE_URL
    ).replace(TRAILING_SLASHES_PATTERN, "");

    return {
      kind: "standalone",
      platform: standaloneTarget.platform,
      binaryPath: standaloneTarget.binaryPath,
      assetName: standaloneTarget.target.assetName,
      downloadUrl: `${releaseBaseUrl}/${standaloneTarget.target.assetName}`,
      command: `download ${standaloneTarget.target.assetName} and replace ${standaloneTarget.binaryPath}`,
    } satisfies StandaloneUpdatePlan;
  }

  const argvManager = detectPackageManagerFromPaths(
    options.argv ?? process.argv
  );
  if (argvManager) {
    const args =
      argvManager === "bun"
        ? ["add", "-g", `${PACKAGE_NAME}@latest`]
        : ["install", "-g", `${PACKAGE_NAME}@latest`];

    return {
      kind: "package-manager",
      manager: argvManager,
      args,
      command: [argvManager, ...args].join(" "),
    } satisfies PackageManagerUpdatePlan;
  }

  const userAgentManager = detectPackageManagerFromUserAgent(
    options.userAgent ?? process.env.npm_config_user_agent
  );
  if (!userAgentManager) {
    return null;
  }

  const args =
    userAgentManager === "bun"
      ? ["add", "-g", `${PACKAGE_NAME}@latest`]
      : ["install", "-g", `${PACKAGE_NAME}@latest`];

  return {
    kind: "package-manager",
    manager: userAgentManager,
    args,
    command: [userAgentManager, ...args].join(" "),
  } satisfies PackageManagerUpdatePlan;
}

function createTemporaryBinaryPath(binaryPath: string) {
  const directory = dirname(binaryPath);
  const filename = basename(binaryPath);
  return join(directory, `.${filename}.tmp-${process.pid}`);
}

async function downloadStandaloneBinary(
  plan: StandaloneUpdatePlan,
  fetchImpl: typeof fetch
) {
  const response = await fetchImpl(plan.downloadUrl, {
    headers: {
      "user-agent": "gambi-cli-update",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download ${plan.assetName}: ${response.status} ${response.statusText}`
    );
  }

  const temporaryBinaryPath = createTemporaryBinaryPath(plan.binaryPath);
  const binaryBuffer = Buffer.from(await response.arrayBuffer());

  await writeFile(temporaryBinaryPath, binaryBuffer);

  if (plan.platform !== "win32") {
    await chmod(temporaryBinaryPath, 0o755);
  }

  return temporaryBinaryPath;
}

function createWindowsUpdaterScript() {
  return [
    "param(",
    "  [int]$ParentPid,",
    "  [string]$SourcePath,",
    "  [string]$DestinationPath",
    ")",
    '$ErrorActionPreference = "Stop"',
    "while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {",
    "  Start-Sleep -Milliseconds 200",
    "}",
    "Move-Item -Force $SourcePath $DestinationPath",
    'Write-Host "[INFO] Gambi update finished."',
    "Remove-Item -Force $PSCommandPath",
    "",
  ].join("\n");
}

async function scheduleWindowsStandaloneUpdate(
  plan: StandaloneUpdatePlan,
  temporaryBinaryPath: string
) {
  const updaterScriptPath = join(
    tmpdir(),
    `gambi-update-${process.pid}-${Date.now()}.ps1`
  );

  await writeFile(updaterScriptPath, createWindowsUpdaterScript());

  const updaterProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      updaterScriptPath,
      "-ParentPid",
      String(process.pid),
      "-SourcePath",
      temporaryBinaryPath,
      "-DestinationPath",
      plan.binaryPath,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );

  updaterProcess.unref();
}

export async function executeStandaloneUpdate(
  plan: StandaloneUpdatePlan,
  fetchImpl: typeof fetch = fetch
): Promise<StandaloneUpdateResult> {
  await stat(dirname(plan.binaryPath));

  const temporaryBinaryPath = await downloadStandaloneBinary(plan, fetchImpl);

  if (plan.platform === "win32") {
    await scheduleWindowsStandaloneUpdate(plan, temporaryBinaryPath);
    return { kind: "scheduled" };
  }

  try {
    await rename(temporaryBinaryPath, plan.binaryPath);
  } catch (error) {
    await rm(temporaryBinaryPath, { force: true });
    throw error;
  }

  return { kind: "updated" };
}

export function getManualUpdateCommands(
  platform: NodeJS.Platform = process.platform
) {
  const commands = [...MANUAL_UPDATE_COMMANDS.packageManagers] as string[];

  if (platform === "win32") {
    commands.push(MANUAL_UPDATE_COMMANDS.standalone.windows);
    return commands;
  }

  commands.push(MANUAL_UPDATE_COMMANDS.standalone.posix);
  return commands;
}
