import { readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");
const cleanBunGlobalCache = process.argv.includes("--bun-cache");
const targets = new Set(["node_modules", ".turbo", ".cache", ".astro", ".vite"]);
const skipped = new Set([".git"]);

async function collectTargets(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (skipped.has(entry.name) || !entry.isDirectory()) {
      continue;
    }

    const fullPath = join(directory, entry.name);

    if (targets.has(entry.name)) {
      paths.push(fullPath);
      continue;
    }

    paths.push(...(await collectTargets(fullPath)));
  }

  return paths;
}

const paths = await collectTargets(root);

if (paths.length === 0 && !cleanBunGlobalCache) {
  console.log("No dependency or cache directories found.");
  process.exit(0);
}

for (const path of paths) {
  const label = relative(root, path);
  console.log(`${dryRun ? "Would remove" : "Removing"} ${label}`);

  if (!dryRun) {
    await rm(path, { recursive: true, force: true });
  }
}

console.log(
  `${dryRun ? "Found" : "Removed"} ${paths.length} director${paths.length === 1 ? "y" : "ies"}.`
);

if (cleanBunGlobalCache) {
  const cachePathProcess = Bun.spawn(["bun", "pm", "cache"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const cachePath = (await new Response(cachePathProcess.stdout).text()).trim();
  await cachePathProcess.exited;

  if (dryRun) {
    console.log(`Would clear Bun global cache at ${cachePath}`);
  } else {
    console.log(`Clearing Bun global cache at ${cachePath}`);

    const clearProcess = Bun.spawn(["bun", "pm", "cache", "rm"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await clearProcess.exited;

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}
