import { describe, expect, test } from "bun:test";
import { AsyncEventStream } from "./async-event-stream.ts";
import {
  HarnessTransportError,
  type TunnelHarnessAttachedFrame,
  type TunnelHarnessClientFrame,
  TunnelHarnessTransport,
} from "./tunnel-transport.ts";

describe("TunnelHarnessTransport", () => {
  test("allows a prompt turn to exceed the control timeout", async () => {
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
        return;
      }
      setTimeout(
        () =>
          frames.emit({
            type: "tunnel.harness.message",
            sessionId: frame.sessionId,
            message: {
              jsonrpc: "2.0",
              id: frame.message.id,
              result: { stopReason: "end_turn" },
            },
          }),
        30
      );
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
      promptTimeoutMs: 80,
      generateSessionId: () => "delayed-session",
    });
    const session = await transport.open({ squadId: "alpha" });

    await expect(
      transport.prompt(session.sessionId, "A deliberate turn")
    ).resolves.toBeUndefined();
  });

  test("reports a prompt timeout as recoverable and retries on a new session", async () => {
    let attachCount = 0;
    let promptCount = 0;
    const send = (
      frame: TunnelHarnessClientFrame,
      frames: AsyncEventStream<TunnelHarnessAttachedFrame>
    ) => {
      if (frame.type === "tunnel.harness.control") {
        queueMicrotask(() =>
          frames.emit({
            type: "tunnel.harness.status",
            sessionId: frame.sessionId,
            status: frame.action === "open" ? "opened" : "closed",
          })
        );
        return;
      }
      promptCount += 1;
      const respond = () =>
        frames.emit({
          type: "tunnel.harness.message",
          sessionId: frame.sessionId,
          message: {
            jsonrpc: "2.0",
            id: frame.message.id,
            result: { stopReason: "end_turn" },
          },
        });
      if (promptCount === 1) {
        setTimeout(respond, 30);
      } else {
        queueMicrotask(respond);
      }
    };
    const transport = new TunnelHarnessTransport({
      client: {
        harness: {
          attach: () => {
            attachCount += 1;
            const frames = new AsyncEventStream<TunnelHarnessAttachedFrame>();
            return Promise.resolve({
              close: () => frames.close(),
              messages: frames,
              send: (frame) => send(frame, frames),
            });
          },
        },
      },
      roomCode: "ABC123",
      participantId: "fake-alpha",
      operationTimeoutMs: 80,
      promptTimeoutMs: 10,
      generateSessionId: (() => {
        let nextSession = 0;
        return () => {
          nextSession += 1;
          return `recoverable-session-${nextSession}`;
        };
      })(),
    });
    const firstSession = await transport.open({ squadId: "alpha" });
    const nextEvent = transport.events[Symbol.asyncIterator]().next();

    const prompt = transport.prompt(firstSession.sessionId, "Dropped prompt");

    await expect(prompt).rejects.toMatchObject({
      name: "HarnessTransportError",
      recoverable: true,
      sessionId: firstSession.sessionId,
      message: expect.stringContaining("Delivery may be incomplete"),
    });
    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "error",
        sessionId: firstSession.sessionId,
        recoverable: true,
      },
    });
    expect(await prompt.catch((error: unknown) => error)).toBeInstanceOf(
      HarnessTransportError
    );
    const retrySession = await transport.open({ squadId: "alpha" });
    expect(retrySession.sessionId).not.toBe(firstSession.sessionId);
    await expect(
      transport.prompt(retrySession.sessionId, "Explicit retry")
    ).resolves.toBeUndefined();
    expect(attachCount).toBe(2);
  });
});
