import { confirm } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { AgentCommand } from "../utils/agent-command.ts";
import { Command, Option } from "../utils/option.ts";
import {
  executeStandaloneUpdate,
  normalizePackageManager,
  resolveUpdatePlan,
} from "../utils/update.ts";
import { writeStructured } from "../utils/output.ts";

function runPackageManagerUpdate(manager: "bun" | "npm", args: string[]) {
  const result = spawnSync(manager, args, {
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === "number" ? result.status : 1;
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
      const code = runPackageManagerUpdate(plan.manager, plan.args);
      if (code === 0 && format === "text") {
        this.context.stdout.write("Update finished.\n");
      }
      return code;
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 1;
    }
  }
}
