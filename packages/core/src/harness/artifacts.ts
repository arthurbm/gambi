/**
 * The artifacts of a harness participant (ADR-0006): the files of its
 * Workspace, sent up to the hub as a versioned snapshot whenever the
 * Workspace changed and then stayed still.
 *
 * An artifact goes up the same way as everything else that is born on the
 * participant: as a `HarnessEvent`, through `Harness.publish`, in order with
 * what the harness said. There is no other way up, and no way down: nothing
 * here, and nothing in the tunnel, writes a file into the Workspace.
 */
import { Duration, Effect, Layer, Stream } from "effect";
import { Harness } from "./harness.ts";
import { Workspace } from "./workspace.ts";

/** How long the Workspace must stay still before an artifact is taken. */
export const DEFAULT_ARTIFACT_SETTLE_TIME: Duration.Input = "1 second";

/** How long closing waits for the hub to read the last artifact. */
export const DEFAULT_FINAL_ARTIFACT_TIMEOUT: Duration.Input = "2 seconds";

export interface ArtifactsOptions {
  /**
   * How long closing waits for the hub to read the last artifact, before it
   * goes on closing without knowing. Default 2 seconds. Nothing is waited for
   * when the tunnel is down.
   */
  readonly finalTimeout?: Duration.Input | undefined;
  /**
   * How long the Workspace must stay still, after a change, before an
   * artifact is taken. Default 1 second.
   */
  readonly settleTime?: Duration.Input | undefined;
}

/**
 * Sends the artifacts of the Workspace up to the hub, for as long as the
 * layer lives.
 */
export const workspaceArtifacts = (
  options: ArtifactsOptions = {}
): Layer.Layer<never, never, Harness | Workspace> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const harness = yield* Harness;
      const workspace = yield* Workspace;
      let version = 0;

      const send = Effect.fn("Artifacts.send")(function* (
        reason: "watch" | "final"
      ) {
        const files = yield* workspace.collect;
        version += 1;
        yield* harness.publish({
          type: "harness.artifact",
          sessionId: harness.sessionId,
          version,
          reason,
          files,
        });
      });

      // Closing: the watch below stops first, then the last artifact goes.
      // Finalizers run last one first, so this one is registered before the
      // watch starts.
      // It is sent on a best effort: closing never fails for it and never
      // waits for it without a limit.
      yield* Effect.addFinalizer(() =>
        send("final").pipe(
          Effect.andThen(harness.flushed),
          Effect.timeoutOption(
            options.finalTimeout ?? DEFAULT_FINAL_ARTIFACT_TIMEOUT
          ),
          Effect.ignore
        )
      );

      yield* workspace.changes.pipe(
        Stream.debounce(
          Duration.fromInputUnsafe(
            options.settleTime ?? DEFAULT_ARTIFACT_SETTLE_TIME
          )
        ),
        Stream.runForEach(() => send("watch")),
        Effect.ignore,
        Effect.forkScoped
      );
    })
  );
