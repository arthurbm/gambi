import { AsyncEventStream } from "./async-event-stream.ts";
import type {
  HarnessEvent,
  HarnessOpenOptions,
  HarnessSession,
  HarnessTransport,
} from "./transport.ts";

export interface MemoryPrompt {
  prompt: string;
  sessionId: string;
}

export class MemoryHarnessTransport implements HarnessTransport {
  readonly #eventStream = new AsyncEventStream<HarnessEvent>();
  readonly #sessions = new Set<string>();
  readonly events: AsyncIterable<HarnessEvent> = this.#eventStream;
  readonly prompts: MemoryPrompt[] = [];
  readonly openCalls: HarnessOpenOptions[] = [];
  readonly closeCalls: string[] = [];

  open(options: HarnessOpenOptions): Promise<HarnessSession> {
    this.openCalls.push(options);
    const sessionId = `memory-${options.squadId}`;
    this.#sessions.add(sessionId);
    return Promise.resolve({ sessionId });
  }

  prompt(sessionId: string, prompt: string): Promise<void> {
    this.assertOpen(sessionId);
    this.prompts.push({ sessionId, prompt });
    return Promise.resolve();
  }

  close(sessionId: string): Promise<void> {
    this.assertOpen(sessionId);
    this.closeCalls.push(sessionId);
    this.#sessions.delete(sessionId);
    return Promise.resolve();
  }

  emit(event: HarnessEvent): void {
    this.assertOpen(event.sessionId);
    this.#eventStream.emit(event);
  }

  private assertOpen(sessionId: string): void {
    if (!this.#sessions.has(sessionId)) {
      throw new Error(`Harness session ${sessionId} is not open.`);
    }
  }
}
