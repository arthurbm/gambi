import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectPackageManager,
  executeStandaloneUpdate,
  normalizePackageManager,
  resolveUpdatePlan,
} from "./update.ts";

describe("update helpers", () => {
  test("normalizes supported package managers", () => {
    expect(normalizePackageManager("bun")).toBe("bun");
    expect(normalizePackageManager("NPM")).toBe("npm");
    expect(normalizePackageManager("pnpm")).toBeNull();
  });

  test("prefers an explicit manager override", () => {
    expect(
      resolveUpdatePlan({
        manager: "bun",
        execPath: "/usr/local/lib/node_modules/gambi/bin/.gambi",
      })
    ).toEqual({
      kind: "package-manager",
      manager: "bun",
      args: ["add", "-g", "gambi@latest"],
      command: "bun add -g gambi@latest",
    });
  });

  test("detects bun from the npm user agent", () => {
    expect(
      detectPackageManager({
        userAgent: "bun/1.3.10 npm/? node/v22.0.0 linux x64",
      })
    ).toBe("bun");
  });

  test("detects bun from the installed binary path", () => {
    expect(
      detectPackageManager({
        execPath:
          "/home/alice/.bun/install/global/node_modules/gambi/bin/.gambi",
      })
    ).toBe("bun");
  });

  test("prefers path-based detection over npm user agent noise", () => {
    expect(
      detectPackageManager({
        execPath:
          "/home/alice/.bun/install/global/node_modules/gambi/bin/.gambi",
        userAgent: "npm/10.9.0 node/v22.0.0 linux x64",
      })
    ).toBe("bun");
  });

  test("prefers npm paths over a bun user agent", () => {
    expect(
      detectPackageManager({
        execPath: "/usr/local/lib/node_modules/gambi/bin/.gambi",
        userAgent: "bun/1.3.10 npm/? node/v22.0.0 linux x64",
      })
    ).toBe("npm");
  });

  test("detects npm from the installed binary path", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/usr/local/lib/node_modules/gambi/bin/.gambi",
      })
    ).toEqual({
      kind: "package-manager",
      manager: "npm",
      args: ["install", "-g", "gambi@latest"],
      command: "npm install -g gambi@latest",
    });
  });

  test("detects npm when execPath resolves to the platform package outside node_modules (symlinked global layout)", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/workspace/packages/cli/dist/npm/gambi-linux-x64/bin/gambi",
        argv: ["bun", "/$bunfs/root/gambi-linux-x64", "update", "--dry-run"],
        userAgent: null,
      })
    ).toEqual({
      kind: "package-manager",
      manager: "npm",
      args: ["install", "-g", "gambi@latest"],
      command: "npm install -g gambi@latest",
    });
  });

  test("detects standalone installs before falling back to user agent", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/home/alice/.local/bin/gambi",
        platform: "linux",
        arch: "x64",
        userAgent: "npm/10.9.0 node/v22.0.0 linux x64",
        releaseBaseUrl: "https://example.com/releases/latest/download",
      })
    ).toEqual({
      kind: "standalone",
      platform: "linux",
      binaryPath: "/home/alice/.local/bin/gambi",
      assetName: "gambi-linux-x64",
      downloadUrl:
        "https://example.com/releases/latest/download/gambi-linux-x64",
      command:
        "download gambi-linux-x64 and replace /home/alice/.local/bin/gambi",
    });
  });

  test("prefers a standalone execPath over Bun's internal argv path", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/home/alice/.local/bin/gambi",
        argv: ["bun", "/$bunfs/root/gambi-linux-x64", "update"],
        platform: "linux",
        arch: "x64",
        releaseBaseUrl: "https://example.com/releases/latest/download",
      })
    ).toEqual({
      kind: "standalone",
      platform: "linux",
      binaryPath: "/home/alice/.local/bin/gambi",
      assetName: "gambi-linux-x64",
      downloadUrl:
        "https://example.com/releases/latest/download/gambi-linux-x64",
      command:
        "download gambi-linux-x64 and replace /home/alice/.local/bin/gambi",
    });
  });

  test("returns null when the install source is unknown", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/usr/local/bin/custom-gambi",
        argv: ["bun", "src/cli.ts", "update"],
        userAgent: null,
        platform: "linux",
        arch: "x64",
      })
    ).toBeNull();
  });
});

describe("standalone update execution", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname !== "/gambi-linux-x64") {
          return new Response("missing", { status: 404 });
        }

        return new Response("new-binary", {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    });
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("downloads and replaces a standalone binary in place", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gambi-update-test-"));
    const binaryPath = join(tempDir, "gambi");
    await writeFile(binaryPath, "old-binary");

    try {
      const plan = resolveUpdatePlan({
        execPath: binaryPath,
        platform: "linux",
        arch: "x64",
        releaseBaseUrl: `http://127.0.0.1:${server?.port}`,
      });

      expect(plan).not.toBeNull();
      expect(plan?.kind).toBe("standalone");
      if (!plan || plan.kind !== "standalone") {
        throw new Error("Expected standalone update plan");
      }

      const result = await executeStandaloneUpdate(plan);

      expect(result).toEqual({ kind: "updated" });
      expect(await readFile(binaryPath, "utf8")).toBe("new-binary");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
