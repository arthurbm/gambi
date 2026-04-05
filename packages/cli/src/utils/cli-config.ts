import { resolve } from "node:path";
import { RuntimeConfig } from "@gambi/core/types";
import type {
  CliConfig,
  CliEnvironmentConfig,
} from "./agent-command.ts";

export async function loadCliConfig(
  configPath: string
): Promise<CliConfig | undefined> {
  const file = Bun.file(resolve(configPath));
  if (!(await file.exists())) {
    return undefined;
  }

  const raw = JSON.parse(await file.text()) as CliConfig;
  return raw;
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
