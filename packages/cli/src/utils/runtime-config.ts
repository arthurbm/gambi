import { resolve } from "node:path";
import { confirm, text } from "@clack/prompts";
import {
  RuntimeConfig,
  type RuntimeConfig as RuntimeConfigValue,
} from "@gambi/core/types";
import { handleCancel } from "./prompt.ts";

function parseOptionalNumber(
  input: string,
  fieldName: string
): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: expected a number.`);
  }

  return parsed;
}

function parseOptionalStopSequences(input: string): string[] | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const values = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function getCurrentValue<T>(value: T | undefined): string {
  if (value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}

export function hasRuntimeConfig(
  config: RuntimeConfigValue | undefined
): config is RuntimeConfigValue {
  return config !== undefined && Object.keys(config).length > 0;
}

export async function loadRuntimeConfigFile(
  configPath: string
): Promise<RuntimeConfigValue> {
  const resolvedPath = resolve(configPath);
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(
      `Invalid JSON in config file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = RuntimeConfig.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `Invalid runtime config in ${resolvedPath}: ${parsed.error.message}`
    );
  }

  return parsed.data;
}

export async function promptRuntimeConfig(
  scope: "participant" | "room",
  initialConfig: RuntimeConfigValue = {}
): Promise<RuntimeConfigValue> {
  const shouldConfigure = await confirm({
    message:
      scope === "participant"
        ? "Configure participant defaults (instructions, temperature, etc.)?"
        : "Configure room defaults (instructions, temperature, etc.)?",
    initialValue: hasRuntimeConfig(initialConfig),
  });
  handleCancel(shouldConfigure);

  if (!shouldConfigure) {
    return initialConfig;
  }

  const instructionsResult = await text({
    message: "Instructions / system prompt:",
    placeholder: getCurrentValue(initialConfig.instructions),
  });
  handleCancel(instructionsResult);

  const temperatureResult = await text({
    message: "Temperature:",
    placeholder: getCurrentValue(initialConfig.temperature),
  });
  handleCancel(temperatureResult);

  const topPResult = await text({
    message: "Top-p:",
    placeholder: getCurrentValue(initialConfig.top_p),
  });
  handleCancel(topPResult);

  const maxTokensResult = await text({
    message: "Max tokens:",
    placeholder: getCurrentValue(initialConfig.max_tokens),
  });
  handleCancel(maxTokensResult);

  const stopResult = await text({
    message: "Stop sequences (comma-separated):",
    placeholder: getCurrentValue(initialConfig.stop),
  });
  handleCancel(stopResult);

  const frequencyPenaltyResult = await text({
    message: "Frequency penalty:",
    placeholder: getCurrentValue(initialConfig.frequency_penalty),
  });
  handleCancel(frequencyPenaltyResult);

  const presencePenaltyResult = await text({
    message: "Presence penalty:",
    placeholder: getCurrentValue(initialConfig.presence_penalty),
  });
  handleCancel(presencePenaltyResult);

  const seedResult = await text({
    message: "Seed:",
    placeholder: getCurrentValue(initialConfig.seed),
  });
  handleCancel(seedResult);

  const config: RuntimeConfigValue = {
    ...initialConfig,
  };

  const instructions = String(instructionsResult).trim();
  if (instructions) {
    config.instructions = instructions;
  }

  const temperature = parseOptionalNumber(
    String(temperatureResult),
    "temperature"
  );
  if (temperature !== undefined) {
    config.temperature = temperature;
  }

  const topP = parseOptionalNumber(String(topPResult), "top_p");
  if (topP !== undefined) {
    config.top_p = topP;
  }

  const maxTokens = parseOptionalNumber(String(maxTokensResult), "max_tokens");
  if (maxTokens !== undefined) {
    config.max_tokens = maxTokens;
  }

  const stop = parseOptionalStopSequences(String(stopResult));
  if (stop !== undefined) {
    config.stop = stop;
  }

  const frequencyPenalty = parseOptionalNumber(
    String(frequencyPenaltyResult),
    "frequency_penalty"
  );
  if (frequencyPenalty !== undefined) {
    config.frequency_penalty = frequencyPenalty;
  }

  const presencePenalty = parseOptionalNumber(
    String(presencePenaltyResult),
    "presence_penalty"
  );
  if (presencePenalty !== undefined) {
    config.presence_penalty = presencePenalty;
  }

  const seed = parseOptionalNumber(String(seedResult), "seed");
  if (seed !== undefined) {
    config.seed = seed;
  }

  const parsed = RuntimeConfig.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid runtime config: ${parsed.error.message}`);
  }

  return parsed.data;
}
