#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wrapperDir = path.resolve(__dirname, "..");
const wrapperBinDir = path.join(wrapperDir, "bin");

function detectPackageName() {
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap = {
    arm64: "arm64",
    x64: "x64",
  };

  const platform = platformMap[os.platform()];
  const arch = archMap[os.arch()];

  if (!(platform && arch)) {
    return undefined;
  }

  return `gambi-${platform}-${arch}`;
}

function findBinary(packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageDir = path.dirname(packageJsonPath);
  const binaryName = os.platform() === "win32" ? "gambi.exe" : "gambi";
  const binaryPath = path.join(packageDir, "bin", binaryName);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath}`);
  }

  return binaryPath;
}

function main() {
  const packageName = detectPackageName();
  if (!packageName) {
    console.warn(
      `[gambi] No packaged binary is available for ${os.platform()}/${os.arch()}.`
    );
    return;
  }

  try {
    const binaryPath = findBinary(packageName);
    const cachePath = path.join(
      wrapperBinDir,
      os.platform() === "win32" ? ".gambi.exe" : ".gambi"
    );

    fs.mkdirSync(wrapperBinDir, { recursive: true });
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }

    if (os.platform() === "win32") {
      fs.copyFileSync(binaryPath, cachePath);
    } else {
      try {
        fs.linkSync(binaryPath, cachePath);
      } catch {
        fs.copyFileSync(binaryPath, cachePath);
      }
      fs.chmodSync(cachePath, 0o755);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[gambi] Failed to cache the platform binary: ${message}`);
  }
}

main();
