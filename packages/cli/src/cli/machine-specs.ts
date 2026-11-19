/**
 * The specs of this machine, as a participant tells them to its room:
 * processor, memory and, when a tool of the platform names it, the graphics
 * card and its memory. They are informational: nothing routes on them.
 *
 * Detection never fails. A tool that is not installed, exits with an error or
 * takes too long just leaves the card out.
 */
import type { MachineSpecs } from "@gambi/protocol";
import { Duration, Effect, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Installation } from "./installation.ts";
import { Machine } from "./machine.ts";

type GraphicsCard = Pick<MachineSpecs, "gpu" | "vram">;

/** How long a tool has to answer before the card is left out. */
const TOOL_TIMEOUT = Duration.seconds(5);

const GIB = 1024 ** 3;
const MIB_PER_GIB = 1024;

const LSPCI_CARD = /vga|3d|display/i;
const LSPCI_NAME = /: (.+)$/;
const MACOS_CHIP = /Chip(?:set)? Model: (.+)/;
const MACOS_VRAM = /VRAM.*?: (\d+)/;
const LINE_BREAK = /\r?\n/;

const wholeNumber = (text: string | undefined): number | undefined => {
  const value = Number.parseInt(text ?? "", 10);
  return Number.isNaN(value) ? undefined : value;
};

const card = (
  gpu: string | undefined,
  vram: number | undefined
): GraphicsCard => ({
  ...(gpu === undefined || gpu === "" ? {} : { gpu }),
  ...(vram === undefined ? {} : { vram: Math.round(vram) }),
});

/** What a tool printed, or nothing when it did not run to a clean end in time. */
const ask = (command: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(command, [...args], {
        stdin: "ignore",
        stderr: "ignore",
        forceKillAfter: "1 second",
      })
    );
    const [stdout, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
      { concurrency: "unbounded" }
    );
    return exitCode === 0 ? Option.some(stdout) : Option.none<string>();
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(TOOL_TIMEOUT),
    Effect.map(Option.flatten),
    Effect.catch(() => Effect.succeed(Option.none<string>()))
  );

const linuxCard = Effect.gen(function* () {
  const nvidia = yield* ask("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (Option.isSome(nvidia)) {
    const [name, megabytes] = (nvidia.value.split(LINE_BREAK)[0] ?? "").split(
      ", "
    );
    const memory = wholeNumber(megabytes);
    if (name !== undefined && name !== "" && memory !== undefined) {
      return card(name, memory / MIB_PER_GIB);
    }
  }
  const listed = yield* ask("lspci", []);
  const line = Option.getOrElse(listed, () => "")
    .split(LINE_BREAK)
    .find((candidate) => LSPCI_CARD.test(candidate));
  return card(line?.match(LSPCI_NAME)?.[1]?.trim(), undefined);
});

const macCard = Effect.map(
  ask("system_profiler", ["SPDisplaysDataType"]),
  Option.match({
    onNone: (): GraphicsCard => ({}),
    onSome: (report) => {
      const megabytes = wholeNumber(report.match(MACOS_VRAM)?.[1]);
      return card(
        report.match(MACOS_CHIP)?.[1]?.trim(),
        megabytes === undefined ? undefined : megabytes / MIB_PER_GIB
      );
    },
  })
);

const windowsCard = Effect.map(
  ask("wmic", [
    "path",
    "win32_VideoController",
    "get",
    "name,adapterram",
    "/format:csv",
  ]),
  Option.match({
    onNone: (): GraphicsCard => ({}),
    onSome: (csv) => {
      // The first line with text is the header: Node,AdapterRAM,Name.
      const [, adapterRam, name] = (
        csv
          .split(LINE_BREAK)
          .map((line) => line.trim())
          .filter((line) => line !== "")[1] ?? ""
      ).split(",");
      const bytes = wholeNumber(adapterRam);
      return card(name?.trim(), bytes === undefined ? undefined : bytes / GIB);
    },
  })
);

const graphicsCard = (platform: string): typeof linuxCard => {
  switch (platform) {
    case "linux":
      return linuxCard;
    case "darwin":
      return macCard;
    case "win32":
      return windowsCard;
    default:
      return Effect.succeed({});
  }
};

/** The specs of this machine. */
export const detectMachineSpecs = Effect.fn("detectMachineSpecs")(
  function* (): Effect.fn.Return<
    MachineSpecs,
    never,
    Machine | Installation | ChildProcessSpawner.ChildProcessSpawner
  > {
    const machine = yield* Machine;
    const { platform } = yield* Installation;
    return {
      ...(machine.cpu === undefined ? {} : { cpu: machine.cpu }),
      ram: Math.round(machine.memoryBytes / GIB),
      ...(yield* graphicsCard(platform)),
    };
  }
);
