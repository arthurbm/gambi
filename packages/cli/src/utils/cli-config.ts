import { resolve } from "node:path";
import { RuntimeConfig } from "@gambi/core/types";

export interface CliEnvironmentConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  hubUrl?: string;
  noSpecs?: boolean;
  serve?: {
    host?: string;
    mdns?: boolean;
    port?: number;
  };
}

export interface CliConfig {
  defaultEnv?: string;
  envs?: Record<string, CliEnvironmentConfig>;
}

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliConfigError";
  }
}

export async function loadCliConfig(
  configPath: string
): Promise<CliConfig | undefined> {
  const resolvedPath = resolve(configPath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    return undefined;
  }

  let raw: CliConfig;
  try {
    raw = JSON.parse(await file.text()) as CliConfig;
  } catch (error) {
    throw new CliConfigError(
      `Invalid CLI config in ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return raw;
}

export function renderCliConfigError(error: unknown): string {
  let message: string;
  if (error instanceof CliConfigError || error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return `Error: ${message}\nHint: fix the config file or remove it and retry.\n`;
}

export async function loadRuntimeConfigFromInput(
  inputPath?: string
): Promise<RuntimeConfig | undefined> {
  if (!inputPath) {
    return undefined;
  }

  const rawText =
    inputPath === "-"
      ? await new Response(Bun.stdin.stream()).text()
      : await Bun.file(resolve(inputPath)).text();
  const parsed = RuntimeConfig.safeParse(JSON.parse(rawText));

  if (!parsed.success) {
    throw new Error(`Invalid runtime config: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function resolveEnvConfig(
  config: CliConfig | undefined,
  envName?: string
): CliEnvironmentConfig | undefined {
  if (!config?.envs) {
    return undefined;
  }

  const selectedEnv = envName ?? config.defaultEnv;
  if (!selectedEnv) {
    return undefined;
  }

  return config.envs[selectedEnv];
}
