import { describe, expect, test } from "bun:test";
import { parseHeaderAssignment } from "./participant-join.ts";

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
