export interface HarnessOpenOptions {
  participantId?: string;
  squadId: string;
}

export interface HarnessSession {
  sessionId: string;
}

export type HarnessEvent =
  | { type: "text"; sessionId: string; text: string }
  | {
      type: "tool-call";
      sessionId: string;
      toolName: string;
      input: unknown;
    }
  | { type: "file"; sessionId: string; path: string }
  | { type: "error"; sessionId: string; message: string };

export interface HarnessTransport {
  readonly events: AsyncIterable<HarnessEvent>;
  open(options: HarnessOpenOptions): Promise<HarnessSession>;
  prompt(sessionId: string, prompt: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}
