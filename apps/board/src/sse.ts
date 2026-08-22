export interface HarnessEventForBoard {
  type: string;
  sessionId: string;
  version?: number;
  reason?: "watch" | "final";
  files?: Array<{
    path: string;
    encoding: "base64" | "utf8";
    content?: string;
  }>;
}

export interface HarnessStreamEnvelope {
  type: "harness.stream";
  squadId: string;
  roundId: string;
  participantId: string;
  sessionId: string;
  event: HarnessEventForBoard;
}

export type BoardSseEvent =
  | { type: "board.snapshot"; revision: number }
  | { type: "board.changed"; revision: number; change: string }
  | {
      type: "harness.stream";
      squadId: string;
      roundId: string;
      participantId: string;
      sessionId: string;
      event:
        | HarnessEventForBoard
        | {
            type: "artifact";
            sessionId: string;
            version: number;
            reason: "watch" | "final";
            files: Array<{ path: string; encoding: "base64" | "utf8" }>;
          };
    };

type Listener = (event: BoardSseEvent) => void | Promise<void>;

export class BoardEventBus {
  private readonly listeners = new Set<Listener>();

  async publish(event: BoardSseEvent) {
    await Promise.allSettled(
      [...this.listeners].map((listener) => listener(event))
    );
  }

  publishPresence() {
    return this.publish({
      type: "board.changed",
      change: "harness.presence",
      revision: 0,
    });
  }

  publishHarness(envelope: HarnessStreamEnvelope) {
    if (envelope.event.type === "message") {
      return Promise.resolve();
    }
    const event =
      envelope.event.type === "artifact" &&
      envelope.event.files &&
      envelope.event.version !== undefined &&
      envelope.event.reason
        ? {
            type: "artifact" as const,
            sessionId: envelope.event.sessionId,
            version: envelope.event.version,
            reason: envelope.event.reason,
            files: envelope.event.files.map(({ path, encoding }) => ({
              path,
              encoding,
            })),
          }
        : envelope.event;
    return this.publish({ ...envelope, event });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
