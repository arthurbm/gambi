import { homedir } from "node:os";
import { join } from "node:path";
import { Command, Option } from "./option.ts";

export type OutputFormat = "text" | "json" | "ndjson";

export interface CliEnvironmentConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  hubUrl?: string;
  networkEndpoint?: string;
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

export abstract class AgentCommand extends Command {
  format = Option.String("--format", {
    description: "Output format (text, json, ndjson)",
    required: false,
  });

  env = Option.String("--env", {
    description: "Named environment from the CLI config file",
    required: false,
  });

  interactive = Option.Boolean("--interactive", false, {
    description: "Allow interactive prompts for missing required values",
  });

  noInteractive = Option.Boolean("--no-interactive", false, {
    description: "Disable all interactive prompts",
  });

  verbose = Option.Boolean("--verbose", false, {
    description: "Include extended details in output",
  });

  quiet = Option.Boolean("--quiet", false, {
    description: "Reduce non-essential text output",
  });

  protected resolveFormat(streaming = false): OutputFormat {
    const requestedFormat =
      this.format ?? process.env.GAMBI_FORMAT ?? undefined;
    if (
      requestedFormat === "text" ||
      requestedFormat === "json" ||
      requestedFormat === "ndjson"
    ) {
      return requestedFormat;
    }

    if (!process.stdout.isTTY) {
      return streaming ? "ndjson" : "json";
    }

    return "text";
  }

  protected allowInteractive(defaultWhenTty = false): boolean {
    if (this.noInteractive || process.env.GAMBI_NO_INTERACTIVE === "1") {
      return false;
    }

    if (this.interactive) {
      return !!process.stdin.isTTY && !!process.stdout.isTTY;
    }

    return defaultWhenTty && !!process.stdin.isTTY && !!process.stdout.isTTY;
  }

  protected resolveConfigPath(): string {
    const xdgConfigHome =
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(xdgConfigHome, "gambi", "config.json");
  }
}
