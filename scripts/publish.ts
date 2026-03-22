#!/usr/bin/env bun

import { resolve } from "node:path";
import { $ } from "bun";

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

interface NpmVerificationResult {
  distTagVersion: string;
  packageName: string;
  publishedVersion: string;
  tag: string;
  verified: boolean;
}

const VERSION = process.env.VERSION || Bun.argv[2];
const NPM_TAG = process.env.NPM_TAG || "latest";

if (!VERSION) {
  console.error("Error: VERSION required");
  console.error("Usage: bun run scripts/publish.ts <version>");
  console.error("  version: semver version (e.g., 0.1.2)");
  process.exit(1);
}

function getCliManifestPath() {
  return resolve("packages/cli/dist/manifest.json");
}

function resolveCliDistributionPath(pathname: string) {
  return resolve("packages/cli", pathname);
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

  return rebuilt;
}

async function verifyNpmPackage(
  packageName: string,
  tag: string
): Promise<NpmVerificationResult> {
  const retryAttempts = 5;
  const retryDelayMs = 3000;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const publishedVersion = JSON.parse(
        (
          await $`npm view ${`${packageName}@${VERSION}`} version --json`.text()
        ).trim()
      ) as string;
      const distTags = JSON.parse(
        (await $`npm view ${packageName} dist-tags --json`.text()).trim()
      ) as Record<string, string>;
      const distTagVersion = distTags[tag] ?? "";
      const verified =
        publishedVersion === VERSION && distTagVersion === VERSION;

      if (!verified) {
        throw new Error(
          `metadata mismatch (version=${publishedVersion}, ${tag}=${distTagVersion})`
        );
      }

      return {
        packageName,
        tag,
        publishedVersion,
        distTagVersion,
        verified: true,
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retryAttempts) {
        console.log(
          `  waiting npm registry propagation for ${packageName} (attempt ${attempt}/${retryAttempts})...`
        );
        await Bun.sleep(retryDelayMs);
      }
    }
  }

  throw new Error(
    `Could not verify npm metadata for ${packageName}: ${lastError?.message ?? "unknown error"}`
  );
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

console.log("\nPublishing to npm...");

const npmVerificationResults: NpmVerificationResult[] = [];
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

try {
  console.log("\n--- gambi-sdk ---");
  await $`cd packages/sdk && npm publish --access public --tag ${NPM_TAG}`;
  npmVerificationResults.push(await verifyNpmPackage("gambi-sdk", NPM_TAG));
  console.log("  ✓ verified npm metadata");

  console.log("\n--- gambi-tui ---");
  await $`cd apps/tui && npm publish --access public --tag ${NPM_TAG}`;
  npmVerificationResults.push(await verifyNpmPackage("gambi-tui", NPM_TAG));
  console.log("  ✓ verified npm metadata");

  for (const binaryPackage of cliManifest.binaryPackages) {
    console.log(`\n--- ${binaryPackage.packageName} ---`);
    await $`cd ${resolveCliDistributionPath(binaryPackage.packageDir)} && npm publish --access public --tag ${NPM_TAG}`;
    npmVerificationResults.push(
      await verifyNpmPackage(binaryPackage.packageName, NPM_TAG)
    );
    console.log("  ✓ verified npm metadata");
  }

  console.log("\n--- gambi ---");
  await $`cd ${resolveCliDistributionPath(cliManifest.wrapperPackageDir)} && npm publish --access public --tag ${NPM_TAG}`;
  npmVerificationResults.push(await verifyNpmPackage("gambi", NPM_TAG));
  console.log("  ✓ verified npm metadata");

  await writeReleaseReport("success");
  console.log(`\n=== Published v${VERSION} successfully ===\n`);
} catch (error) {
  const publishError = error as Error;
  console.error(`\nPublish failed: ${publishError.message}`);
  await writeReleaseReport("failed", publishError.message);
  throw publishError;
}
