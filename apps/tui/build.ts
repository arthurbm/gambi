#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { build } from "bun";

// 1. Clean dist/
await rm("./dist", { recursive: true, force: true });
console.log("✓ Cleaned dist/");

// 2. Build with Bun (bundles @gambi/core, externalizes npm deps)
const result = await build({
	entrypoints: ["./src/index.tsx"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	sourcemap: "external",
	minify: false,
	splitting: true,
	external: [
		"@hookform/resolvers",
		"@opentui/core",
		"@opentui/react",
		"@tanstack/react-query",
		"bonjour-service",
		"nanoid",
		"react",
		"react-hook-form",
		"zod",
		"zustand",
	],
});

if (!result.success) {
	console.error("✗ Build failed");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log(`✓ Built ${result.outputs.length} files`);

// 3. Write minimal type declaration (full tsc emit skipped because
//    @gambi/core source uses .ts extensions incompatible with declaration emit)
const dts = `export interface StartTUIOptions {
	hubUrl: string;
}

export declare function startTUI(options: StartTUIOptions): Promise<void>;
`;
await Bun.write("./dist/index.d.ts", dts);
console.log("✓ Generated type declarations");

console.log("✓ Build completed successfully");
