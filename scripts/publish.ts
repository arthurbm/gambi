#!/usr/bin/env bun

import { resolve } from "node:path";
import { $ } from "bun";
import {
  packCliTarballs,
  TARBALL_DIR,
  validateCliTarballs,
} from "./cli-tarballs";
import {
  NpmReleaseError,
  type NpmVerificationResult,
  publishAndVerify,
  type ReleasePackage,
} from "./npm-release";

interface CliDistributionManifest {
  binaryPackages: Array<{
    assetName: string;
    packageDir: string;
    packageName: string;
    releaseAssetPath: string;
    sha256?: string;
    sizeBytes?: number;
  }>;
  releaseAssets?: Array<{
    assetName: string;
    releaseAssetPath: string;
    sha256?: string;
    sizeBytes?: number;
  }>;
  releaseAssetPaths?: string[];
  version: string;
  wrapperPackageDir: string;
}

const VERSION = process.env.VERSION || Bun.argv[2];
const NPM_TAG = process.env.NPM_TAG || "latest";
// How long each group waits for npm to show its packages. Running out of time
// does not mean a publish failed: npm may still be processing it.
const WAIT_TIMEOUT_MS =
  Number(process.env.GAMBI_NPM_WAIT_MINUTES || "30") * 60_000;

if (!VERSION) {
  console.error("Error: VERSION required");
  console.error("Usage: bun run scripts/publish.ts <version>");
  console.error("  version: semver version (e.g., 0.1.2)");
  process.exit(1);
}

function getCliManifestPath() {
  return resolve("packages/cli/dist/manifest.json");
}

async function readCliManifest() {
  const file = Bun.file(getCliManifestPath());
  if (!(await file.exists())) {
    return undefined;
  }

  return (await file.json()) as CliDistributionManifest;
}

async function ensureCliDistribution() {
  const existing = await readCliManifest();
  if (existing?.version === VERSION) {
    console.log(`Using existing CLI distribution for v${VERSION}`);
    return existing;
  }

  console.log(`Building CLI distribution for v${VERSION}...`);
  await $`GAMBI_RELEASE_VERSION=${VERSION} bun run --cwd packages/cli build`;

  const rebuilt = await readCliManifest();
  if (!rebuilt || rebuilt.version !== VERSION) {
    throw new Error(
      "CLI distribution manifest is missing or has the wrong version"
    );
  }

  console.log("Packing CLI tarballs...");
  await packCliTarballs(rebuilt);
  return rebuilt;
}

console.log(`\n=== Publishing Gambi v${VERSION} ===\n`);
console.log(`npm tag: ${NPM_TAG}\n`);

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({ absolute: true })
).then((arr) =>
  arr.filter(
    (pathname) =>
      !(pathname.includes("node_modules") || pathname.includes("dist"))
  )
);

console.log("Updating package versions...");
for (const file of pkgjsons) {
  const content = await Bun.file(file).text();
  const updated = content.replace(
    /"version": "[^"]+"/,
    `"version": "${VERSION}"`
  );
  await Bun.file(file).write(updated);
  console.log(`  ✓ ${file.replace(process.cwd(), ".")}`);
}

console.log("\nInstalling dependencies...");
await $`bun install`;

console.log("\nBuilding publishable artifacts...");
await $`bun run --cwd packages/sdk build`;
await $`bun run --cwd apps/tui build`;

const cliManifest = await ensureCliDistribution();

// The CLI packages publish from the tarballs build-cli packed (file modes
// survive in a tarball, not in a workflow artifact; #83). Check all of them
// before publishing any.
const cliTarballs = await validateCliTarballs({
  binaries: cliManifest.binaryPackages.map((pkg) => pkg.packageName),
  dir: TARBALL_DIR,
  version: VERSION,
});
const cliTarball = (name: string) => {
  const tarball = cliTarballs.get(name);
  if (!tarball) {
    throw new Error(`No tarball for ${name}`);
  }
  return tarball;
};

console.log("\nCLI distribution summary:");
console.log(`  version: ${cliManifest.version}`);
console.log(`  wrapper: ${cliManifest.wrapperPackageDir}`);
console.log("  binary packages:");
for (const pkg of cliManifest.binaryPackages) {
  const size = pkg.sizeBytes ?? "unknown";
  const hash = pkg.sha256 ? `sha256:${pkg.sha256.slice(0, 12)}...` : "no hash";
  console.log(
    `    - ${pkg.packageName} (${pkg.assetName}, ${size} bytes, ${hash})`
  );
}

const releaseAssets =
  cliManifest.releaseAssets ??
  cliManifest.releaseAssetPaths?.map((releaseAssetPath) => ({
    assetName: releaseAssetPath.split("/").at(-1) ?? releaseAssetPath,
    releaseAssetPath,
    sha256: "",
    sizeBytes: 0,
  })) ??
  [];

console.log("  release assets:");
for (const asset of releaseAssets) {
  console.log(
    `    - ${asset.assetName} (${asset.sizeBytes} bytes${asset.sha256 ? `, sha256:${asset.sha256.slice(0, 12)}...` : ""})`
  );
}

let npmVerificationResults: NpmVerificationResult[] = [];
const releaseReportPath = resolve("packages/cli/dist/release-report.json");

async function writeReleaseReport(status: string, error?: string) {
  const releaseReport: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    npmTag: NPM_TAG,
    version: VERSION,
    status,
    cliDistribution: {
      wrapperPackageDir: cliManifest.wrapperPackageDir,
      binaryPackages: cliManifest.binaryPackages,
      releaseAssets,
    },
    npmVerification: npmVerificationResults,
  };
  if (error) {
    releaseReport.error = error;
  }
  await Bun.write(
    releaseReportPath,
    `${JSON.stringify(releaseReport, null, 2)}\n`
  );
  console.log(`\nWrote release report (${status}) to ${releaseReportPath}`);
}

// The wrapper lists the platform packages as optionalDependencies pinned to
// this version. npm publishes it without checking them, but an install that
// resolves the wrapper before npm shows its binary skips the missing optional
// dependency and leaves `gambi` without a binary. So the wrapper is published
// only after npm shows every other package.
const basePackages: ReleasePackage[] = [
  { name: "gambi-sdk", dir: resolve("packages/sdk") },
  { name: "gambi-tui", dir: resolve("apps/tui") },
  ...cliManifest.binaryPackages.map((binaryPackage) => ({
    name: binaryPackage.packageName,
    tarball: cliTarball(binaryPackage.packageName),
  })),
];
const wrapperPackage: ReleasePackage = {
  name: "gambi",
  tarball: cliTarball("gambi"),
};

try {
  console.log("\nPublishing SDK, TUI, and platform binaries to npm...");
  npmVerificationResults = await publishAndVerify({
    packages: basePackages,
    tag: NPM_TAG,
    version: VERSION,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
  });

  console.log("\nPublishing the gambi wrapper to npm...");
  npmVerificationResults = [
    ...npmVerificationResults,
    ...(await publishAndVerify({
      packages: [wrapperPackage],
      tag: NPM_TAG,
      version: VERSION,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
    })),
  ];

  await writeReleaseReport("success");
  console.log(`\n=== Published v${VERSION} successfully ===\n`);
} catch (error) {
  const publishError = error as Error;
  if (publishError instanceof NpmReleaseError) {
    npmVerificationResults = [
      ...npmVerificationResults,
      ...publishError.verified,
    ];
  }
  console.error(`\nPublish failed: ${publishError.message}`);
  await writeReleaseReport("failed", publishError.message);
  throw publishError;
}
