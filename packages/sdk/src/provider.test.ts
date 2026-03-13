import { describe, expect, test } from "bun:test";
import { createGambiarra } from "./provider.ts";

describe("SDK provider", () => {
  test("defaults to OpenResponses", () => {
    const provider = createGambiarra({ roomCode: "ABC123" });

    expect(provider.defaultProtocol).toBe("openResponses");
    expect(provider.openResponses.any()).toBeDefined();
    expect(provider.chatCompletions.any()).toBeDefined();
    expect(provider.any()).toBeDefined();
  });

  test("supports explicit legacy chat/completions mode", () => {
    const provider = createGambiarra({
      roomCode: "ABC123",
      defaultProtocol: "chatCompletions",
    });

    expect(provider.defaultProtocol).toBe("chatCompletions");
    expect(provider.participant("participant-1")).toBeDefined();
    expect(provider.model("llama3")).toBeDefined();
  });
});
