import type { RoomSummary } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadCliConfig, resolveEnvConfig } from "../utils/cli-config.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

export class RoomGetCommand extends AgentCommand {
  static override paths = [["room", "get"]];

  static override usage = Command.Usage({
    description: "Fetch one room summary by code",
    details:
      "Returns a single room summary from the management API, including participant count and password protection status.",
    examples: [
      ["Get one room", "gambi room get --code ABC123"],
      ["Get as JSON", "gambi room get --code ABC123 --format json"],
    ],
  });

  code = Option.String("--code,-c", {
    description: "Room code",
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  async execute(): Promise<number> {
    const config = await loadCliConfig(this.resolveConfigPath());
    const envConfig = resolveEnvConfig(config, this.env);
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(false);

    const response = await requestManagement<RoomSummary>(
      hubUrl,
      `/v1/rooms/${this.code}`
    );
    if (!response.ok) {
      this.context.stderr.write(renderFailure(response.value));
      return exitCodeForFailure(response.value);
    }

    if (format !== "text") {
      writeStructured(this.context.stdout, format, response.value);
      return 0;
    }

    const room = response.value.data;
    this.context.stdout.write(`${room.code}  ${room.name}\n`);
    this.context.stdout.write(`participants: ${room.participantCount}\n`);
    this.context.stdout.write(
      `protected: ${room.passwordProtected ? "yes" : "no"}\n`
    );
    this.context.stdout.write(
      `created_at: ${new Date(room.createdAt).toISOString()}\n`
    );
    if (room.defaults) {
      this.context.stdout.write(
        `defaults: ${JSON.stringify(room.defaults, null, 2)}\n`
      );
    }
    return 0;
  }
}
