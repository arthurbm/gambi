import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { FAKE_MODEL, fakeProvider } from "@gambi/core/testing/provider";
import { layer } from "@gambi/testing/effect";
import { Effect, PlatformError } from "effect";
import {
  type RunOptions,
  type SpawnedCommand,
  type SubprocessScript,
  spawnerThat,
  startCommand,
} from "./testing.ts";

const GIB = 1024 ** 3;

const notInstalled = (command: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "ChildProcess",
    method: "spawn",
    description: `spawn ${command} ENOENT`,
  });

/**
 * Joins a room on a machine where the commands in `tools` answer and every
 * other one is not installed, and answers the specs the room was told.
 */
const specsToldToTheRoom = (
  tools: Readonly<Record<string, SubprocessScript>>,
  options: RunOptions = {},
  ...flags: readonly string[]
) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const provider = yield* fakeProvider();
    const { room } = yield* client.rooms.create({ payload: { name: "Specs" } });
    const spawned: SpawnedCommand[] = [];

    const joining = yield* startCommand(
      [
        "participant",
        "join",
        "--room",
        room.code,
        "--participant-id",
        "arthur-1",
        "--model",
        FAKE_MODEL,
        "--endpoint",
        provider.url,
        "--hub",
        hub.url,
        ...flags,
      ],
      {
        machine: { cpu: "Ryzen 7 5800X", memoryBytes: 31.3 * GIB },
        spawner: spawnerThat((command) => {
          spawned.push(command);
          return tools[command.command] ?? notInstalled(command.command);
        }),
        ...options,
      }
    );
    const registered = yield* joining.nextEvent;
    yield* joining.signal("SIGINT");
    yield* joining.result;
    return {
      specs: (registered.data.participant as { specs: unknown }).specs,
      spawned: spawned.map(({ args, command }) => [command, ...args].join(" ")),
    };
  });

layer(layerHub(), { excludeTestServices: true })(
  "the machine specs a participant tells the room",
  (it) => {
    it.effect("an NVIDIA card is read from nvidia-smi, with its memory", () =>
      Effect.gen(function* () {
        const { spawned, specs } = yield* specsToldToTheRoom({
          "nvidia-smi": { stdout: "NVIDIA GeForce RTX 4090, 24564\n" },
        });

        expect(specs).toEqual({
          cpu: "Ryzen 7 5800X",
          ram: 31,
          gpu: "NVIDIA GeForce RTX 4090",
          vram: 24,
        });
        expect(spawned).toEqual([
          "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
        ]);
      })
    );

    it.effect("without nvidia-smi the card is the one lspci lists", () =>
      Effect.gen(function* () {
        const { specs } = yield* specsToldToTheRoom({
          lspci: {
            stdout: [
              "00:00.0 Host bridge: Advanced Micro Devices, Inc. [AMD] Starship/Matisse Root Complex",
              "0a:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 22 [Radeon RX 6700 XT] (rev c1)",
              "",
            ].join("\n"),
          },
        });

        expect(specs).toEqual({
          cpu: "Ryzen 7 5800X",
          ram: 31,
          gpu: "Advanced Micro Devices, Inc. [AMD/ATI] Navi 22 [Radeon RX 6700 XT] (rev c1)",
        });
      })
    );

    it.effect(
      "a machine with no tool that names a card tells CPU and memory",
      () =>
        Effect.gen(function* () {
          const { specs } = yield* specsToldToTheRoom({
            "nvidia-smi": { exitCode: 9, stderr: "No devices were found" },
          });

          expect(specs).toEqual({ cpu: "Ryzen 7 5800X", ram: 31 });
        })
    );

    it.effect("on macOS the card is read from system_profiler", () =>
      Effect.gen(function* () {
        const { spawned, specs } = yield* specsToldToTheRoom(
          {
            system_profiler: {
              stdout:
                "Graphics/Displays:\n\n    Apple M2 Pro:\n\n      Chipset Model: Apple M2 Pro\n      Type: GPU\n      VRAM (Total): 16384 MB\n",
            },
          },
          { installation: { platform: "darwin" } }
        );

        expect(specs).toEqual({
          cpu: "Ryzen 7 5800X",
          ram: 31,
          gpu: "Apple M2 Pro",
          vram: 16,
        });
        expect(spawned).toEqual(["system_profiler SPDisplaysDataType"]);
      })
    );

    it.effect("on Windows the card is read from wmic", () =>
      Effect.gen(function* () {
        const { specs } = yield* specsToldToTheRoom(
          {
            wmic: {
              stdout:
                "\r\nNode,AdapterRAM,Name\r\nDESKTOP,8589934592,NVIDIA GeForce RTX 3070\r\n",
            },
          },
          { installation: { platform: "win32" } }
        );

        expect(specs).toEqual({
          cpu: "Ryzen 7 5800X",
          ram: 31,
          gpu: "NVIDIA GeForce RTX 3070",
          vram: 8,
        });
      })
    );

    it.effect("--no-specs tells the room nothing and runs no tool", () =>
      Effect.gen(function* () {
        const { spawned, specs } = yield* specsToldToTheRoom(
          { "nvidia-smi": { stdout: "NVIDIA GeForce RTX 4090, 24564\n" } },
          {},
          "--no-specs"
        );

        expect(specs).toEqual({});
        expect(spawned).toEqual([]);
      })
    );
  }
);
