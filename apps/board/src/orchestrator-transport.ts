import type {
  HarnessEvent,
  HarnessOpenOptions,
  HarnessSession,
  HarnessTransport,
} from "@gambi/agents";

import type { BoardRepository } from "./db/repository";
import type { BoardHarnessRuntime } from "./harness-runtime";
import type { BoardEventBus } from "./sse";

class HarnessEventBuffer implements AsyncIterable<HarnessEvent> {
  readonly #queue: HarnessEvent[] = [];
  #closed = false;
  #waiting?: (result: IteratorResult<HarnessEvent>) => void;

  emit(event: HarnessEvent) {
    if (this.#closed) {
      return;
    }
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve({ done: false, value: event });
      return;
    }
    this.#queue.push(event);
  }

  close() {
    this.#closed = true;
    this.#waiting?.({ done: true, value: undefined });
    this.#waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<HarnessEvent> {
    return {
      next: () => {
        const event = this.#queue.shift();
        if (event) {
          return Promise.resolve({ done: false as const, value: event });
        }
        if (this.#closed) {
          return Promise.resolve({ done: true as const, value: undefined });
        }
        return new Promise<IteratorResult<HarnessEvent>>((resolve) => {
          this.#waiting = resolve;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ done: true as const, value: undefined });
      },
    };
  }
}

export class BoardOrchestratorTransport implements HarnessTransport {
  readonly #events = new HarnessEventBuffer();
  readonly #harness: BoardHarnessRuntime;
  readonly #repository: BoardRepository;
  readonly #squadId: string;
  readonly #unsubscribeArtifacts: () => void;
  readonly #unsubscribeEvents: () => void;
  readonly events: AsyncIterable<HarnessEvent> = this.#events;
  #closed = false;

  constructor(options: {
    eventBus: BoardEventBus;
    harness: BoardHarnessRuntime;
    repository: BoardRepository;
    squadId: string;
  }) {
    this.#harness = options.harness;
    this.#repository = options.repository;
    this.#squadId = options.squadId;
    this.#unsubscribeArtifacts = options.harness.subscribeArtifacts(
      (envelope) => {
        if (envelope.squadId === this.#squadId) {
          this.#events.emit(envelope.event);
        }
      }
    );
    this.#unsubscribeEvents = options.eventBus.subscribe((event) => {
      if (
        event.type === "harness.stream" &&
        event.squadId === this.#squadId &&
        event.event.type !== "artifact"
      ) {
        this.#events.emit(event.event as unknown as HarnessEvent);
      }
    });
  }

  async open(options: HarnessOpenOptions): Promise<HarnessSession> {
    this.assertActive();
    if (options.squadId !== this.#squadId) {
      throw new Error(
        `Transport for squad ${this.#squadId} cannot open a session for ${options.squadId}.`
      );
    }
    const binding = await this.#repository.getSquadHarness(this.#squadId);
    if (!binding.assignment) {
      throw new Error("Designe um harness para esta rodada primeiro.");
    }
    const session = await this.#repository.ensureHarnessSession({
      squadId: this.#squadId,
      roundId: binding.roundId,
      participantId: binding.assignment.participantId,
    });
    return { sessionId: session.sessionId };
  }

  async prompt(sessionId: string, prompt: string): Promise<void> {
    this.assertActive();
    const session = await this.#repository.getHarnessSessionById(sessionId);
    if (!session || session.squadId !== this.#squadId) {
      throw new Error(
        `Harness session ${sessionId} does not belong to squad ${this.#squadId}.`
      );
    }
    await this.#harness.promptSession({
      participantId: session.participantId,
      prompt,
      roundId: session.roundId,
      sessionId: session.sessionId,
      squadId: session.squadId,
    });
  }

  close(_sessionId: string): Promise<void> {
    this.dispose();
    return Promise.resolve();
  }

  dispose() {
    if (!this.#closed) {
      this.#closed = true;
      this.#unsubscribeArtifacts();
      this.#unsubscribeEvents();
      this.#events.close();
    }
  }

  private assertActive() {
    if (this.#closed) {
      throw new Error(
        `Harness transport for squad ${this.#squadId} is closed.`
      );
    }
  }
}
