#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { CreateCommand } from "./commands/create.ts";
import { JoinCommand } from "./commands/join.ts";
import { ListCommand } from "./commands/list.ts";
import { ServeCommand } from "./commands/serve.ts";
import { Builtins, Cli } from "./utils/option.ts";

function resolveCliVersion() {
  if (process.env.GAMBI_CLI_VERSION) {
    return process.env.GAMBI_CLI_VERSION;
  }

  try {
    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      version?: string;
    };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const cli = new Cli({
  binaryLabel: "gambi",
  binaryName: "gambi",
  binaryVersion: resolveCliVersion(),
});

cli.register(ServeCommand);
cli.register(CreateCommand);
cli.register(JoinCommand);
cli.register(ListCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stdout.write(cli.usage());
  process.stdout.write(
    "\nFor real-time monitoring, install the TUI: bun add -g gambi-tui\n"
  );
} else {
  cli.runExit(args);
}
