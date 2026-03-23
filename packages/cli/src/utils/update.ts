export type SupportedPackageManager = "bun" | "npm";

export interface UpdatePlan {
  args: string[];
  command: string;
  manager: SupportedPackageManager;
}

interface DetectPackageManagerOptions {
  argv?: string[];
  execPath?: string;
  manager?: string | null;
  userAgent?: string | null;
}

const PACKAGE_NAME = "gambi";
const MANUAL_UPDATE_COMMANDS = [
  "bun add -g gambi@latest",
  "npm install -g gambi@latest",
] as const;
const WHITESPACE_PATTERN = /\s+/;

function normalizePath(pathname: string) {
  return pathname.replaceAll("\\", "/").toLowerCase();
}

function isSupportedPackageManager(
  value: string
): value is SupportedPackageManager {
  return value === "bun" || value === "npm";
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
        pathname.includes(`/node_modules/${PACKAGE_NAME}-`)
    )
  ) {
    return "npm" satisfies SupportedPackageManager;
  }

  return null;
}

export function detectPackageManager(
  options: DetectPackageManagerOptions = {}
) {
  const explicitManager = normalizePackageManager(options.manager);
  if (explicitManager) {
    return explicitManager;
  }

  const userAgentManager = detectPackageManagerFromUserAgent(
    options.userAgent ?? process.env.npm_config_user_agent
  );
  if (userAgentManager) {
    return userAgentManager;
  }

  const candidatePaths = [
    options.execPath ?? process.execPath,
    ...(options.argv ?? process.argv),
  ].filter((value): value is string => Boolean(value));

  return detectPackageManagerFromPaths(candidatePaths);
}

export function resolveUpdatePlan(options: DetectPackageManagerOptions = {}) {
  const manager = detectPackageManager(options);
  if (!manager) {
    return null;
  }

  const args =
    manager === "bun"
      ? ["add", "-g", `${PACKAGE_NAME}@latest`]
      : ["install", "-g", `${PACKAGE_NAME}@latest`];

  return {
    manager,
    args,
    command: [manager, ...args].join(" "),
  } satisfies UpdatePlan;
}

export function getManualUpdateCommands() {
  return [...MANUAL_UPDATE_COMMANDS];
}
