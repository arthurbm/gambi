import { describe, expect, test } from "bun:test";
import { AsyncEventStream } from "./async-event-stream.ts";
import {
  HarnessTransportError,
  type TunnelHarnessAttachedFrame,
  type TunnelHarnessClientFrame,
  TunnelHarnessTransport,
} from "./tunnel-transport.ts";

describe("TunnelHarnessTransport", () => {
  test("reports an unacknowledged prompt as an explicit recoverable failure", async () => {
    const frames = new AsyncEventStream<TunnelHarnessAttachedFrame>();
    const send = (frame: TunnelHarnessClientFrame) => {
      if (frame.type === "tunnel.harness.control") {
        queueMicrotask(() =>
          frames.emit({
            type: "tunnel.harness.status",
            sessionId: frame.sessionId,
            status: frame.action === "open" ? "opened" : "closed",
          })
        );
      }
    };
    const transport = new TunnelHarnessTransport({
      client: {
        harness: {
          attach: async () => ({
            close: () => frames.close(),
            messages: frames,
            send,
          }),
        },
      },
      roomCode: "ABC123",
      participantId: "fake-alpha",
      operationTimeoutMs: 10,
      generateSessionId: () => "recoverable-session",
    });
    const session = await transport.open({ squadId: "alpha" });
    const nextEvent = transport.events[Symbol.asyncIterator]().next();

    const prompt = transport.prompt(session.sessionId, "Dropped prompt");

    await expect(prompt).rejects.toMatchObject({
      name: "HarnessTransportError",
      recoverable: true,
      sessionId: session.sessionId,
    });
    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "error",
        sessionId: session.sessionId,
        recoverable: true,
      },
    });
    expect(await prompt.catch((error: unknown) => error)).toBeInstanceOf(
      HarnessTransportError
    );
  });
});
