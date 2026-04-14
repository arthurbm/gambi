import type { RoomEvent } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import {
  exitCodeForFailure,
  renderFailure,
  WatchRoomEventsError,
  watchRoomEvents,
} from "../utils/management-api.ts";
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
      ["Watch as NDJSON", "gambi events watch --room ABC123 --format ndjson"],
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
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }
    const envConfig = envConfigResult.value;
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const format = this.resolveFormat(true);

    try {
      for await (const event of watchRoomEvents(hubUrl, this.room)) {
        if (format === "text") {
          this.context.stdout.write(`${renderEvent(event)}\n`);
        } else {
          writeStructured(this.context.stdout, format, event);
        }
      }
    } catch (error) {
      if (error instanceof WatchRoomEventsError) {
        this.context.stderr.write(renderFailure(error.failure));
        return exitCodeForFailure(error.failure);
      }

      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 1;
    }

    return 0;
  }
}
