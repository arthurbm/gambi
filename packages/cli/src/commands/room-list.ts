import type { RoomSummary } from "@gambi/core/types";
import { AgentCommand } from "../utils/agent-command.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

type RoomSort = "participant-count" | "created-at" | "name";

function sortRooms(rooms: RoomSummary[], sortBy: RoomSort, reverse: boolean) {
  const sorted = [...rooms].sort((left, right) => {
    if (sortBy === "name") {
      return left.name.localeCompare(right.name);
    }

    if (sortBy === "created-at") {
      return right.createdAt - left.createdAt;
    }

    if (right.participantCount !== left.participantCount) {
      return right.participantCount - left.participantCount;
    }

    return right.createdAt - left.createdAt;
  });

  return reverse ? sorted.reverse() : sorted;
}

export class RoomListCommand extends AgentCommand {
  static override paths = [["room", "list"]];

  static override usage = Command.Usage({
    description: "List rooms from the management API",
    details:
      "Returns structured room summaries from the hub management plane. Use --format json for scripts.",
    examples: [
      ["List rooms", "gambi room list"],
      ["List as JSON", "gambi room list --format json"],
      [
        "List from another hub",
        "gambi room list --hub http://192.168.1.10:3000",
      ],
    ],
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  sort = Option.String("--sort", "participant-count", {
    description: "Sort by participant-count, created-at, or name",
  });

  reverse = Option.Boolean("--reverse", false, {
    description: "Reverse the selected sort order",
  });

  async execute(): Promise<number> {
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }
    const envConfig = envConfigResult.value;
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const sortBy = (this.sort ?? "participant-count") as RoomSort;
    const format = this.resolveFormat(false);

    const response = await requestManagement<RoomSummary[]>(
      hubUrl,
      "/v1/rooms"
    );
    if (!response.ok) {
      this.context.stderr.write(renderFailure(response.value));
      return exitCodeForFailure(response.value);
    }

    const rooms = sortRooms(response.value.data, sortBy, this.reverse);
    if (format !== "text") {
      writeStructured(this.context.stdout, format, {
        data: rooms,
        meta: response.value.meta,
      });
      return 0;
    }

    if (rooms.length === 0) {
      this.context.stdout.write("No rooms found.\n");
      return 0;
    }

    for (const room of rooms) {
      this.context.stdout.write(`${room.code}  ${room.name}\n`);
      this.context.stdout.write(`  participants: ${room.participantCount}\n`);
      this.context.stdout.write(
        `  protected: ${room.passwordProtected ? "yes" : "no"}\n`
      );
      this.context.stdout.write(
        `  created_at: ${new Date(room.createdAt).toISOString()}\n\n`
      );
    }

    return 0;
  }
}
