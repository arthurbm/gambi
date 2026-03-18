#!/usr/bin/env bun
import { mkdir, rm } from "node:fs/promises";
import { $ } from "bun";

const TARGETS = [
  { target: "bun-linux-x64", output: "gambi-linux-x64" },
  { target: "bun-linux-arm64", output: "gambi-linux-arm64" },
  { target: "bun-darwin-arm64", output: "gambi-darwin-arm64" },
  { target: "bun-windows-x64", output: "gambi-windows-x64.exe" },
] as const;

async function build() {
  // 1. Clean dist/
  await rm("./dist", { recursive: true, force: true });
  await mkdir("./dist", { recursive: true });
  console.log("✓ Cleaned dist/");

  // 2. Build for each target
  const results = await Promise.allSettled(
    TARGETS.map(async ({ target, output }) => {
      console.log(`  Building ${output}...`);
      await $`bun build ./src/cli.ts --compile --target=${target} --outfile=./dist/${output}`;
      return output;
    })
  );

  // 3. Report results
  let success = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      console.log(`✓ Built ${result.value}`);
      success++;
    } else {
      console.error(`✗ Failed: ${result.reason}`);
      failed++;
    }
  }

  console.log(`\n✓ Build completed: ${success} succeeded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run build
build();
