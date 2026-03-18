#!/usr/bin/env bun
import { Builtins, Cli } from "./utils/option.ts";
import { CreateCommand } from "./commands/create.ts";
import { JoinCommand } from "./commands/join.ts";
import { ListCommand } from "./commands/list.ts";
import { MonitorCommand } from "./commands/monitor.ts";
import { ServeCommand } from "./commands/serve.ts";

const cli = new Cli({
  binaryLabel: "gambi",
  binaryName: "gambi",
  binaryVersion: "0.0.1",
});

cli.register(ServeCommand);
cli.register(CreateCommand);
cli.register(JoinCommand);
cli.register(ListCommand);
cli.register(MonitorCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

// TODO: Re-add TUI support as a separate optional package.
// Previously, running `gambi` with no args launched the TUI,
// but bundling OpenTUI + React inflated the binary from ~50MB to ~110MB.
// See: https://github.com/arthurbm/gambi/issues — create issue for TUI separation
const args = process.argv.slice(2);
if (args.length === 0) {
  cli.runExit(["--help"]);
} else {
  cli.runExit(args);
}
