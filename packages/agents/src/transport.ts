export interface HarnessOpenOptions {
  participantId?: string;
  squadId: string;
}

export interface HarnessSession {
  sessionId: string;
}

export interface HarnessArtifactFile {
  content: string;
  encoding: "base64" | "utf8";
  path: string;
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
  | {
      type: "artifact";
      sessionId: string;
      version: number;
      files: HarnessArtifactFile[];
      reason: "watch" | "final";
    }
  | {
      type: "status";
      sessionId: string;
      status: "opened" | "closed";
      message?: string;
    }
  | {
      type: "message";
      sessionId: string;
      message: Record<string, unknown>;
    }
  | {
      type: "error";
      sessionId: string;
      message: string;
      recoverable?: boolean;
    };

export interface HarnessTransport {
  readonly events: AsyncIterable<HarnessEvent>;
  open(options: HarnessOpenOptions): Promise<HarnessSession>;
  prompt(sessionId: string, prompt: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}
