#!/usr/bin/env bun

import { $ } from "bun";

const VERSION = process.env.VERSION || Bun.argv[2];
const PACKAGE = process.env.PACKAGE || Bun.argv[3] || "all";

if (!VERSION) {
  console.error("Error: VERSION required");
  console.error("Usage: bun run scripts/publish.ts <version> [package]");
  console.error("  version: semver version (e.g., 0.1.2)");
  console.error("  package: all | sdk | cli (default: all)");
  process.exit(1);
}

console.log(`\n=== Publishing Gambi v${VERSION} ===\n`);
console.log(`Package: ${PACKAGE}\n`);

// 1. Find and update all package.json files
const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({ absolute: true })
).then((arr) =>
  arr.filter((x) => !(x.includes("node_modules") || x.includes("dist")))
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

// 2. Install dependencies (in case lockfile needs update)
console.log("\nInstalling dependencies...");
await $`bun install`;

// 3. Build publishable artifacts
console.log("\nBuilding publishable artifacts...");
if (PACKAGE === "all" || PACKAGE === "sdk") {
  await $`bun run --cwd packages/sdk build`;
}

if (PACKAGE === "all" || PACKAGE === "cli") {
  await $`bun run --cwd packages/cli build`;
}

// 4. Publish to npm
console.log("\nPublishing to npm...");

if (PACKAGE === "all" || PACKAGE === "sdk") {
  console.log("\n--- gambi-sdk ---");
  await $`cd packages/sdk && npm publish --access public`;
}

if (PACKAGE === "all" || PACKAGE === "cli") {
  console.log("\n--- gambi (CLI) ---");
  await $`cd packages/cli && npm publish --access public`;
}

console.log(`\n=== Published v${VERSION} successfully ===\n`);
