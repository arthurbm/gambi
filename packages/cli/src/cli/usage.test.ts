import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";
import { CLI_VERSION } from "./version.ts";

it.effect(
  "a flag that does not exist is invalid usage, reported on stderr",
  () =>
    Effect.gen(function* () {
      const result = yield* runCommand(["room", "list", "--nope"]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "UnrecognizedOption",
        message: "Unrecognized flag: --nope in command gambi room list",
        hint: "Run `gambi room list --help` to see how to call it.",
        exitCode: 2,
      });
    })
);

it.effect("a command that does not exist is invalid usage", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["room", "destroy"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.name).toBe("UnknownSubcommand");
  })
);

it.effect("without a terminal a missing flag is an error, never a prompt", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["room", "get"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toEqual({
      name: "MissingOption",
      hint: "Run `gambi room get --help` to see how to call it.",
      exitCode: 2,
      message: "Missing required flag: --code",
      details: { option: "code" },
    });
  })
);

it.effect("--help prints the generated help on stdout", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["room", "get", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Read one room by its code");
    expect(result.stdout).toContain("--code");
    expect(result.stdout).toContain("--hub");
    expect(result.stdout).toContain("--format");
  })
);

it.effect("gambi without a command lists the command groups", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("hub");
    expect(result.stdout).toContain("room");
  })
);

it.effect("--version prints the version of the CLI", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["--version"]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `gambi v${CLI_VERSION}\n`,
    });
  })
);

it.effect("--completions prints a completion script for the shell", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["--completions", "bash"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("complete ");
    expect(result.stdout).toContain("gambi");
    expect(result.stdout).toContain("room");
  })
);
