import type { RoomEvent } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadCliConfig, resolveEnvConfig } from "../utils/cli-config.ts";
import { watchRoomEvents } from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

function renderEvent(event: RoomEvent): string {
  return `${new Date(event.timestamp).toISOString()} ${event.type} ${JSON.stringify(event.data)}`;
}

export class EventsWatchCommand extends AgentCommand {
  static override paths = [["events", "watch"]];

  static override usage = Command.Usage({
    description: "Watch room events from the management API",
    details:
      "Streams typed room events. Use --format ndjson for agents and log processors.",
    examples: [
      ["Watch room events", "gambi events watch --room ABC123"],
      [
        "Watch as NDJSON",
        "gambi events watch --room ABC123 --format ndjson",
      ],
    ],
  });

  room = Option.String("--room,-r", {
    description: "Room code",
    required: true,
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  async execute(): Promise<number> {
    const config = await loadCliConfig(this.resolveConfigPath());
    const envConfig = resolveEnvConfig(config, this.env);
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(true);

    for await (const event of watchRoomEvents(hubUrl, this.room)) {
      if (format === "text") {
        this.context.stdout.write(`${renderEvent(event)}\n`);
      } else {
        writeStructured(this.context.stdout, format, event);
      }
    }

    return 0;
  }
}
