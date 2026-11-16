#!/usr/bin/env bun
/** Builds `dist/`: the JavaScript and the declarations of every entry. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { buildDeclarations, buildEntry, entries } from "./entries.ts";

const dist = join(import.meta.dir, "dist");
await rm(dist, { recursive: true, force: true });

for (const entry of entries) {
  await buildEntry(entry, dist);
  console.log(`✓ Built ${entry.name}.js (runs on: ${entry.runsOn})`);
}

await buildDeclarations(dist);
console.log("✓ Generated bundled type declarations");
