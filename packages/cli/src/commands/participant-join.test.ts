import { describe, expect, test } from "bun:test";
import { resolvePublishedEndpoint } from "./participant-join.ts";

describe("participant join endpoint validation", () => {
  test("rejects an invalid published network endpoint", () => {
    expect(() =>
      resolvePublishedEndpoint(
        "http://192.168.1.10:3000",
        "http://localhost:11434",
        "not-a-url"
      )
    ).toThrow("Invalid --network-endpoint URL: not-a-url.");
  });

  test("rejects an invalid local endpoint before LAN rewriting", () => {
    expect(() =>
      resolvePublishedEndpoint("http://192.168.1.10:3000", "not-a-url")
    ).toThrow("Invalid endpoint URL: not-a-url.");
  });
});
