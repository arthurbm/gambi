export type TerminationSignal = "SIGINT" | "SIGTERM";

const TERMINATION_SIGNALS: TerminationSignal[] = ["SIGINT", "SIGTERM"];

/**
 * How long a second SIGINT/SIGTERM is treated as a copy of the first.
 *
 * The npm wrapper forwards the signals it receives to this binary. A Ctrl+C
 * (the terminal signals the whole foreground process group) or a group kill
 * (systemd, `kill -TERM -<pgid>`) therefore arrives twice within a few
 * milliseconds. Without this window the copy would hit the default action and
 * kill the process in the middle of its cleanup.
 */
export const DUPLICATE_SIGNAL_WINDOW_MS = 1000;

interface SignalProcess {
  off: (signal: TerminationSignal, listener: () => void) => unknown;
  on: (signal: TerminationSignal, listener: () => void) => unknown;
}

/**
 * Calls `onSignal` for the first SIGINT or SIGTERM. Copies that arrive within
 * `windowMs` are ignored; after that the listeners are removed, so a later
 * Ctrl+C still force-quits a stuck shutdown, as it did with `process.once`.
 * Returns a function that removes the listeners early.
 */
export function onceTerminationSignal(
  onSignal: (signal: TerminationSignal) => void,
  options: { signalProcess?: SignalProcess; windowMs?: number } = {}
): () => void {
  const signalProcess: SignalProcess =
    options.signalProcess ?? (process as unknown as SignalProcess);
  const windowMs = options.windowMs ?? DUPLICATE_SIGNAL_WINDOW_MS;
  let received = false;

  const listeners = TERMINATION_SIGNALS.map((signal) => {
    const listener = () => {
      if (received) {
        return;
      }
      received = true;
      setTimeout(dispose, windowMs).unref?.();
      onSignal(signal);
    };
    return { listener, signal };
  });

  function dispose() {
    for (const { listener, signal } of listeners) {
      signalProcess.off(signal, listener);
    }
  }

  for (const { listener, signal } of listeners) {
    signalProcess.on(signal, listener);
  }

  return dispose;
}
