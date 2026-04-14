import { password as passwordPrompt, text } from "@clack/prompts";
import type { RoomSummary, RuntimeConfig } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadRuntimeConfigFromInput } from "../utils/cli-config.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

async function promptForRoomSettings(params: {
  name?: string;
  password?: string;
}): Promise<{ name?: string; password?: string }> {
  let { name, password } = params;

  if (!name) {
    const nameResult = await text({ message: "Room name:" });
    name = String(nameResult).trim();
  }

  if (password === undefined) {
    const passwordResult = await passwordPrompt({
      message: "Room password (leave empty for none):",
    });
    const candidatePassword = String(passwordResult).trim();
    if (candidatePassword) {
      password = candidatePassword;
    }
  }

  return { name, password };
}

export class RoomCreateCommand extends AgentCommand {
  static override paths = [["room", "create"]];

  static override usage = Command.Usage({
    description: "Create a room through the management API",
    details:
      "Creates a new room and optionally attaches runtime defaults from JSON. Use --config - to read JSON from stdin.",
    examples: [
      ["Create a room", "gambi room create --name Demo"],
      [
        "Create with defaults",
        "gambi room create --name Demo --config ./room.json",
      ],
      [
        "Preview request",
        "gambi room create --name Demo --dry-run --format json",
      ],
    ],
  });

  name = Option.String("--name,-n", {
    description: "Room name",
    required: false,
  });

  password = Option.String("--password,-p", {
    description: "Optional room password",
    required: false,
  });

  configPath = Option.String("--config", {
    description: "Runtime config JSON file or '-' for stdin",
    required: false,
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  dryRun = Option.Boolean("--dry-run", false, {
    description: "Validate and print the request without creating the room",
  });

  async execute(): Promise<number> {
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }
    const envConfig = envConfigResult.value;
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(false);
    let name = this.name;
    let password = this.password;

    if (!name && this.allowInteractive(true)) {
      ({ name, password } = await promptForRoomSettings({ name, password }));
    }

    if (!name) {
      this.context.stderr.write(
        "Error: Room name is required.\nHint: pass --name or use --interactive.\n"
      );
      return 2;
    }

    let runtimeConfig: RuntimeConfig | undefined;
    try {
      runtimeConfig = await loadRuntimeConfigFromInput(this.configPath);
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 2;
    }

    const payload = {
      name,
      password,
      defaults: runtimeConfig,
    };

    if (this.dryRun) {
      const preview = {
        hubUrl,
        payload: {
          ...payload,
          password: password ? "[redacted]" : undefined,
        },
      };
      if (format === "text") {
        this.context.stdout.write(
          `Would create room '${name}' on ${hubUrl}.\n${JSON.stringify(preview.payload, null, 2)}\n`
        );
      } else {
        writeStructured(this.context.stdout, format, preview);
      }
      return 0;
    }

    const response = await requestManagement<{
      room: RoomSummary;
      hostId: string;
    }>(hubUrl, "/v1/rooms", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      this.context.stderr.write(renderFailure(response.value));
      return exitCodeForFailure(response.value);
    }

    if (format !== "text") {
      writeStructured(this.context.stdout, format, response.value);
      return 0;
    }

    const { room, hostId } = response.value.data;
    this.context.stdout.write(`Created room ${room.code} (${room.name}).\n`);
    this.context.stdout.write(`host_id: ${hostId}\n`);
    return 0;
  }
}
