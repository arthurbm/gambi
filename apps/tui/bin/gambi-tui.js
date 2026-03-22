#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
	console.log("gambi-tui - Interactive terminal dashboard for Gambi\n");
	console.log("Usage: gambi-tui [options]\n");
	console.log("Options:");
	console.log(
		"  --hub <url>    Hub URL to connect to (default: http://localhost:3000)",
	);
	console.log("  --help, -h     Show this help message");
	console.log("  --version      Show version");
	process.exit(0);
}

if (args.includes("--version")) {
	const dir = dirname(fileURLToPath(import.meta.url));
	const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
	console.log(pkg.version);
	process.exit(0);
}

const hubIndex = args.indexOf("--hub");
const hubUrl =
	hubIndex !== -1 && args[hubIndex + 1]
		? args[hubIndex + 1]
		: "http://localhost:3000";

const { startTUI } = await import("../dist/index.js");
startTUI({ hubUrl });
