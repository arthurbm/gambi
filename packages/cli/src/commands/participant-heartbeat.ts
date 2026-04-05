import type { HeartbeatResult } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadCliConfig, resolveEnvConfig } from "../utils/cli-config.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

export class ParticipantHeartbeatCommand extends AgentCommand {
  static override paths = [["participant", "heartbeat"]];

  static override usage = Command.Usage({
    description: "Send one participant heartbeat",
    details:
      "Useful for automation and testing participant liveness independently from the long-running join command.",
    examples: [
      [
        "Send a heartbeat",
        "gambi participant heartbeat --room ABC123 --participant-id worker-1",
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
    const config = await loadCliConfig(this.resolveConfigPath());
    const envConfig = resolveEnvConfig(config, this.env);
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(false);

    const response = await requestManagement<HeartbeatResult>(
      hubUrl,
      `/v1/rooms/${this.room}/participants/${this.participantId}/heartbeat`,
      { method: "POST" }
    );

    if (!response.ok) {
      this.context.stderr.write(renderFailure(response.value));
      return exitCodeForFailure(response.value);
    }

    if (format !== "text") {
      writeStructured(this.context.stdout, format, response.value);
      return 0;
    }

    const heartbeat = response.value.data;
    this.context.stdout.write(
      `Heartbeat ok for ${this.participantId} (${heartbeat.status}).\n`
    );
    return 0;
  }
}
