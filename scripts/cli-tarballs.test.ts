import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { validateCliTarballs } from "./cli-tarballs";

const VERSION = "0.7.2";
const BINARIES = ["gambi-linux-x64", "gambi-windows-x64"];
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
});

interface FakePackage {
  bin?: string;
  binMode?: number;
  json: Record<string, unknown>;
}

function binary(name: string, overrides: Partial<FakePackage> = {}) {
  return {
    bin: name.includes("windows") ? "gambi.exe" : "gambi",
    binMode: 0o755,
    json: { name, version: VERSION, publishConfig: { access: "public" } },
    ...overrides,
  } satisfies FakePackage;
}

function wrapper(overrides: Partial<FakePackage> = {}) {
  return {
    bin: "gambi",
    binMode: 0o755,
    json: {
      name: "gambi",
      version: VERSION,
      scripts: { postinstall: "node ./postinstall.mjs" },
      optionalDependencies: Object.fromEntries(
        BINARIES.map((name) => [name, VERSION])
      ),
    },
    ...overrides,
  } satisfies FakePackage;
}

/** Writes real .tgz files with `tar`, keeping the given file modes. */
async function tarballs(packages: FakePackage[]) {
  const root = await mkdtemp(join(tmpdir(), "gambi-tarballs-"));
  roots.push(root);
  const out = join(root, "out");
  await mkdir(out);
  for (const [index, pkg] of packages.entries()) {
    const work = join(root, `pkg-${index}`);
    await mkdir(join(work, "package/bin"), { recursive: true });
    await writeFile(
      join(work, "package/package.json"),
      JSON.stringify(pkg.json)
    );
    if (pkg.bin) {
      const bin = join(work, "package/bin", pkg.bin);
      await writeFile(bin, "binary");
      await chmod(bin, pkg.binMode ?? 0o755);
    }
    await $`tar -czf ${join(out, `${index}.tgz`)} package`.cwd(work).quiet();
  }
  return out;
}

const validate = (dir: string) =>
  validateCliTarballs({ binaries: BINARIES, dir, version: VERSION });

const fullSet = () => [...BINARIES.map((name) => binary(name)), wrapper()];

describe("validateCliTarballs", () => {
  test("accepts the full set and maps names to files", async () => {
    const dir = await tarballs(fullSet());

    const byName = await validate(dir);

    expect([...byName.keys()].sort()).toEqual([...BINARIES, "gambi"].sort());
  });

  test("rejects a binary without the executable bit (#83)", async () => {
    const dir = await tarballs([
      binary("gambi-linux-x64", { binMode: 0o644 }),
      binary("gambi-windows-x64"),
      wrapper(),
    ]);

    await expect(validate(dir)).rejects.toThrow(
      "gambi-linux-x64: package/bin/gambi is -rw-r--r--, not executable"
    );
  });

  test("rejects a wrong version, a missing package, and an unexpected one", async () => {
    const dir = await tarballs([
      binary("gambi-linux-x64", {
        json: { name: "gambi-linux-x64", version: "0.7.1" },
      }),
      binary("gambi-evil"),
      wrapper(),
    ]);

    const message = await validate(dir).catch((error: Error) => error.message);

    expect(message).toContain("gambi-linux-x64: version 0.7.1, expected 0.7.2");
    expect(message).toContain("unexpected package gambi-evil");
    expect(message).toContain("gambi-windows-x64: missing tarball");
  });

  test("rejects a registry override and install scripts on a binary", async () => {
    const dir = await tarballs([
      binary("gambi-linux-x64", {
        json: {
          name: "gambi-linux-x64",
          version: VERSION,
          publishConfig: { registry: "https://evil.example" },
          scripts: { postinstall: "curl evil" },
        },
      }),
      binary("gambi-windows-x64"),
      wrapper(),
    ]);

    const message = await validate(dir).catch((error: Error) => error.message);

    expect(message).toContain("gambi-linux-x64: publishConfig sets registry");
    expect(message).toContain(
      "gambi-linux-x64: has install scripts: postinstall"
    );
  });

  test("rejects a wrapper whose optionalDependencies do not pin the binaries", async () => {
    const dir = await tarballs([
      ...BINARIES.map((name) => binary(name)),
      wrapper({
        json: {
          name: "gambi",
          version: VERSION,
          optionalDependencies: { "gambi-linux-x64": "^0.7.0" },
        },
      }),
    ]);

    await expect(validate(dir)).rejects.toThrow(
      "gambi: optionalDependencies must pin gambi-linux-x64, gambi-windows-x64 at 0.7.2"
    );
  });

  test("rejects two tarballs of the same package", async () => {
    const dir = await tarballs([...fullSet(), binary("gambi-linux-x64")]);

    await expect(validate(dir)).rejects.toThrow(
      "gambi-linux-x64: two tarballs"
    );
  });
});
