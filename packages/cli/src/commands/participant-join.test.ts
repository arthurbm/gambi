import { describe, expect, test } from "bun:test";
import {
  parseHarnessId,
  parseHeaderAssignment,
  validateHarnessFlagCombination,
} from "./participant-join.ts";

describe("participant join helpers", () => {
  test("rejects header assignments with empty trimmed parts", () => {
    expect(() => parseHeaderAssignment(" Authorization=   ")).toThrow(
      "Invalid header assignment ' Authorization=   '. Use Header=Value."
    );
    expect(() => parseHeaderAssignment(" =value")).toThrow(
      "Invalid header assignment ' =value'. Use Header=Value."
    );
  });
});

describe("harness join validation", () => {
  test("accepts the supported adapters", () => {
    expect(parseHarnessId("opencode")).toBe("opencode");
    expect(parseHarnessId("fake")).toBe("fake");
    expect(() => parseHarnessId("codex")).toThrow(
      "Unsupported harness 'codex'"
    );
  });

  test("rejects endpoint and auth header flags in harness mode", () => {
    expect(() =>
      validateHarnessFlagCombination({
        endpoint: "http://localhost:11434",
        headers: ["Authorization=secret"],
        headerEnv: ["X-Key=API_KEY"],
      })
    ).toThrow(
      "--endpoint, --header, --header-env cannot be used with --harness"
    );
  });
});
