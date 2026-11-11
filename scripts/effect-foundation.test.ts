import { afterEach, describe, expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Guards of the Effect v4 foundation (ADR-0007): one exact `effect` version
 * in the whole workspace, and a protocol package with no platform dependency.
 */

const ROOT = resolve(import.meta.dir, "..");
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const EFFECT_PACKAGE = /^(effect|@effect\/.+)$/;
const LOCKED_EFFECT = /"effect@([^"]+)"/g;
const PLATFORM_PACKAGE =
  /^(@effect\/platform-.+|@types\/(bun|node)|bun-types)$/;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  peerDependencies?: Record<string, string>;
}

async function workspaceManifests(): Promise<Manifest[]> {
  const manifests: Manifest[] = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(join(ROOT, group))) {
      const file = Bun.file(join(ROOT, group, entry, "package.json"));
      if (await file.exists()) {
        manifests.push(await file.json());
      }
    }
  }
  return manifests;
}

const allDependencies = (manifest: Manifest) =>
  Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  });

describe("effect dependency", () => {
  test("every workspace declares the same exact version of effect and @effect/*", async () => {
    const declared = (await workspaceManifests()).flatMap((manifest) =>
      allDependencies(manifest)
        .filter(([name]) => EFFECT_PACKAGE.test(name))
        .map(([name, range]) => ({ name, range, workspace: manifest.name }))
    );

    expect(declared.map((entry) => entry.name)).toContain("effect");
    expect(declared.map((entry) => entry.name)).toContain(
      "@effect/platform-bun"
    );
    expect(
      declared.filter((entry) => !EXACT_VERSION.test(entry.range))
    ).toEqual([]);
    expect(new Set(declared.map((entry) => entry.range)).size).toBe(1);
  });

  test("the lockfile resolves a single copy of effect", async () => {
    const lockfile = await Bun.file(join(ROOT, "bun.lock")).text();
    const resolved = [...lockfile.matchAll(LOCKED_EFFECT)].map(
      (match) => match[1]
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatch(EXACT_VERSION);
  });
});

describe("@gambi/protocol has no platform dependency", () => {
  const probe = join(ROOT, "packages/protocol/src/lint-probe.ts");
  const coreProbe = join(ROOT, "packages/core/src/lint-probe.ts");
  const hubProbe = join(ROOT, "packages/core/src/hub/lint-probe.ts");
  const runtimeProbe = join(
    ROOT,
    "packages/core/src/participant/lint-probe.ts"
  );
  const cliProbe = join(ROOT, "packages/cli/src/cli/commands/lint-probe.ts");

  afterEach(async () => {
    await rm(probe, { force: true });
    await rm(coreProbe, { force: true });
    await rm(hubProbe, { force: true });
    await rm(runtimeProbe, { force: true });
    await rm(cliProbe, { force: true });
  });

  /** Lints `source` as a file at `path` and returns the rules it breaks. */
  async function brokenRules(path: string, source: string): Promise<string[]> {
    await Bun.write(path, source);
    const biome = Bun.spawn(
      ["bun", "x", "biome", "lint", "--reporter=json", path],
      { cwd: ROOT, stderr: "ignore", stdout: "pipe" }
    );
    const report = await new Response(biome.stdout).json();
    await biome.exited;
    return report.diagnostics.map(
      (diagnostic: { category: string }) => diagnostic.category
    );
  }

  test.each([
    ["Bun.*", "export const version = Bun.version;\n", "noRestrictedGlobals"],
    [
      "process",
      "export const home = process.env.HOME;\n",
      "noRestrictedGlobals",
    ],
    [
      "bun:* modules",
      'import { Database } from "bun:sqlite";\nexport const open = () => new Database();\n',
      "noRestrictedImports",
    ],
    [
      "node:* modules",
      'import { readFile } from "node:fs/promises";\nexport const read = () => readFile("x");\n',
      "noRestrictedImports",
    ],
    [
      "@effect/platform-bun",
      'import { BunRuntime } from "@effect/platform-bun";\nexport const run = BunRuntime.runMain;\n',
      "noRestrictedImports",
    ],
  ])("lint rejects %s in the protocol package", async (_label, source, rule) => {
    expect(await brokenRules(probe, source)).toEqual([`lint/style/${rule}`]);
  });

  test("lint accepts effect in the protocol package", async () => {
    const source =
      'import { Effect } from "effect";\nexport const nothing = Effect.void;\n';
    expect(await brokenRules(probe, source)).toEqual([]);
  });

  test("the rule is scoped to the protocol package", async () => {
    const source = "export const version = Bun.version;\n";
    expect(await brokenRules(coreProbe, source)).toEqual([]);
  });

  test.each([
    ["Bun.*", "export const version = Bun.version;\n", "noRestrictedGlobals"],
    [
      "@effect/platform-bun",
      'import { BunRuntime } from "@effect/platform-bun";\nexport const run = BunRuntime.runMain;\n',
      "noRestrictedImports",
    ],
  ])("lint rejects %s in the new hub", async (_label, source, rule) => {
    expect(await brokenRules(hubProbe, source)).toEqual([`lint/style/${rule}`]);
  });

  test.each([
    ["Bun.*", "export const version = Bun.version;\n", "noRestrictedGlobals"],
    [
      "@effect/platform-bun",
      'import { BunRuntime } from "@effect/platform-bun";\nexport const run = BunRuntime.runMain;\n',
      "noRestrictedImports",
    ],
  ])("lint rejects %s in the new participant runtime", async (_label, source, rule) => {
    expect(await brokenRules(runtimeProbe, source)).toEqual([
      `lint/style/${rule}`,
    ]);
  });

  test.each([
    ["Bun.*", "export const version = Bun.version;\n", "noRestrictedGlobals"],
    [
      "@effect/platform-bun",
      'import { BunRuntime } from "@effect/platform-bun";\nexport const run = BunRuntime.runMain;\n',
      "noRestrictedImports",
    ],
  ])("lint rejects %s in the commands of the new CLI", async (_label, source, rule) => {
    expect(await brokenRules(cliProbe, source)).toEqual([`lint/style/${rule}`]);
  });

  test("its manifest depends on no platform package", async () => {
    const manifest: Manifest = await Bun.file(
      join(ROOT, "packages/protocol/package.json")
    ).json();
    const platform = allDependencies(manifest)
      .map(([name]) => name)
      .filter((name) => PLATFORM_PACKAGE.test(name));

    expect(platform).toEqual([]);
  });
});
