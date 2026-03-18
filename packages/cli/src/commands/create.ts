import { intro, outro, password as passwordPrompt, text } from "@clack/prompts";
import { Command, Option } from "../utils/option.ts";
import { handleCancel, isInteractive } from "../utils/prompt.ts";
import {
  hasRuntimeConfig,
  loadRuntimeConfigFile,
  promptRuntimeConfig,
} from "../utils/runtime-config.ts";

interface CreateRoomResponse {
  room: {
    id: string;
    code: string;
    name: string;
    hostId: string;
    createdAt: number;
  };
  hostId: string;
}

interface ErrorResponse {
  error: string;
}

export class CreateCommand extends Command {
  static override paths = [["create"]];

  static override usage = Command.Usage({
    description: "Create a new room on a hub",
    examples: [
      ["Create a room (interactive)", "gambi create"],
      ["Create a room", "gambi create --name 'My Room'"],
      [
        "Create on custom hub",
        "gambi create --name 'My Room' --hub http://192.168.1.10:3000",
      ],
      [
        "Create a password-protected room",
        "gambi create --name 'My Room' --password secret123",
      ],
    ],
  });

  name = Option.String("--name,-n", {
    description: "Room name",
    required: false,
  });

  password = Option.String("--password,-p", {
    description: "Optional password to protect the room",
    required: false,
  });

  configPath = Option.String("--config", {
    description: "Path to a JSON file with room defaults",
    required: false,
  });

  hub = Option.String("--hub,-H", "http://localhost:3000", {
    description: "Hub URL",
  });

  async execute(): Promise<number> {
    let name = this.name;
    let password = this.password;
    let defaults = this.configPath
      ? await loadRuntimeConfigFile(this.configPath).catch((error) => {
          this.context.stderr.write(`${error}\n`);
          return null;
        })
      : {};

    if (defaults === null) {
      return 1;
    }

    if (!name && isInteractive()) {
      intro("gambi create");

      const nameResult = await text({
        message: "Room name:",
        validate: (v) => (v ? undefined : "Room name is required"),
      });
      handleCancel(nameResult);
      name = nameResult as string;

      if (password === undefined) {
        const passwordResult = await passwordPrompt({
          message: "Room password (leave empty for no password):",
        });
        handleCancel(passwordResult);
        const pwd = passwordResult as string;
        if (pwd) {
          password = pwd;
        }
      }

      try {
        defaults = await promptRuntimeConfig("room", defaults);
      } catch (error) {
        this.context.stderr.write(`${error}\n`);
        return 1;
      }
    } else if (!name) {
      this.context.stderr.write(
        "Error: --name is required (or run in a terminal for interactive mode)\n"
      );
      return 1;
    }

    try {
      const body: {
        defaults?: typeof defaults;
        name: string;
        password?: string;
      } = { name };
      if (password) {
        body.password = password;
      }
      if (hasRuntimeConfig(defaults)) {
        body.defaults = defaults;
      }

      const response = await fetch(`${this.hub}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json()) as ErrorResponse;
        this.context.stderr.write(`Error: ${data.error}\n`);
        return 1;
      }

      const data = (await response.json()) as CreateRoomResponse;

      const successMsg = [
        "Room created!",
        `  Code: ${data.room.code}`,
        `  ID: ${data.room.id}`,
        ...(password ? ["  Protection: Password-protected"] : []),
        "",
        "Share the code with participants to join.",
      ].join("\n");

      if (isInteractive() && !this.name) {
        outro(successMsg);
      } else {
        this.context.stdout.write(`${successMsg}\n`);
      }

      return 0;
    } catch (err) {
      this.context.stderr.write(`Failed to connect to hub at ${this.hub}\n`);
      this.context.stderr.write(`${err}\n`);
      return 1;
    }
  }
}
