import { confirm, intro, text } from "@clack/prompts";
import { Command, Option } from "clipanion";
import {
  handleCancel,
  hasExplicitFlags,
  isInteractive,
} from "../utils/prompt.ts";

interface RoomInfo {
  id: string;
  code: string;
  name: string;
  hostId: string;
  createdAt: number;
  participantCount: number;
}

interface ListRoomsResponse {
  rooms: RoomInfo[];
}

interface ErrorResponse {
  error: string;
}

export class ListCommand extends Command {
  static override paths = [["list"]];

  static override usage = Command.Usage({
    description: "List available rooms on a hub",
    examples: [
      ["List rooms (interactive)", "gambiarra list"],
      ["List on custom hub", "gambiarra list --hub http://192.168.1.10:3000"],
    ],
  });

  hub = Option.String("--hub,-H", "http://localhost:3000", {
    description: "Hub URL",
  });

  json = Option.Boolean("--json,-j", false, {
    description: "Output as JSON",
  });

  async execute(): Promise<number> {
    let hub = this.hub;
    let json = this.json;

    if (!hasExplicitFlags() && isInteractive()) {
      intro("gambiarra list");

      const hubResult = await text({
        message: "Hub URL:",
        defaultValue: "http://localhost:3000",
        placeholder: "http://localhost:3000",
      });
      handleCancel(hubResult);
      hub = hubResult as string;

      const jsonResult = await confirm({
        message: "Output as JSON?",
        initialValue: false,
      });
      handleCancel(jsonResult);
      json = jsonResult as boolean;
    }

    try {
      const response = await fetch(`${hub}/rooms`);

      if (!response.ok) {
        const data = (await response.json()) as ErrorResponse;
        this.context.stderr.write(`Error: ${data.error}\n`);
        return 1;
      }

      const data = (await response.json()) as ListRoomsResponse;
      const rooms = data.rooms;

      if (json) {
        this.context.stdout.write(`${JSON.stringify(rooms, null, 2)}\n`);
      } else if (rooms.length === 0) {
        this.context.stdout.write("No rooms available.\n");
      } else {
        this.context.stdout.write("Available rooms:\n\n");
        for (const room of rooms) {
          this.context.stdout.write(`  ${room.code}  ${room.name}\n`);
          this.context.stdout.write(
            `    Participants: ${room.participantCount}\n`
          );
          this.context.stdout.write(
            `    Created: ${new Date(room.createdAt).toLocaleString()}\n\n`
          );
        }
      }

      return 0;
    } catch (err) {
      this.context.stderr.write(`Failed to connect to hub at ${hub}\n`);
      this.context.stderr.write(`${err}\n`);
      return 1;
    }
  }
}
