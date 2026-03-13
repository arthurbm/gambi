#!/usr/bin/env bun
import { Builtins, Cli } from "clipanion";
import { startTUI } from "tui";
import { CreateCommand } from "./commands/create.ts";
import { JoinCommand } from "./commands/join.ts";
import { ListCommand } from "./commands/list.ts";
import { MonitorCommand } from "./commands/monitor.ts";
import { ServeCommand } from "./commands/serve.ts";

const args = process.argv.slice(2);

// If no arguments and running in a TTY, start TUI
if (args.length === 0 && process.stdout.isTTY) {
  startTUI({ hubUrl: "http://localhost:3000" });
} else {
  // Otherwise, use CLI
  const cli = new Cli({
    binaryLabel: "gambiarra",
    binaryName: "gambiarra",
    binaryVersion: "0.0.1",
  });

  cli.register(ServeCommand);
  cli.register(CreateCommand);
  cli.register(JoinCommand);
  cli.register(ListCommand);
  cli.register(MonitorCommand);
  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);

  cli.runExit(args);
}
