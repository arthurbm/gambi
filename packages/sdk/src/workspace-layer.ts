/**
 * A consumer's Workspace (`./workspace.ts`, in `Promise` and callbacks) as
 * the participant runtime takes it: the `Workspace` service of the core.
 *
 * Internal: the declarations of an entry never reach this file.
 */
import {
  Workspace as RuntimeWorkspace,
  WorkspaceFailed,
  WorkspaceTooLarge,
} from "@gambi/core/harness/workspace";
import { Cause, Effect, Layer, Queue, Stream } from "effect";
import { ParticipantError } from "./participant-error.ts";
import {
  MAX_ARTIFACT_BYTES,
  type Workspace,
  type WorkspaceContext,
} from "./workspace.ts";

/** How many changes wait for whoever takes the artifacts. */
const NOTICED_CHANGES = 64;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * A consumer's Workspace as the participant runtime takes it. Building the
 * layer prepares the Workspace, and fails with a `ParticipantError` when it
 * cannot be prepared; releasing it disposes of the Workspace.
 */
export const workspaceLayer = (
  workspace: Workspace,
  context: WorkspaceContext
): Layer.Layer<RuntimeWorkspace, ParticipantError> =>
  Layer.effect(
    RuntimeWorkspace,
    Effect.gen(function* () {
      const prepared = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => workspace.prepare(context),
          catch: (cause) =>
            cause instanceof ParticipantError
              ? cause
              : new ParticipantError({
                  cause,
                  code: "WORKSPACE_FAILED",
                  message: `Could not prepare the Workspace: ${messageOf(cause)}`,
                }),
        }),
        (ready) =>
          Effect.promise(async () => {
            await ready.dispose?.();
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Disposing of the Workspace failed.", cause)
            )
          )
      );
      const { path } = prepared;
      const failed = (operation: "collect" | "observe") => (cause: unknown) =>
        new WorkspaceFailed({ path, operation, cause });

      // The Workspace is observed from here on, before anything runs in it,
      // like the default one: a change is never missed for having come
      // before the artifacts started to be taken. Each element only says
      // "look again", so the newest ones are enough while nobody reads them.
      // Being unable to observe does not fail the preparation: `changes`
      // fails instead, and the Workspace can still be collected.
      const noticed = yield* Queue.sliding<void, WorkspaceFailed | Cause.Done>(
        NOTICED_CHANGES
      );
      yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            prepared.watch(
              () => {
                Queue.offerUnsafe(noticed, undefined);
              },
              (cause) => {
                Queue.failCauseUnsafe(
                  noticed,
                  Cause.fail(failed("observe")(cause))
                );
              }
            ),
          catch: failed("observe"),
        }).pipe(
          Effect.catch((error) =>
            Effect.as(Queue.fail(noticed, error), () => undefined)
          )
        ),
        (stop) =>
          Effect.sync(stop).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Stopping the watch of the Workspace failed.",
                cause
              )
            )
          )
      );

      return RuntimeWorkspace.of({
        path,
        collect: Effect.tryPromise({
          try: () => prepared.collect(),
          catch: (cause) =>
            cause instanceof ParticipantError &&
            cause.code === "WORKSPACE_TOO_LARGE"
              ? new WorkspaceTooLarge({
                  path,
                  maxBytes:
                    typeof cause.details.maxBytes === "number"
                      ? cause.details.maxBytes
                      : MAX_ARTIFACT_BYTES,
                })
              : failed("collect")(cause),
        }),
        changes: Stream.fromQueue(noticed),
      });
    })
  );
