#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { EventsWatchCommand } from "./commands/events-watch.ts";
import { HubServeCommand } from "./commands/hub-serve.ts";
import { ParticipantHeartbeatCommand } from "./commands/participant-heartbeat.ts";
import { ParticipantJoinCommand } from "./commands/participant-join.ts";
import { ParticipantLeaveCommand } from "./commands/participant-leave.ts";
import { RoomCreateCommand } from "./commands/room-create.ts";
import { RoomGetCommand } from "./commands/room-get.ts";
import { RoomListCommand } from "./commands/room-list.ts";
import { SelfUpdateCommand } from "./commands/self-update.ts";
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

function renderRootHelp() {
  return [
    "gambi",
    "",
    "Operational CLI for Gambi hubs, rooms, participants, and events.",
    "",
    "Hub:",
    "  gambi hub serve              Start the hub server",
    "",
    "Rooms:",
    "  gambi room create            Create a room",
    "  gambi room list              List room summaries",
    "  gambi room get               Get one room summary",
    "",
    "Participants:",
    "  gambi participant join       Register a participant and keep heartbeats alive",
    "  gambi participant leave      Remove a participant",
    "  gambi participant heartbeat  Send one participant heartbeat",
    "",
    "Events:",
    "  gambi events watch           Stream room events",
    "",
    "Maintenance:",
    "  gambi self update            Update the installed CLI",
    "",
    "Use `gambi <group> <command> --help` for examples and flags.",
    "Use `gambi-tui` for the human-first terminal dashboard.",
    "",
  ].join("\n");
}

const cli = new Cli({
  binaryLabel: "gambi",
  binaryName: "gambi",
  binaryVersion: resolveCliVersion(),
});

cli.register(HubServeCommand);
cli.register(RoomCreateCommand);
cli.register(RoomListCommand);
cli.register(RoomGetCommand);
cli.register(ParticipantJoinCommand);
cli.register(ParticipantLeaveCommand);
cli.register(ParticipantHeartbeatCommand);
cli.register(EventsWatchCommand);
cli.register(SelfUpdateCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

const args = process.argv.slice(2);
if (
  args.length === 0 ||
  (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
) {
  process.stdout.write(renderRootHelp());
} else {
  cli.runExit(args);
}
