import { spawnSync } from "node:child_process";
import { confirm } from "@clack/prompts";
import { AgentCommand } from "../utils/agent-command.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";
import { handleCancel } from "../utils/prompt.ts";
import {
  executeStandaloneUpdate,
  normalizePackageManager,
  resolveUpdatePlan,
} from "../utils/update.ts";

export interface PackageManagerUpdateResult {
  code: number;
  stderr: string;
  stdout: string;
}

export function runPackageManagerUpdate(
  manager: "bun" | "npm",
  args: string[],
  options: {
    captureOutput?: boolean;
    spawnImpl?: typeof spawnSync;
  } = {}
): PackageManagerUpdateResult {
  const result = (options.spawnImpl ?? spawnSync)(manager, args, {
    encoding: "utf8",
    stdio: options.captureOutput ? "pipe" : "inherit",
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }

  return {
    code: typeof result.status === "number" ? result.status : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export class SelfUpdateCommand extends AgentCommand {
  static override paths = [["self", "update"]];

  static override usage = Command.Usage({
    description: "Update the installed Gambi CLI",
    details:
      "Detects the installation source and runs the matching upgrade path. Use --dry-run to preview the exact command.",
    examples: [
      ["Preview the update", "gambi self update --dry-run --format json"],
      ["Run without confirmation", "gambi self update --yes"],
    ],
  });

  manager = Option.String("--manager", {
    description: "Preferred package manager (bun or npm)",
    required: false,
  });

  yes = Option.Boolean("--yes", false, {
    description: "Skip confirmation",
  });

  dryRun = Option.Boolean("--dry-run", false, {
    description: "Print the resolved update plan and exit",
  });

  async execute(): Promise<number> {
    if (this.manager && !normalizePackageManager(this.manager)) {
      this.context.stderr.write(
        "Error: Unsupported package manager.\nHint: use bun or npm.\n"
      );
      return 2;
    }

    const plan = resolveUpdatePlan({ manager: this.manager });
    if (!plan) {
      this.context.stderr.write(
        "Error: Could not determine the install source.\nHint: rerun with --manager bun or --manager npm.\n"
      );
      return 3;
    }

    const format = this.resolveFormat(false);
    if (this.dryRun) {
      if (format === "text") {
        this.context.stdout.write(`Would run: ${plan.command}\n`);
      } else {
        writeStructured(this.context.stdout, format, { plan });
      }
      return 0;
    }

    if (!this.yes && this.allowInteractive(true)) {
      const shouldProceed = await confirm({
        message: `Run update now?\n${plan.command}`,
        initialValue: true,
      });
      handleCancel(shouldProceed);
      if (!shouldProceed) {
        this.context.stdout.write("Update cancelled.\n");
        return 0;
      }
    }

    if (plan.kind === "standalone") {
      const result = await executeStandaloneUpdate(plan);
      if (format !== "text") {
        writeStructured(this.context.stdout, format, {
          result,
          plan,
        });
      } else {
        this.context.stdout.write("Update finished.\n");
      }
      return 0;
    }

    try {
      const result = runPackageManagerUpdate(plan.manager, plan.args, {
        captureOutput: format !== "text",
      });
      if (format !== "text") {
        writeStructured(this.context.stdout, format, {
          plan,
          result,
        });
      } else if (result.code === 0) {
        this.context.stdout.write("Update finished.\n");
      }
      return result.code;
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 1;
    }
  }
}
