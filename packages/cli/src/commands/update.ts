import { spawnSync } from "node:child_process";
import { confirm, intro, select } from "@clack/prompts";
import { Command, Option } from "../utils/option.ts";
import {
  handleCancel,
  hasExplicitFlags,
  isInteractive,
} from "../utils/prompt.ts";
import {
  detectPackageManager,
  getManualUpdateCommands,
  normalizePackageManager,
  resolveUpdatePlan,
} from "../utils/update.ts";

export class UpdateCommand extends Command {
  static override paths = [["update"]];

  static override usage = Command.Usage({
    description: "Update the installed Gambi package to the latest version",
    examples: [
      ["Update using the detected package manager", "gambi update"],
      ["Preview the update command", "gambi update --dry-run"],
      ["Force npm for the update", "gambi update --manager npm"],
    ],
  });

  manager = Option.String("--manager", {
    description: "Package manager to use (bun or npm)",
    required: false,
  });

  dryRun = Option.Boolean("--dry-run", false, {
    description: "Print the update command without executing it",
  });

  async execute(): Promise<number> {
    let manager = this.manager;

    if (manager && !normalizePackageManager(manager)) {
      this.context.stderr.write(`Unsupported package manager: ${manager}\n`);
      this.context.stderr.write("Supported managers: bun, npm\n");
      return 1;
    }

    if (!hasExplicitFlags() && isInteractive()) {
      intro("gambi update");

      const detectedManager = detectPackageManager({ manager });
      if (!detectedManager) {
        const managerResult = await select({
          message: "Package manager:",
          options: [
            { value: "bun", label: "bun (`bun add -g gambi@latest`)" },
            { value: "npm", label: "npm (`npm install -g gambi@latest`)" },
          ],
        });
        handleCancel(managerResult);
        manager = managerResult as string;
      }

      const shouldProceed = await confirm({
        message: "Update Gambi to the latest version?",
        initialValue: true,
      });
      handleCancel(shouldProceed);

      if (!shouldProceed) {
        this.context.stdout.write("Update cancelled.\n");
        return 0;
      }
    }

    const plan = resolveUpdatePlan({
      manager,
    });

    if (!plan) {
      const manualCommands = getManualUpdateCommands()
        .map((command) => `  ${command}`)
        .join("\n");

      this.context.stderr.write(
        "Could not determine which package manager installed this Gambi binary.\n"
      );
      this.context.stderr.write(
        "Run one of the following commands manually:\n"
      );
      this.context.stderr.write(`${manualCommands}\n`);
      this.context.stderr.write(
        "Or retry with `gambi update --manager bun` or `gambi update --manager npm`.\n"
      );
      return 1;
    }

    this.context.stdout.write(`Running: ${plan.command}\n`);

    if (this.dryRun) {
      return 0;
    }

    const result = spawnSync(plan.manager, plan.args, {
      stdio: "inherit",
      windowsHide: false,
    });

    if (result.error) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      this.context.stderr.write(`Failed to run update: ${message}\n`);
      return 1;
    }

    const code = typeof result.status === "number" ? result.status : 1;
    if (code === 0) {
      this.context.stdout.write("Gambi update finished.\n");
    }

    return code;
  }
}
