import { describe, expect, test } from "bun:test";
import { runPackageManagerUpdate } from "./self-update.ts";

describe("self update package-manager execution", () => {
  test("captures child output for structured formats", () => {
    const result = runPackageManagerUpdate(
      "npm",
      ["install", "-g", "gambi@latest"],
      {
        captureOutput: true,
        spawnImpl: (() => ({
          error: undefined,
          status: 0,
          stdout: "updated\n",
          stderr: "warning\n",
        })) as unknown as NonNullable<
          Parameters<typeof runPackageManagerUpdate>[2]
        >["spawnImpl"],
      }
    );

    expect(result).toEqual({
      code: 0,
      stdout: "updated\n",
      stderr: "warning\n",
    });
  });
});
