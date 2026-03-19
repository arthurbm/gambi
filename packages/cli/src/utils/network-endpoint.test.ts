import { describe, expect, test } from "bun:test";
import {
  isLoopbackLikeHost,
  isRemoteHubUrl,
  rankNetworkCandidatesForHub,
  replaceEndpointHost,
} from "./network-endpoint.ts";

describe("network endpoint helpers", () => {
  test("detects loopback-like hosts", () => {
    expect(isLoopbackLikeHost("localhost")).toBe(true);
    expect(isLoopbackLikeHost("127.0.0.1")).toBe(true);
    expect(isLoopbackLikeHost("0.0.0.0")).toBe(true);
    expect(isLoopbackLikeHost("192.168.1.25")).toBe(false);
  });

  test("distinguishes local and remote hubs", () => {
    expect(isRemoteHubUrl("http://localhost:3000")).toBe(false);
    expect(isRemoteHubUrl("http://127.0.0.1:3000")).toBe(false);
    expect(isRemoteHubUrl("http://192.168.1.10:3000")).toBe(true);
  });

  test("prioritizes candidates on the same /24 subnet as the hub", () => {
    const ranked = rankNetworkCandidatesForHub("http://192.168.1.10:3000", [
      { address: "10.0.0.25", interfaceName: "en1" },
      { address: "192.168.1.25", interfaceName: "en0" },
      { address: "192.168.2.30", interfaceName: "en2" },
    ]);

    expect(ranked).toEqual([{ address: "192.168.1.25", interfaceName: "en0" }]);
  });

  test("replaces only the endpoint host", () => {
    expect(
      replaceEndpointHost("http://localhost:11434/v1/models", "192.168.1.25")
    ).toBe("http://192.168.1.25:11434/v1/models");
  });
});
