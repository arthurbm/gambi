import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface UserConfig {
  hubUrl?: string;
  llmEndpoint?: string;
}

const CONFIG_PATH = join(homedir(), ".gambiarra", "config.json");

/**
 * Load user config from ~/.gambiarra/config.json
 */
export function loadConfig(): UserConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(content) as UserConfig;
    }
  } catch {
    // Ignore errors, return empty config
  }
  return {};
}

/**
 * Save user config to ~/.gambiarra/config.json
 */
export function saveConfig(config: UserConfig): void {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Ignore errors silently
  }
}

/**
 * Update a specific config value
 */
export function updateConfig(updates: Partial<UserConfig>): void {
  const current = loadConfig();
  saveConfig({ ...current, ...updates });
}
