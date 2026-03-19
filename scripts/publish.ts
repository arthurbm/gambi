#!/usr/bin/env bun

import { resolve } from "node:path";
import { $ } from "bun";

interface CliDistributionManifest {
  binaryPackages: Array<{
    packageDir: string;
    packageName: string;
  }>;
  version: string;
  wrapperPackageDir: string;
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

const cliManifest = await ensureCliDistribution();

console.log("\nPublishing to npm...");

console.log("\n--- gambi-sdk ---");
await $`cd packages/sdk && npm publish --access public --tag ${NPM_TAG}`;

for (const binaryPackage of cliManifest.binaryPackages) {
  console.log(`\n--- ${binaryPackage.packageName} ---`);
  await $`cd ${resolveCliDistributionPath(binaryPackage.packageDir)} && npm publish --access public --tag ${NPM_TAG}`;
}

console.log("\n--- gambi ---");
await $`cd ${resolveCliDistributionPath(cliManifest.wrapperPackageDir)} && npm publish --access public --tag ${NPM_TAG}`;

console.log(`\n=== Published v${VERSION} successfully ===\n`);
