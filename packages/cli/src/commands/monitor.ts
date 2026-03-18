import { Command, Option } from "../utils/option.ts";

export class MonitorCommand extends Command {
  static override paths = [["monitor"]];

  static override usage = Command.Usage({
    description: "Open TUI to monitor rooms in real-time",
    examples: [
      ["Monitor local hub", "gambi monitor"],
      [
        "Monitor remote hub",
        "gambi monitor --hub http://192.168.1.100:3000",
      ],
    ],
  });

  hub = Option.String("--hub,-h", "http://localhost:3000", {
    description: "Hub URL to connect to",
  });

  async execute(): Promise<number> {
    this.context.stderr.write(
      "TUI is not bundled in the standalone binary.\nInstall via npm/bun for TUI support: npm install -g gambi\nThen run: gambi monitor\n",
    );
    return 1;
  }
}
