import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CliEnvironmentConfig,
  loadCliConfig,
  renderCliConfigError,
  resolveEnvConfig,
} from "./cli-config.ts";
import { Command, Option } from "./option.ts";

export type OutputFormat = "text" | "json" | "ndjson";

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
      if (streaming && requestedFormat === "json") {
        return "ndjson";
      }

      return requestedFormat;
    }

    if (!process.stdout.isTTY) {
      return streaming ? "ndjson" : "json";
    }

    return "text";
  }

  protected resolveEnvName(): string | undefined {
    return this.env ?? process.env.GAMBI_ENV ?? undefined;
  }

  protected async loadEnvConfig(): Promise<
    | { ok: true; value: CliEnvironmentConfig | undefined }
    | { exitCode: 2; ok: false }
  > {
    try {
      const config = await loadCliConfig(this.resolveConfigPath());
      return {
        ok: true,
        value: resolveEnvConfig(config, this.resolveEnvName()),
      };
    } catch (error) {
      this.context.stderr.write(renderCliConfigError(error));
      return {
        ok: false,
        exitCode: 2,
      };
    }
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
