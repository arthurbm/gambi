import { AgentCommand } from "../utils/agent-command.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

export class ParticipantLeaveCommand extends AgentCommand {
  static override paths = [["participant", "leave"]];

  static override usage = Command.Usage({
    description: "Remove a participant from a room",
    details:
      "Calls the management API to delete a participant registration from a room.",
    examples: [
      [
        "Remove a participant",
        "gambi participant leave --room ABC123 --participant-id worker-1",
      ],
    ],
  });

  room = Option.String("--room,-r", {
    description: "Room code",
  });

  participantId = Option.String("--participant-id", {
    description: "Participant identifier",
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  async execute(): Promise<number> {
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }
    const envConfig = envConfigResult.value;
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(false);

    const response = await requestManagement<{ success: true }>(
      hubUrl,
      `/v1/rooms/${this.room}/participants/${this.participantId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      this.context.stderr.write(renderFailure(response.value));
      return exitCodeForFailure(response.value);
    }

    if (format !== "text") {
      writeStructured(this.context.stdout, format, response.value);
      return 0;
    }

    this.context.stdout.write(
      `Removed participant ${this.participantId} from room ${this.room}.\n`
    );
    return 0;
  }
}
