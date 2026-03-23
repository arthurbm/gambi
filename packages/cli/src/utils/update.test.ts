import { describe, expect, test } from "bun:test";
import {
  detectPackageManager,
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

  test("detects npm from the installed binary path", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/usr/local/lib/node_modules/gambi/bin/.gambi",
      })
    ).toEqual({
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
      manager: "npm",
      args: ["install", "-g", "gambi@latest"],
      command: "npm install -g gambi@latest",
    });
  });

  test("returns null when the install source is unknown", () => {
    expect(
      resolveUpdatePlan({
        execPath: "/usr/local/bin/gambi",
        argv: ["bun", "src/cli.ts", "update"],
        userAgent: null,
      })
    ).toBeNull();
  });
});
