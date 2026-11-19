import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/**
 * What left the repository with the old hub, runtimes and CLI (ADR-0007),
 * and must not come back: zod in the core and in the SDK, the libraries of
 * the old CLI, and state kept in a module of the core.
 */

const ROOT = resolve(import.meta.dir, "..");
const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

/** Declared by the old hub and never answered (`ENDPOINT_NOT_REACHABLE` and the rest). */
const UNUSED_ERROR_CODE =
  /\b(?:ENDPOINT_NOT_REACHABLE|PARTICIPANT_CONFLICT|PARTICIPANT_BUSY|MODEL_NOT_FOUND|PARTICIPANT_TUNNEL_NOT_CONNECTED)\b/;

const ZOD_IMPORT = /from\s+["']zod(?:\/[^"']*)?["']|require\(["']zod/;

/**
 * A binding of the module that can change, or a container made empty to be
 * filled later. A constant table (`new Set([401, 403])`) is not state.
 */
const MODULE_STATE: readonly (readonly [string, RegExp])[] = [
  ["let or var at the top of the module", /^(?:export\s+)?(?:let|var)\s/],
  [
    "an empty container at the top of the module",
    /^(?:export\s+)?const\s+\w+(?::[^=]+)?\s*=\s*(?:new\s+(?:Map|Set|WeakMap|WeakSet|Array)(?:<[^>]*>)?\(\s*\)|\[\s*\]|\{\s*\})\s*;?\s*$/,
  ],
  [
    "a mutable reference at the top of the module",
    /^(?:export\s+)?const\s+\w+(?::[^=]+)?\s*=\s*(?:MutableRef|MutableHashMap|MutableHashSet|MutableList|MutableQueue)\./,
  ],
];

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const dependenciesOf = async (workspace: string): Promise<string[]> => {
  const manifest: Manifest = await Bun.file(
    join(ROOT, workspace, "package.json")
  ).json();
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  });
};

/** Every source file under `folder`, as `[path from the root, text]`. */
async function sources(folder: string): Promise<[string, string][]> {
  const found: [string, string][] = [];
  for (const entry of await readdir(join(ROOT, folder), {
    withFileTypes: true,
  })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        found.push(...(await sources(path)));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push([
        relative(ROOT, join(ROOT, path)).split(sep).join("/"),
        await Bun.file(join(ROOT, path)).text(),
      ]);
    }
  }
  return found;
}

describe("zod", () => {
  const WITHOUT_ZOD = ["packages/core", "packages/sdk", "packages/protocol"];

  test.each(WITHOUT_ZOD)("%s does not depend on zod", async (workspace) => {
    expect(await dependenciesOf(workspace)).not.toContain("zod");
  });

  test.each(WITHOUT_ZOD)("%s does not import zod", async (workspace) => {
    const importing = (await sources(workspace))
      .filter(([, text]) => ZOD_IMPORT.test(text))
      .map(([file]) => file);

    expect(importing).toEqual([]);
  });

  test("the root does not provide zod to the workspaces that do not declare it", async () => {
    expect(await dependenciesOf(".")).not.toContain("zod");
  });
});

describe("the old CLI", () => {
  test("its command and prompt libraries are in no manifest", async () => {
    const workspaces = [
      ".",
      ...(await readdir(join(ROOT, "packages"))).map((name) =>
        join("packages", name)
      ),
    ];
    const declared = (
      await Promise.all(
        workspaces.map((workspace) => dependenciesOf(workspace))
      )
    ).flat();

    expect(declared).not.toContain("clipanion");
    expect(declared).not.toContain("@clack/prompts");
  });

  test("the binary is built from the Effect CLI", async () => {
    const build = await Bun.file(join(ROOT, "packages/cli/build.ts")).text();
    const manifest: { scripts: Record<string, string> } = await Bun.file(
      join(ROOT, "packages/cli/package.json")
    ).json();

    expect(build).toContain("bun build ./src/cli/main.ts --compile");
    expect(manifest.scripts.dev).toBe("bun run src/cli/main.ts");
    expect(await Bun.file(join(ROOT, "packages/cli/src/cli.ts")).exists()).toBe(
      false
    );
  });
});

describe("the error codes nothing answered with", () => {
  // `gambi-sdk` names one of them on purpose, as a code that must not type-check.
  const CONSUMER_PROBE = "packages/sdk/scripts/check-packed-types.ts";

  test("are in no package", async () => {
    const naming = (await sources("packages"))
      .filter(
        ([file, text]) =>
          file !== CONSUMER_PROBE && UNUSED_ERROR_CODE.test(text)
      )
      .map(([file]) => file);

    expect(naming).toEqual([]);
  });
});

describe("state in a module of the core", () => {
  const moduleState = (file: string, text: string) =>
    text
      .split("\n")
      .flatMap((line, index) =>
        MODULE_STATE.filter(([, pattern]) => pattern.test(line)).map(
          ([what]) => `${file}:${index + 1}: ${what}`
        )
      );

  test("recognizes a variable, an empty container and a mutable reference", () => {
    const source = [
      "let nextSession = 1;",
      "const sessions = new Map<string, string>();",
      "export const clients: Client[] = [];",
      "const registry = MutableHashMap.empty<string, Tunnel>();",
      "const REFUSALS = new Set([401, 403]);",
      "export const layer = Layer.effect(Rooms, make);",
      "  let insideAFunction = 0;",
    ].join("\n");

    expect(moduleState("x.ts", source)).toEqual([
      "x.ts:1: let or var at the top of the module",
      "x.ts:2: an empty container at the top of the module",
      "x.ts:3: an empty container at the top of the module",
      "x.ts:4: a mutable reference at the top of the module",
    ]);
  });

  // The test helpers under `testing/` are left out: `fixture-acp-agent.ts`
  // is a program of its own, run as a subprocess, and its module is its run.
  test.each([
    "packages/core/src",
    "packages/protocol/src",
  ])("%s keeps none: two hubs in one process share nothing", async (folder) => {
    const state = (await sources(folder))
      .filter(([file]) => !(TEST_FILE.test(file) || file.includes("/testing/")))
      .flatMap(([file, text]) => moduleState(file, text));

    expect(state).toEqual([]);
  });
});
