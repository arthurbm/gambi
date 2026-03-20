#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { $ } from "bun";

interface PlatformTarget {
  arch: "arm64" | "x64";
  assetName: string;
  binaryName: string;
  compileTarget: string;
  npmCpu: "arm64" | "x64";
  npmOs: "darwin" | "linux" | "win32";
  packageName: string;
  platform: "darwin" | "linux" | "windows";
}

interface BuildManifest {
  binaryPackages: Array<{
    assetName: string;
    packageDir: string;
    packageName: string;
    platform: PlatformTarget["platform"];
    releaseAssetPath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  releaseAssetPaths: string[];
  releaseAssets: Array<{
    assetName: string;
    releaseAssetPath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  version: string;
  wrapperPackageDir: string;
}

interface SourcePackage {
  author: string;
  bugs: string;
  description: string;
  homepage: string;
  keywords: string[];
  license: string;
  repository: {
    directory?: string;
    type: string;
    url: string;
  };
  version: string;
}

const TARGETS: PlatformTarget[] = [
  {
    platform: "linux",
    arch: "x64",
    compileTarget: "bun-linux-x64",
    packageName: "gambi-linux-x64",
    assetName: "gambi-linux-x64",
    binaryName: "gambi",
    npmOs: "linux",
    npmCpu: "x64",
  },
  {
    platform: "linux",
    arch: "arm64",
    compileTarget: "bun-linux-arm64",
    packageName: "gambi-linux-arm64",
    assetName: "gambi-linux-arm64",
    binaryName: "gambi",
    npmOs: "linux",
    npmCpu: "arm64",
  },
  {
    platform: "darwin",
    arch: "arm64",
    compileTarget: "bun-darwin-arm64",
    packageName: "gambi-darwin-arm64",
    assetName: "gambi-darwin-arm64",
    binaryName: "gambi",
    npmOs: "darwin",
    npmCpu: "arm64",
  },
  {
    platform: "darwin",
    arch: "x64",
    compileTarget: "bun-darwin-x64",
    packageName: "gambi-darwin-x64",
    assetName: "gambi-darwin-x64",
    binaryName: "gambi",
    npmOs: "darwin",
    npmCpu: "x64",
  },
  {
    platform: "windows",
    arch: "x64",
    compileTarget: "bun-windows-x64",
    packageName: "gambi-windows-x64",
    assetName: "gambi-windows-x64.exe",
    binaryName: "gambi.exe",
    npmOs: "win32",
    npmCpu: "x64",
  },
];

const DIST_DIR = resolve("./dist");
const DIST_NPM_DIR = join(DIST_DIR, "npm");
const DIST_RELEASES_DIR = join(DIST_DIR, "releases");
const WRAPPER_PACKAGE_DIR = join(DIST_NPM_DIR, "gambi");
const LICENSE_PATH = resolve("../../LICENSE");
const WRAPPER_BIN_SOURCE = resolve("./bin/gambi");
const WRAPPER_POSTINSTALL_SOURCE = resolve("./scripts/postinstall.mjs");
const WRAPPER_README_SOURCE = resolve("./README.md");

function toPosixPath(pathname: string) {
  return pathname.replaceAll("\\", "/");
}

async function writeJson(pathname: string, value: unknown) {
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`);
}

async function hashFileSha256(pathname: string) {
  const content = await Bun.file(pathname).arrayBuffer();
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

async function copyIfExists(source: string, target: string) {
  if (!(await Bun.file(source).exists())) {
    return;
  }

  await copyFile(source, target);
}

async function build() {
  const sourcePackage = (await Bun.file(
    "./package.json"
  ).json()) as SourcePackage;
  const version =
    process.env.GAMBI_RELEASE_VERSION?.trim() || sourcePackage.version;
  const versionDefine = `process.env.GAMBI_CLI_VERSION=${JSON.stringify(version)}`;

  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_RELEASES_DIR, { recursive: true });
  await mkdir(DIST_NPM_DIR, { recursive: true });
  console.log("✓ Cleaned dist/");

  const binaryPackages: BuildManifest["binaryPackages"] = [];
  const releaseAssetPaths: string[] = [];
  const releaseAssets: BuildManifest["releaseAssets"] = [];

  for (const target of TARGETS) {
    const releaseAssetPath = join(DIST_RELEASES_DIR, target.assetName);
    const packageDir = join(DIST_NPM_DIR, target.packageName);
    const packageBinaryDir = join(packageDir, "bin");
    const packageBinaryPath = join(packageBinaryDir, target.binaryName);

    console.log(`  Building ${target.assetName}...`);
    await mkdir(packageBinaryDir, { recursive: true });
    await $`bun build ./src/cli.ts --compile --target=${target.compileTarget} --define ${versionDefine} --outfile=${releaseAssetPath}`;
    await copyFile(releaseAssetPath, packageBinaryPath);

    if (target.platform !== "windows") {
      await chmod(releaseAssetPath, 0o755);
      await chmod(packageBinaryPath, 0o755);
    }

    const releaseAssetFile = Bun.file(releaseAssetPath);
    const sha256 = await hashFileSha256(releaseAssetPath);
    const sizeBytes = releaseAssetFile.size;

    await copyIfExists(LICENSE_PATH, join(packageDir, "LICENSE"));
    await writeJson(join(packageDir, "package.json"), {
      name: target.packageName,
      version,
      description: `${sourcePackage.description} (${target.platform} ${target.arch} binary)`,
      license: sourcePackage.license,
      repository: sourcePackage.repository,
      homepage: sourcePackage.homepage,
      bugs: sourcePackage.bugs,
      os: [target.npmOs],
      cpu: [target.npmCpu],
      publishConfig: {
        access: "public",
      },
    });

    binaryPackages.push({
      packageName: target.packageName,
      packageDir: toPosixPath(relative(process.cwd(), packageDir)),
      releaseAssetPath: toPosixPath(relative(process.cwd(), releaseAssetPath)),
      assetName: target.assetName,
      platform: target.platform,
      sha256,
      sizeBytes,
    });
    const relativeReleaseAssetPath = toPosixPath(
      relative(process.cwd(), releaseAssetPath)
    );
    releaseAssetPaths.push(relativeReleaseAssetPath);
    releaseAssets.push({
      assetName: target.assetName,
      releaseAssetPath: relativeReleaseAssetPath,
      sha256,
      sizeBytes,
    });
    console.log(`✓ Built ${target.assetName}`);
  }

  console.log("  Preparing wrapper package...");
  await mkdir(join(WRAPPER_PACKAGE_DIR, "bin"), { recursive: true });
  await copyFile(WRAPPER_BIN_SOURCE, join(WRAPPER_PACKAGE_DIR, "bin", "gambi"));
  await copyFile(
    WRAPPER_POSTINSTALL_SOURCE,
    join(WRAPPER_PACKAGE_DIR, "postinstall.mjs")
  );
  await copyIfExists(LICENSE_PATH, join(WRAPPER_PACKAGE_DIR, "LICENSE"));
  await copyFile(WRAPPER_README_SOURCE, join(WRAPPER_PACKAGE_DIR, "README.md"));
  await chmod(join(WRAPPER_PACKAGE_DIR, "bin", "gambi"), 0o755);

  await writeJson(join(WRAPPER_PACKAGE_DIR, "package.json"), {
    name: "gambi",
    version,
    description: sourcePackage.description,
    keywords: sourcePackage.keywords,
    author: sourcePackage.author,
    license: sourcePackage.license,
    repository: sourcePackage.repository,
    homepage: sourcePackage.homepage,
    bugs: sourcePackage.bugs,
    bin: {
      gambi: "./bin/gambi",
    },
    scripts: {
      postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
    },
    optionalDependencies: Object.fromEntries(
      binaryPackages.map((entry) => [entry.packageName, version])
    ),
    publishConfig: {
      access: "public",
    },
  });
  console.log("✓ Prepared wrapper package");

  const manifest: BuildManifest = {
    version,
    wrapperPackageDir: toPosixPath(
      relative(process.cwd(), WRAPPER_PACKAGE_DIR)
    ),
    binaryPackages,
    releaseAssetPaths,
    releaseAssets,
  };
  await writeJson(join(DIST_DIR, "manifest.json"), manifest);

  console.log(
    `\n✓ Build completed: wrapper + ${binaryPackages.length} binary packages`
  );
}

await build();
