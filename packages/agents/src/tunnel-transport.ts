import { AsyncEventStream } from "./async-event-stream.ts";
import type {
  HarnessEvent,
  HarnessOpenOptions,
  HarnessSession,
  HarnessTransport,
} from "./transport.ts";

const DEFAULT_OPERATION_TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

export type TunnelHarnessClientFrame =
  | {
      type: "tunnel.harness.control";
      sessionId: string;
      action: "open" | "close";
      cwd?: string;
    }
  | {
      type: "tunnel.harness.message";
      sessionId: string;
      message: JsonRecord;
    };

export type TunnelHarnessAttachedFrame =
  | {
      type: "tunnel.harness.message";
      sessionId: string;
      message: JsonRecord;
    }
  | {
      type: "tunnel.harness.artifact";
      sessionId: string;
      version: number;
      files: Array<{
        content: string;
        encoding: "base64" | "utf8";
        path: string;
      }>;
      reason: "watch" | "final";
    }
  | {
      type: "tunnel.harness.status";
      sessionId: string;
      status: "opened" | "closed" | "error";
      message?: string;
    };

export interface HarnessAttachChannel {
  close: () => void;
  messages: AsyncIterable<TunnelHarnessAttachedFrame>;
  send: (message: TunnelHarnessClientFrame) => void;
}

export interface HarnessAttachClient {
  harness: {
    attach(options: {
      participantId: string;
      roomCode: string;
      signal?: AbortSignal;
    }): Promise<HarnessAttachChannel>;
  };
}

export interface TunnelHarnessTransportOptions {
  client: HarnessAttachClient;
  generateSessionId?: () => string;
  operationTimeoutMs?: number;
  participantId?: string;
  roomCode: string;
}

interface PendingOperation {
  reject: (error: Error) => void;
  resolve: () => void;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

export class HarnessTransportError extends Error {
  readonly recoverable: boolean;
  readonly sessionId: string;

  constructor(params: {
    message: string;
    recoverable: boolean;
    sessionId: string;
  }) {
    super(params.message);
    this.name = "HarnessTransportError";
    this.recoverable = params.recoverable;
    this.sessionId = params.sessionId;
  }
}

export class TunnelHarnessTransport implements HarnessTransport {
  readonly #client: HarnessAttachClient;
  readonly #eventStream = new AsyncEventStream<HarnessEvent>();
  readonly #generateSessionId: () => string;
  readonly #openSessions = new Set<string>();
  readonly #operationTimeoutMs: number;
  readonly #participantId?: string;
  readonly #pendingControl = new Map<string, PendingOperation>();
  readonly #pendingRpc = new Map<string, PendingOperation>();
  readonly #rpcPrefix = crypto.randomUUID();
  readonly #roomCode: string;
  readonly events: AsyncIterable<HarnessEvent> = this.#eventStream;
  #channel?: HarnessAttachChannel;
  #channelGeneration = 0;
  #nextRpcId = 0;

  constructor(options: TunnelHarnessTransportOptions) {
    if (
      !Number.isFinite(
        options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
      )
    ) {
      throw new Error("operationTimeoutMs must be finite.");
    }
    if ((options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS) <= 0) {
      throw new Error("operationTimeoutMs must be positive.");
    }
    this.#client = options.client;
    this.#roomCode = options.roomCode;
    this.#participantId = options.participantId;
    this.#operationTimeoutMs =
      options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.#generateSessionId =
      options.generateSessionId ?? (() => crypto.randomUUID());
  }

  async open(options: HarnessOpenOptions): Promise<HarnessSession> {
    const participantId = options.participantId ?? this.#participantId;
    if (!participantId) {
      throw new Error(
        `A harness participant id is required for squad ${options.squadId}.`
      );
    }
    const channel = await this.ensureChannel(participantId);
    const sessionId = this.#generateSessionId();
    const opened = this.waitForControl(sessionId, "open");
    try {
      channel.send({
        type: "tunnel.harness.control",
        sessionId,
        action: "open",
      });
    } catch (error) {
      this.failSession(this.asRecoverableError(error, sessionId));
    }
    await opened;
    this.#openSessions.add(sessionId);
    return { sessionId };
  }

  async prompt(sessionId: string, prompt: string): Promise<void> {
    this.assertOpen(sessionId);
    const channel = this.#channel;
    if (!channel) {
      throw this.disconnectedError(sessionId);
    }
    this.#nextRpcId += 1;
    const id = `gambi-${this.#rpcPrefix}-${this.#nextRpcId}`;
    const result = this.waitForRpc(id, sessionId);
    try {
      channel.send({
        type: "tunnel.harness.message",
        sessionId,
        message: {
          jsonrpc: "2.0",
          id,
          method: "session/prompt",
          params: {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
          },
        },
      });
    } catch (error) {
      this.failSession(this.asRecoverableError(error, sessionId));
    }
    await result;
  }

  async close(sessionId: string): Promise<void> {
    this.assertOpen(sessionId);
    const channel = this.#channel;
    if (!channel) {
      this.#openSessions.delete(sessionId);
      throw this.disconnectedError(sessionId);
    }
    const closed = this.waitForControl(sessionId, "close");
    try {
      channel.send({
        type: "tunnel.harness.control",
        sessionId,
        action: "close",
      });
    } catch (error) {
      this.failSession(this.asRecoverableError(error, sessionId));
    }
    await closed;
    this.#openSessions.delete(sessionId);
    if (this.#openSessions.size === 0) {
      this.detachChannel();
    }
  }

  private async ensureChannel(
    participantId: string
  ): Promise<HarnessAttachChannel> {
    if (this.#channel) {
      return this.#channel;
    }
    const channel = await this.#client.harness.attach({
      roomCode: this.#roomCode,
      participantId,
    });
    this.#channel = channel;
    this.#channelGeneration += 1;
    const generation = this.#channelGeneration;
    this.consumeMessages(channel, generation).catch(() => undefined);
    return channel;
  }

  private async consumeMessages(
    channel: HarnessAttachChannel,
    generation: number
  ): Promise<void> {
    try {
      for await (const frame of channel.messages) {
        this.handleFrame(frame);
      }
      this.handleDisconnect(generation);
    } catch {
      this.handleDisconnect(generation);
    }
  }

  private handleFrame(frame: TunnelHarnessAttachedFrame): void {
    if (frame.type === "tunnel.harness.artifact") {
      this.#eventStream.emit({
        type: "artifact",
        sessionId: frame.sessionId,
        version: frame.version,
        files: frame.files,
        reason: frame.reason,
      });
      return;
    }

    if (frame.type === "tunnel.harness.status") {
      if (frame.status === "error") {
        const error = new HarnessTransportError({
          message: frame.message ?? "The harness reported an error.",
          recoverable: true,
          sessionId: frame.sessionId,
        });
        this.failSession(error);
        return;
      }
      this.resolveControl(frame.sessionId);
      this.#eventStream.emit({
        type: "status",
        sessionId: frame.sessionId,
        status: frame.status,
        message: frame.message,
      });
      return;
    }

    this.handleAcpMessage(frame.sessionId, frame.message);
  }

  private handleAcpMessage(sessionId: string, message: JsonRecord): void {
    const id = rpcKey(message.id);
    if (id && ("result" in message || "error" in message)) {
      if ("error" in message) {
        const error = new HarnessTransportError({
          message: describeRpcError(message.error),
          recoverable: false,
          sessionId,
        });
        this.rejectRpc(id, error);
        this.#eventStream.emit({
          type: "error",
          sessionId,
          message: error.message,
          recoverable: false,
        });
      } else {
        this.resolveRpc(id);
      }
      return;
    }

    const event = eventFromAcpUpdate(sessionId, message);
    this.#eventStream.emit(event);
  }

  private handleDisconnect(generation: number): void {
    if (generation !== this.#channelGeneration || !this.#channel) {
      return;
    }
    this.#channel = undefined;
    const sessionIds = new Set([
      ...this.#openSessions,
      ...this.#pendingControl.keys(),
      ...[...this.#pendingRpc.values()].map((pending) => pending.sessionId),
    ]);
    for (const sessionId of sessionIds) {
      const error = this.disconnectedError(sessionId);
      this.rejectControl(sessionId, error);
      for (const [id, pending] of this.#pendingRpc) {
        if (pending.sessionId === sessionId) {
          clearTimeout(pending.timeout);
          pending.reject(error);
          this.#pendingRpc.delete(id);
        }
      }
      this.#eventStream.emit({
        type: "error",
        sessionId,
        message: error.message,
        recoverable: true,
      });
    }
    this.#openSessions.clear();
  }

  private waitForControl(
    sessionId: string,
    operation: "open" | "close"
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingControl.delete(sessionId);
        const error = new HarnessTransportError({
          message: `Timed out waiting for harness session ${operation}. Retry after the participant tunnel reconnects.`,
          recoverable: true,
          sessionId,
        });
        this.failSession(error);
        reject(error);
      }, this.#operationTimeoutMs);
      this.#pendingControl.set(sessionId, {
        resolve,
        reject,
        sessionId,
        timeout,
      });
    });
  }

  private waitForRpc(id: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRpc.delete(id);
        const error = new HarnessTransportError({
          message:
            "The harness did not acknowledge the prompt. The tunnel may be disconnected; reopen the harness session and retry the dispatch.",
          recoverable: true,
          sessionId,
        });
        this.failSession(error);
        reject(error);
      }, this.#operationTimeoutMs);
      this.#pendingRpc.set(id, { resolve, reject, sessionId, timeout });
    });
  }

  private resolveControl(sessionId: string): void {
    const pending = this.#pendingControl.get(sessionId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pendingControl.delete(sessionId);
    pending.resolve();
  }

  private rejectControl(sessionId: string, error: Error): void {
    const pending = this.#pendingControl.get(sessionId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pendingControl.delete(sessionId);
    pending.reject(error);
  }

  private resolveRpc(id: string): void {
    const pending = this.#pendingRpc.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pendingRpc.delete(id);
    pending.resolve();
  }

  private rejectRpc(id: string, error: Error): void {
    const pending = this.#pendingRpc.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pendingRpc.delete(id);
    pending.reject(error);
  }

  private failSession(error: HarnessTransportError): void {
    this.rejectControl(error.sessionId, error);
    for (const [id, pending] of this.#pendingRpc) {
      if (pending.sessionId === error.sessionId) {
        this.rejectRpc(id, error);
      }
    }
    this.#openSessions.delete(error.sessionId);
    this.#eventStream.emit({
      type: "error",
      sessionId: error.sessionId,
      message: error.message,
      recoverable: error.recoverable,
    });
    if (this.#openSessions.size === 0) {
      this.detachChannel();
    }
  }

  private detachChannel(): void {
    const channel = this.#channel;
    this.#channel = undefined;
    this.#channelGeneration += 1;
    channel?.close();
  }

  private disconnectedError(sessionId: string): HarnessTransportError {
    return new HarnessTransportError({
      message:
        "The harness channel disconnected. Reopen the harness session and retry the dispatch.",
      recoverable: true,
      sessionId,
    });
  }

  private asRecoverableError(
    error: unknown,
    sessionId: string
  ): HarnessTransportError {
    return new HarnessTransportError({
      message:
        error instanceof Error
          ? `${error.message} Reopen the harness session and retry the dispatch.`
          : "The harness channel failed. Reopen the harness session and retry the dispatch.",
      recoverable: true,
      sessionId,
    });
  }

  private assertOpen(sessionId: string): void {
    if (!this.#openSessions.has(sessionId)) {
      throw new Error(`Harness session ${sessionId} is not open.`);
    }
  }
}

function rpcKey(id: unknown): string | undefined {
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

function describeRpcError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return "The harness rejected the prompt.";
}

function eventFromAcpUpdate(
  sessionId: string,
  message: JsonRecord
): HarnessEvent {
  const params = asRecord(message.params);
  const update = asRecord(params?.update);
  const updateType = update?.sessionUpdate;
  const content = asRecord(update?.content);
  if (
    updateType === "agent_message_chunk" &&
    content?.type === "text" &&
    typeof content.text === "string"
  ) {
    return { type: "text", sessionId, text: content.text };
  }
  if (updateType === "tool_call") {
    return {
      type: "tool-call",
      sessionId,
      toolName:
        typeof update?.title === "string" ? update.title : "harness-tool",
      input: update?.rawInput,
    };
  }
  return { type: "message", sessionId, message };
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}
