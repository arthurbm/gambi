import { describe, expect, test } from "bun:test";
import { parseServePort } from "./hub-serve.ts";

describe("hub serve port parsing", () => {
  test("accepts valid integer ports", () => {
    expect(parseServePort("3000")).toBe(3000);
    expect(parseServePort(65_535)).toBe(65_535);
  });

  test("rejects invalid port values", () => {
    expect(parseServePort("abc")).toBeNull();
    expect(parseServePort("0")).toBeNull();
    expect(parseServePort("65536")).toBeNull();
    expect(parseServePort("42.5")).toBeNull();
  });
});
