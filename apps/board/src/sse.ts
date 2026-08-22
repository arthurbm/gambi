export type BoardSseEvent =
  | { type: "board.snapshot"; revision: number }
  | { type: "board.changed"; revision: number; change: string };

type Listener = (event: BoardSseEvent) => void | Promise<void>;

export class BoardEventBus {
  private readonly listeners = new Set<Listener>();

  async publish(event: BoardSseEvent) {
    await Promise.allSettled(
      [...this.listeners].map((listener) => listener(event))
    );
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
