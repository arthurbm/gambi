import { describe, expect, test } from "bun:test";
import { MemoryHarnessTransport } from "./memory-transport.ts";

describe("MemoryHarnessTransport", () => {
  test("keeps a session and exposes deterministic harness events", async () => {
    const transport = new MemoryHarnessTransport();
    const session = await transport.open({
      squadId: "alpha",
      participantId: "participant-alpha",
    });
    const nextEvent = transport.events[Symbol.asyncIterator]().next();

    await transport.prompt(session.sessionId, "Build it");
    transport.emit({
      type: "text",
      sessionId: session.sessionId,
      text: "Built",
    });

    await expect(nextEvent).resolves.toEqual({
      done: false,
      value: {
        type: "text",
        sessionId: "memory-alpha",
        text: "Built",
      },
    });
    expect(transport.prompts).toEqual([
      { sessionId: "memory-alpha", prompt: "Build it" },
    ]);

    await transport.close(session.sessionId);
    expect(transport.closeCalls).toEqual(["memory-alpha"]);
  });
});
