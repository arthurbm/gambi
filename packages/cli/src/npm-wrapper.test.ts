import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Runs the published npm wrapper (bin/gambi) under Node against a fake
// platform binary, the way `npm i -g gambi` runs it.
const WRAPPER_SOURCE = resolve(import.meta.dir, "../bin/gambi");
const READY_LINE = /ready (\d+)/;

const FAKE_BINARY = `#!/usr/bin/env node
const exitCode = Number(process.env.FAKE_EXIT_CODE || 0);
if (process.env.FAKE_MODE === "exit") {
  process.exit(exitCode);
}
if (process.env.FAKE_MODE === "trap") {
  process.on("SIGTERM", () => process.exit(exitCode));
}
process.stdout.write("ready " + process.pid + "\\n");
setInterval(() => {}, 1000);
`;

let workDir = "";
let wrapperPath = "";
let fakeBinaryPath = "";
// Binaries that a broken wrapper would orphan; killed after the suite so a
// failing run does not leave them holding the test's output open.
const binaryPids: number[] = [];

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "gambi-wrapper-"));
  // Mirror the published package: no "type" field, so the wrapper is CommonJS.
  await mkdir(join(workDir, "gambi", "bin"), { recursive: true });
  await writeFile(join(workDir, "gambi", "package.json"), '{"name":"gambi"}\n');
  wrapperPath = join(workDir, "gambi", "bin", "gambi");
  await copyFile(WRAPPER_SOURCE, wrapperPath);
  fakeBinaryPath = join(workDir, "fake-gambi");
  await writeFile(fakeBinaryPath, FAKE_BINARY);
  await chmod(fakeBinaryPath, 0o755);
});

afterAll(async () => {
  for (const pid of binaryPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, as it should be.
    }
  }
  await rm(workDir, { recursive: true, force: true });
});

function startWrapper(env: Record<string, string>) {
  return Bun.spawn(["node", wrapperPath, "hub", "serve"], {
    env: { ...process.env, GAMBI_BIN_PATH: fakeBinaryPath, ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
}

async function readBinaryPid(stdout: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let output = "";
  for await (const chunk of stdout) {
    output += decoder.decode(chunk);
    const match = output.match(READY_LINE);
    if (match?.[1]) {
      const pid = Number(match[1]);
      binaryPids.push(pid);
      return pid;
    }
  }
  throw new Error(`Fake binary never reported ready. Output: ${output}`);
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("npm wrapper bin/gambi", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    test(`relays ${signal} to the binary and dies from it`, async () => {
      const wrapper = startWrapper({});
      const binaryPid = await readBinaryPid(wrapper.stdout);

      wrapper.kill(signal);
      await wrapper.exited;

      expect(wrapper.signalCode).toBe(signal);
      expect(isAlive(binaryPid)).toBe(false);
    });
  }

  test("exits with the binary's code when it handles the signal", async () => {
    const wrapper = startWrapper({ FAKE_MODE: "trap", FAKE_EXIT_CODE: "7" });
    const binaryPid = await readBinaryPid(wrapper.stdout);

    wrapper.kill("SIGTERM");

    expect(await wrapper.exited).toBe(7);
    expect(isAlive(binaryPid)).toBe(false);
  });

  test("preserves the binary's exit code", async () => {
    for (const code of [0, 3]) {
      const wrapper = startWrapper({
        FAKE_MODE: "exit",
        FAKE_EXIT_CODE: String(code),
      });
      expect(await wrapper.exited).toBe(code);
    }
  });
});
