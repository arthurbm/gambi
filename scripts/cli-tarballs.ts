#!/usr/bin/env bun
/**
 * Packs the CLI npm packages (5 platform binaries + the `gambi` wrapper) into
 * tarballs and validates them before publishing.
 *
 * `actions/upload-artifact` drops file modes, so binaries that crossed from
 * `build-cli` to `publish` as loose files reached npm as 0644 (#83). A tarball
 * keeps the mode, so `build-cli` packs right after building and `publish`
 * publishes those exact files.
 *
 * Usage:
 *   bun run scripts/cli-tarballs.ts pack <version>      # in build-cli
 *   bun run scripts/cli-tarballs.ts validate <version>
 */
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

export const CLI_DIR = resolve(import.meta.dir, "../packages/cli");
export const TARBALL_DIR = join(CLI_DIR, "dist/tarballs");
export const WRAPPER_NAME = "gambi";

interface CliManifest {
  binaryPackages: Array<{ packageDir: string; packageName: string }>;
  version: string;
  wrapperPackageDir: string;
}

interface TarballPackageJson {
  name?: string;
  optionalDependencies?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  scripts?: Record<string, string>;
  version?: string;
}

export interface TarballContents {
  /** Mode string from `tar -tv` (`-rwxr-xr-x`) per path. */
  modes: Map<string, string>;
  packageJson: TarballPackageJson;
}

export async function readCliManifest(): Promise<CliManifest> {
  return (await Bun.file(
    join(CLI_DIR, "dist/manifest.json")
  ).json()) as CliManifest;
}

export async function readTarball(file: string): Promise<TarballContents> {
  const packageJson = JSON.parse(
    await $`tar -xzOf ${file} package/package.json`.quiet().text()
  ) as TarballPackageJson;
  const modes = new Map<string, string>();
  for (const line of (await $`tar -tvzf ${file}`.quiet().text()).split("\n")) {
    const fields = line.trim().split(WHITESPACE);
    const mode = fields[0];
    const path = fields.at(-1);
    if (mode && path) {
      modes.set(path, mode);
    }
  }
  return { packageJson, modes };
}

const WHITESPACE = /\s+/;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];
const isExecutable = (mode: string) =>
  mode[3] === "x" && mode[6] === "x" && mode[9] === "x";

/** Problems with one tarball; empty when it is fine. */
export function checkTarball(
  contents: TarballContents,
  expected: { binaries: string[]; version: string }
): string[] {
  const { packageJson: pkg, modes } = contents;
  const name = pkg.name ?? "(no name)";
  const isWrapper = name === WRAPPER_NAME;
  const problems: string[] = [];

  if (!(isWrapper || expected.binaries.includes(name))) {
    return [`unexpected package ${name}`];
  }
  if (pkg.version !== expected.version) {
    problems.push(`version ${pkg.version}, expected ${expected.version}`);
  }
  const config = Object.keys(pkg.publishConfig ?? {}).filter(
    (key) => key !== "access"
  );
  if (config.length > 0) {
    problems.push(`publishConfig sets ${config.join(", ")}`);
  }
  const scripts = INSTALL_SCRIPTS.filter((script) => pkg.scripts?.[script]);
  if (!isWrapper && scripts.length > 0) {
    problems.push(`has install scripts: ${scripts.join(", ")}`);
  }

  const binPath = ["package/bin/gambi", "package/bin/gambi.exe"].find((path) =>
    modes.has(path)
  );
  const binMode = binPath ? modes.get(binPath) : undefined;
  if (!(binPath && binMode)) {
    problems.push("has no bin/gambi");
  } else if (!isExecutable(binMode)) {
    problems.push(`${binPath} is ${binMode}, not executable`);
  }

  if (isWrapper) {
    const deps = pkg.optionalDependencies ?? {};
    const wrong = expected.binaries.filter(
      (binary) => deps[binary] !== expected.version
    );
    const extra = Object.keys(deps).filter(
      (dep) => !expected.binaries.includes(dep)
    );
    if (wrong.length > 0 || extra.length > 0) {
      problems.push(
        `optionalDependencies must pin ${expected.binaries.join(", ")} at ${expected.version}`
      );
    }
  }

  return problems.map((problem) => `${name}: ${problem}`);
}

/**
 * Checks every tarball in `dir` against the expected set and returns
 * package name -> tarball path. Throws with every problem found.
 */
export async function validateCliTarballs(options: {
  binaries: string[];
  dir: string;
  version: string;
}) {
  const { binaries, dir, version } = options;
  const files = (await readdir(dir).catch(() => []))
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(dir, file));
  const byName = new Map<string, string>();
  const problems: string[] = [];

  for (const file of files) {
    const contents = await readTarball(file);
    const name = contents.packageJson.name ?? file;
    problems.push(
      ...checkTarball(contents, { binaries, version }).map(
        (problem) => `${problem} (${file})`
      )
    );
    if (byName.has(name)) {
      problems.push(`${name}: two tarballs (${byName.get(name)}, ${file})`);
    }
    byName.set(name, file);
  }
  for (const name of [...binaries, WRAPPER_NAME]) {
    if (!byName.has(name)) {
      problems.push(`${name}: missing tarball in ${dir}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid CLI tarballs:\n  ${problems.join("\n  ")}`);
  }
  return byName;
}

/** chmod 755 each package's bin/ files, then `npm pack` it into TARBALL_DIR. */
export async function packCliTarballs(manifest: CliManifest) {
  await rm(TARBALL_DIR, { recursive: true, force: true });
  await mkdir(TARBALL_DIR, { recursive: true });
  const dirs = [
    ...manifest.binaryPackages.map((pkg) => pkg.packageDir),
    manifest.wrapperPackageDir,
  ].map((dir) => resolve(CLI_DIR, dir));

  for (const dir of dirs) {
    for (const file of await readdir(join(dir, "bin"))) {
      await chmod(join(dir, "bin", file), 0o755);
    }
    await $`npm pack ${dir} --pack-destination ${TARBALL_DIR} --ignore-scripts`.quiet();
  }
}

if (import.meta.main) {
  const [command, version] = Bun.argv.slice(2);
  if (!(command && version && ["pack", "validate"].includes(command))) {
    console.error(
      "Usage: bun run scripts/cli-tarballs.ts pack|validate <version>"
    );
    process.exit(2);
  }
  const manifest = await readCliManifest();
  if (manifest.version !== version) {
    console.error(
      `dist/manifest.json is for ${manifest.version}, not ${version}`
    );
    process.exit(1);
  }
  if (command === "pack") {
    await packCliTarballs(manifest);
  }
  const tarballs = await validateCliTarballs({
    binaries: manifest.binaryPackages.map((pkg) => pkg.packageName),
    dir: TARBALL_DIR,
    version,
  });
  for (const [name, file] of tarballs) {
    const { modes } = await readTarball(file);
    const bin = modes.has("package/bin/gambi")
      ? "package/bin/gambi"
      : "package/bin/gambi.exe";
    console.log(`✓ ${name}: ${file} (${bin} ${modes.get(bin)})`);
  }
}
