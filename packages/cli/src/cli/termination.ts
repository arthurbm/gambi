/**
 * The request to stop the process: SIGINT (Ctrl+C) or SIGTERM.
 *
 * A one-shot command ignores this service: a signal interrupts it and the
 * process exits with 130. A long-running command (`hub serve`,
 * `participant join`) awaits `Termination.signal` and then returns normally,
 * so that stopping it on purpose is a success (exit 0) and its last events
 * are written in order.
 */
import { Context, Deferred, Effect } from "effect";

export type TerminationSignal = "SIGINT" | "SIGTERM";

export class Termination extends Context.Service<
  Termination,
  {
    /**
     * Waits for the signal that asks the process to stop. From the first
     * time a command awaits it, a signal no longer interrupts the command:
     * the command owns its shutdown.
     */
    readonly signal: Effect.Effect<TerminationSignal>;
  }
>()("gambi/cli/Termination") {}

export interface TerminationSource {
  /**
   * Delivers a signal. `true` when a command was waiting for it and now
   * shuts down by itself; `false` when nobody was, and the caller must
   * interrupt the command.
   */
  readonly request: (signal: TerminationSignal) => boolean;
  readonly service: Termination["Service"];
}

/**
 * The link between whoever receives signals (the entrypoint, or a test) and
 * the `Termination` service the commands see.
 */
export const makeTermination = (): TerminationSource => {
  const requested = Deferred.makeUnsafe<TerminationSignal>();
  let awaited = false;
  return {
    request: (signal) => {
      Deferred.doneUnsafe(requested, Effect.succeed(signal));
      return awaited;
    },
    service: Termination.of({
      signal: Effect.suspend(() => {
        awaited = true;
        return Deferred.await(requested);
      }),
    }),
  };
};
