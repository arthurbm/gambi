interface Subscription<T> {
  done: boolean;
  queue: T[];
  waiting?: (result: IteratorResult<T>) => void;
}

export class AsyncEventStream<T> implements AsyncIterable<T> {
  readonly #subscriptions = new Set<Subscription<T>>();
  #closed = false;

  emit(value: T): void {
    if (this.#closed) {
      return;
    }

    for (const subscription of this.#subscriptions) {
      if (subscription.waiting) {
        const resolve = subscription.waiting;
        subscription.waiting = undefined;
        resolve({ done: false, value });
      } else {
        subscription.queue.push(value);
      }
    }
  }

  close(): void {
    this.#closed = true;
    for (const subscription of this.#subscriptions) {
      subscription.done = true;
      subscription.waiting?.({ done: true, value: undefined });
      subscription.waiting = undefined;
    }
    this.#subscriptions.clear();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const subscription: Subscription<T> = {
      done: this.#closed,
      queue: [],
    };
    this.#subscriptions.add(subscription);

    return {
      next: () => {
        const value = subscription.queue.shift();
        if (value !== undefined) {
          return Promise.resolve({ done: false as const, value });
        }
        if (subscription.done || this.#closed) {
          return Promise.resolve({ done: true as const, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          subscription.waiting = resolve;
        });
      },
      return: () => {
        subscription.done = true;
        this.#subscriptions.delete(subscription);
        return Promise.resolve({ done: true as const, value: undefined });
      },
    };
  }
}
