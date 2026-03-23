import { spawnSync } from "node:child_process";
import { confirm, intro, select } from "@clack/prompts";
import { Command, Option } from "../utils/option.ts";
import {
  handleCancel,
  hasExplicitFlags,
  isInteractive,
} from "../utils/prompt.ts";
import {
  executeStandaloneUpdate,
  getManualUpdateCommands,
  normalizePackageManager,
  resolveUpdatePlan,
} from "../utils/update.ts";

function formatManualCommands() {
  return getManualUpdateCommands()
    .map((command) => `  ${command}`)
    .join("\n");
}

function runPackageManagerUpdate(
  manager: "bun" | "npm",
  args: string[],
  stderr: NodeJS.WritableStream,
  stdout: NodeJS.WritableStream
) {
  const result = spawnSync(manager, args, {
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.error) {
    const message =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    stderr.write(`Failed to run update: ${message}\n`);
    return 1;
  }

  const code = typeof result.status === "number" ? result.status : 1;
  if (code === 0) {
    stdout.write("Gambi update finished.\n");
  }

  return code;
}

export class UpdateCommand extends Command {
  static override paths = [["update"]];

  static override usage = Command.Usage({
    description: "Update the installed Gambi version",
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

  private async promptForInteractiveUpdate(manager?: string | null) {
    intro("gambi update");
    let selectedManager = manager;

    if (!resolveUpdatePlan({ manager: selectedManager })) {
      const managerResult = await select({
        message: "Package manager:",
        options: [
          { value: "bun", label: "bun (`bun add -g gambi@latest`)" },
          { value: "npm", label: "npm (`npm install -g gambi@latest`)" },
        ],
      });
      handleCancel(managerResult);
      selectedManager = managerResult as string;
    }

    const shouldProceed = await confirm({
      message: "Update Gambi to the latest version?",
      initialValue: true,
    });
    handleCancel(shouldProceed);

    if (!shouldProceed) {
      this.context.stdout.write("Update cancelled.\n");
      return null;
    }

    return selectedManager;
  }

  private writeUnknownInstallInstructions() {
    this.context.stderr.write(
      "Could not determine how this Gambi binary was installed.\n"
    );
    this.context.stderr.write("Run one of the following commands manually:\n");
    this.context.stderr.write(`${formatManualCommands()}\n`);
    this.context.stderr.write(
      "Or retry with `gambi update --manager bun` or `gambi update --manager npm`.\n"
    );
  }

  private async runStandaloneUpdate(
    plan: Extract<ReturnType<typeof resolveUpdatePlan>, { kind: "standalone" }>
  ) {
    try {
      const result = await executeStandaloneUpdate(plan);

      if (result.kind === "scheduled") {
        this.context.stdout.write(
          "Gambi update is scheduled and will finish after this process exits.\n"
        );
        return 0;
      }

      this.context.stdout.write("Gambi update finished.\n");
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.stderr.write(`Failed to run update: ${message}\n`);
      return 1;
    }
  }

  async execute(): Promise<number> {
    let manager: string | null | undefined = this.manager;

    if (manager && !normalizePackageManager(manager)) {
      this.context.stderr.write(`Unsupported package manager: ${manager}\n`);
      this.context.stderr.write("Supported managers: bun, npm\n");
      return 1;
    }

    if (!hasExplicitFlags() && isInteractive()) {
      manager = await this.promptForInteractiveUpdate(manager);
      if (manager === null) {
        return 0;
      }
    }

    const plan = resolveUpdatePlan({
      manager,
    });

    if (!plan) {
      this.writeUnknownInstallInstructions();
      return 1;
    }

    this.context.stdout.write(`Running: ${plan.command}\n`);

    if (this.dryRun) {
      return 0;
    }

    if (plan.kind === "standalone") {
      return this.runStandaloneUpdate(plan);
    }

    return runPackageManagerUpdate(
      plan.manager,
      plan.args,
      this.context.stderr,
      this.context.stdout
    );
  }
}
