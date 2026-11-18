/**
 * The Workspace of a harness participant (ADR-0006), as a consumer of the SDK
 * sees it: the folder on this machine where the harness sessions run and from
 * which the artifacts are collected. The hub never sees it, and nothing in
 * the tunnel writes a file in it.
 *
 * It is a seam with three operations: `prepare` makes the folder ready,
 * `watch` says that something in it changed, `collect` reads its files.
 * `createLocalDirectoryWorkspace` is the default, a plain folder. To run
 * somewhere else, or to put starter content in the folder, write a
 * `Workspace` of your own, or build on the default one.
 */
import { BunServices } from "@effect/platform-bun";
import {
  Workspace as RuntimeWorkspace,
  WorkspaceFailed,
  WorkspaceTooLarge,
} from "@gambi/core/harness/workspace";
import { MAX_ARTIFACT_BYTES as CONTRACT_MAX_ARTIFACT_BYTES } from "@gambi/protocol";
import { Cause, Effect, Layer, Queue, Stream } from "effect";
import { failingWith, host } from "./hosting.ts";
import { withoutUndefined } from "./input.ts";
import { ParticipantError, toParticipantError } from "./participant-error.ts";
import type { ArtifactFile } from "./types.ts";

/**
 * The largest artifact a participant sends, in bytes of the JSON text of its
 * event (8 MiB). A Workspace whose files do not fit sends no artifact at all:
 * a part of the files would read as "the others are gone".
 */
export const MAX_ARTIFACT_BYTES: number = CONTRACT_MAX_ARTIFACT_BYTES;

/** The harnesses a participant can host. `fake` is the deterministic test harness, which calls no model. */
export type HostedHarnessId = "opencode" | "claude-code" | "codex" | "fake";

/** Who a Workspace is prepared for. */
export interface WorkspaceContext {
  readonly harness: HostedHarnessId;
  /** The model the participant registers with. */
  readonly model: string;
  readonly participantId: string;
  readonly roomCode: string;
}

/** A Workspace that is ready for harness sessions to run in. */
export interface PreparedWorkspace {
  /**
   * The files of the Workspace as they are now, for an artifact. Reject with
   * a `ParticipantError` of code `WORKSPACE_TOO_LARGE` instead of reading
   * more than `MAX_ARTIFACT_BYTES`: such an artifact is never sent.
   */
  readonly collect: () => Promise<readonly ArtifactFile[]>;
  /** Releases what `prepare` acquired. Called once, when the session ended. */
  readonly dispose?: (() => Promise<void>) | undefined;
  /** The absolute path of the folder the harness runs in. It must exist. */
  readonly path: string;
  /**
   * Calls `onChange` when something in the Workspace changed, and `onError`
   * when it can no longer be observed. It says "look again", not what
   * changed. Returns the function that stops watching. Called once.
   */
  readonly watch: (
    onChange: () => void,
    onError: (error: unknown) => void
  ) => () => void;
}

/**
 * Where the harness sessions of a participant run, on this machine.
 *
 * @example
 * // The default folder, with starter content in it.
 * const local = createLocalDirectoryWorkspace();
 * const seeded: Workspace = {
 *   prepare: async (context) => {
 *     const prepared = await local.prepare(context);
 *     await Bun.write(`${prepared.path}/README.md`, "# Frevo\n");
 *     return prepared;
 *   },
 * };
 */
export interface Workspace {
  readonly prepare: (context: WorkspaceContext) => Promise<PreparedWorkspace>;
}

export interface LocalDirectoryWorkspaceOptions {
  /** The base of the default location. Default: `~/.gambi`. */
  readonly gambiHome?: string | undefined;
  /**
   * How many bytes of files are collected at most before `collect` rejects
   * with `WORKSPACE_TOO_LARGE`. Default `MAX_ARTIFACT_BYTES`.
   */
  readonly maxArtifactBytes?: number | undefined;
  /**
   * The folder to run in, which keeps whatever it already holds. Default:
   * `<gambiHome>/workspaces/<roomCode>/<participantId>/`.
   */
  readonly path?: string | undefined;
}

/**
 * The default Workspace: a folder on this machine. Preparing it creates the
 * folder when it is missing and writes `.gambi.json` in it, and nothing
 * else. Collecting it takes every regular file, without anything named
 * `.git` or `node_modules`, without `.gambi.json` and without symbolic links.
 */
export const createLocalDirectoryWorkspace = (
  options: LocalDirectoryWorkspaceOptions = {}
): Workspace => ({
  prepare: async (context) => {
    const { boundary, value: path } = await host(
      RuntimeWorkspace.layerLocalDirectory(
        withoutUndefined({ ...context, ...options })
      ).pipe(Layer.provide(BunServices.layer), failingWith(toParticipantError)),
      "The Workspace",
      RuntimeWorkspace.use((workspace) => Effect.succeed(workspace.path))
    );
    return {
      path,
      collect: () =>
        boundary.run(
          RuntimeWorkspace.use((workspace) => workspace.collect).pipe(
            Effect.mapError(toParticipantError)
          )
        ),
      watch: (onChange, onError) => {
        const stop = new AbortController();
        const changes = boundary.iterate(
          Stream.unwrap(
            RuntimeWorkspace.use((workspace) =>
              Effect.succeed(workspace.changes)
            )
          ).pipe(Stream.mapError(toParticipantError)),
          { signal: stop.signal }
        );
        (async () => {
          for await (const _ of changes) {
            onChange();
          }
        })().catch(onError);
        return () => stop.abort();
      },
      dispose: boundary.close,
    };
  },
});

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
        changes: Stream.callback<void, WorkspaceFailed>(
          (queue) =>
            Effect.acquireRelease(
              Effect.try({
                try: () =>
                  prepared.watch(
                    () => {
                      Queue.offerUnsafe(queue, undefined);
                    },
                    (cause) => {
                      Queue.failCauseUnsafe(
                        queue,
                        Cause.fail(failed("observe")(cause))
                      );
                    }
                  ),
                catch: failed("observe"),
              }),
              (stop) => Effect.sync(stop)
            ),
          // Each element only says "look again": the newest ones are enough.
          { bufferSize: 64, strategy: "sliding" }
        ),
      });
    })
  );
