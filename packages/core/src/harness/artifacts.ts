/**
 * The artifacts of a harness participant (ADR-0006): the files of its
 * Workspace, sent up to the hub as a versioned snapshot whenever the
 * Workspace changed and then stayed still.
 *
 * An artifact goes up the same way as everything else that is born on the
 * participant: as a `HarnessEvent`, through `Harness.publish`, in order with
 * what the harness said. There is no other way up, and no way down: nothing
 * here, and nothing in the tunnel, writes a file into the Workspace.
 *
 * An artifact is one event, and an event has a size it cannot pass
 * (`MAX_ARTIFACT_BYTES` says why). A Workspace that does not fit sends no
 * artifact: a part of it would read as "the other files are gone".
 */
import { type HarnessArtifact, MAX_ARTIFACT_BYTES } from "@gambi/protocol";
import { Duration, Effect, Layer, Stream } from "effect";
import { Harness } from "./harness.ts";
import { Workspace } from "./workspace.ts";

/** How long the Workspace must stay still before an artifact is taken. */
export const DEFAULT_ARTIFACT_SETTLE_TIME: Duration.Input = "1 second";

/** How long closing waits for the hub to read the last artifact. */
export const DEFAULT_FINAL_ARTIFACT_TIMEOUT: Duration.Input = "2 seconds";

/**
 * What happened to an artifact, as the host of the participant is told
 * (`ArtifactsOptions.onArtifact`). Plain JSON, so a host can print an event
 * as it is.
 *
 * - `artifactSent`: it went up, with this version; `bytes` is its size as it
 *   travels.
 * - `artifactSkipped`: none went up, and no version was taken. `tooLarge`:
 *   the Workspace does not fit in one event of `maxBytes`. `collectFailed`:
 *   its files could not be read.
 */
export type ArtifactLifecycleEvent =
  | {
      readonly type: "artifactSent";
      readonly sessionId: string;
      readonly version: number;
      readonly reason: HarnessArtifact["reason"];
      readonly fileCount: number;
      readonly bytes: number;
    }
  | {
      readonly type: "artifactSkipped";
      readonly sessionId: string;
      readonly reason: HarnessArtifact["reason"];
      readonly cause: "tooLarge";
      readonly maxBytes: number;
    }
  | {
      readonly type: "artifactSkipped";
      readonly sessionId: string;
      readonly reason: HarnessArtifact["reason"];
      readonly cause: "collectFailed";
    };

export interface ArtifactsOptions {
  /**
   * How long closing waits for the hub to read the last artifact, before it
   * goes on closing without knowing. Default 2 seconds. Nothing is waited for
   * when the tunnel is down.
   */
  readonly finalTimeout?: Duration.Input | undefined;
  /**
   * The largest artifact that is sent, in bytes as it travels. Default, and
   * at most, `MAX_ARTIFACT_BYTES`.
   */
  readonly maxBytes?: number | undefined;
  /**
   * Called with what happened to each artifact, in order. The artifacts wait
   * for it, so keep it quick.
   */
  readonly onArtifact?:
    | ((event: ArtifactLifecycleEvent) => Effect.Effect<void>)
    | undefined;
  /**
   * How long the Workspace must stay still, after a change, before an
   * artifact is taken. Default 1 second.
   */
  readonly settleTime?: Duration.Input | undefined;
}

const encoder = new TextEncoder();

/**
 * Sends the artifacts of the Workspace up to the hub, for as long as the
 * layer lives: one each time the Workspace changed and then stayed still for
 * `settleTime`, and a last one when the layer is released.
 *
 * Release it before the participant runtime, so that the last artifact goes
 * while the tunnel is open: `harnessParticipant` (`./harness-participant.ts`)
 * puts the layers in that order.
 */
export const workspaceArtifacts = (
  options: ArtifactsOptions = {}
): Layer.Layer<never, never, Harness | Workspace> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const harness = yield* Harness;
      const workspace = yield* Workspace;
      const { sessionId } = harness;
      const maxBytes = Math.min(
        options.maxBytes ?? MAX_ARTIFACT_BYTES,
        MAX_ARTIFACT_BYTES
      );
      const tell = (event: ArtifactLifecycleEvent) =>
        Effect.logInfo(event.type).pipe(
          Effect.annotateLogs(event),
          Effect.andThen(options.onArtifact?.(event) ?? Effect.void)
        );
      let version = 0;

      const send = Effect.fn("Artifacts.send")(function* (
        reason: HarnessArtifact["reason"]
      ) {
        const files = yield* workspace.collect;
        const artifact: HarnessArtifact = {
          type: "harness.artifact",
          sessionId,
          version: version + 1,
          reason,
          files,
        };
        // Its size as it travels: the JSON text of the event, in UTF-8.
        const bytes = encoder.encode(JSON.stringify(artifact)).length;
        if (bytes > maxBytes) {
          return yield* tell({
            type: "artifactSkipped",
            sessionId,
            reason,
            cause: "tooLarge",
            maxBytes,
          });
        }
        version += 1;
        yield* harness.publish(artifact);
        yield* tell({
          type: "artifactSent",
          sessionId,
          version,
          reason,
          fileCount: files.length,
          bytes,
        });
      });
      // An artifact that cannot be taken is skipped, and the next change
      // tries again.
      const sendOrSkip = (reason: HarnessArtifact["reason"]) =>
        send(reason).pipe(
          Effect.catchTags({
            WorkspaceTooLarge: (error) =>
              tell({
                type: "artifactSkipped",
                sessionId,
                reason,
                cause: "tooLarge",
                maxBytes: error.maxBytes,
              }),
            WorkspaceFailed: (error) =>
              Effect.logWarning(error.message).pipe(
                Effect.andThen(
                  tell({
                    type: "artifactSkipped",
                    sessionId,
                    reason,
                    cause: "collectFailed",
                  })
                )
              ),
          })
        );

      // Closing: the watch below stops first, then the last artifact goes.
      // Finalizers run last one first, so this one is registered before the
      // watch starts. It is sent on a best effort: closing never fails for it
      // and never waits for it without a limit.
      yield* Effect.addFinalizer(() =>
        sendOrSkip("final").pipe(
          Effect.andThen(harness.flushed),
          Effect.timeoutOption(
            options.finalTimeout ?? DEFAULT_FINAL_ARTIFACT_TIMEOUT
          )
        )
      );

      yield* workspace.changes.pipe(
        Stream.debounce(
          Duration.fromInputUnsafe(
            options.settleTime ?? DEFAULT_ARTIFACT_SETTLE_TIME
          )
        ),
        Stream.runForEach(() => sendOrSkip("watch")),
        // A Workspace that cannot be observed still has its last artifact.
        Effect.catchTag("WorkspaceFailed", (error) =>
          Effect.logWarning(
            `${error.message} Its artifacts are sent only when the participant closes.`
          )
        ),
        Effect.forkScoped
      );
    })
  );
