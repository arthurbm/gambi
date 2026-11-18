/**
 * The Workspace of a harness participant (ADR-0006): the folder on the
 * participant's machine where its harness sessions run and from which its
 * artifacts are collected. The hub never sees it.
 *
 * It is a seam with three operations:
 *
 * - **prepare**: building the layer. It makes the folder ready and says where
 *   it is (`path`).
 * - **observe**: `changes`, which says that something in the folder changed.
 * - **collect**: `collect`, the files of the folder as they are now.
 *
 * `Workspace.layerLocalDirectory` is the default: a plain folder that holds
 * only the participant's metadata. Whoever wants starter content in it, or
 * another place to run, provides a `Workspace` of their own, or builds on the
 * default and writes into `path`.
 *
 * Artifacts leave the Workspace and go up to the hub. Nothing comes down: the
 * tunnel has no call that writes a file here.
 */
import { homedir } from "node:os";
import {
  type ArtifactFile,
  type HarnessId,
  MAX_ARTIFACT_BYTES,
} from "@gambi/protocol";
import {
  type Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  type PlatformError,
  Queue,
  Schema,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";

/** The file the default Workspace writes: who the folder was prepared for. */
export const WORKSPACE_METADATA_FILE = ".gambi.json";

/** Who a Workspace is prepared for. */
export interface WorkspaceContext {
  readonly harness: HarnessId;
  /** The model the participant registers with. */
  readonly model: string;
  readonly participantId: string;
  readonly roomCode: string;
}

export interface LocalDirectoryOptions extends WorkspaceContext {
  /**
   * How many bytes of files are collected at most, before `collect` fails
   * with `WorkspaceTooLarge`. Default `MAX_ARTIFACT_BYTES`.
   */
  readonly maxArtifactBytes?: number | undefined;
  /** The base of the default location. Default: `~/.gambi`. */
  readonly gambiHome?: string | undefined;
  /**
   * The folder to run in, which keeps whatever it already holds. Default:
   * `<gambiHome>/workspaces/<roomCode>/<participantId>/`.
   */
  readonly path?: string | undefined;
}

/** Something about the Workspace's folder failed: it could not be made ready, read or observed. */
export class WorkspaceFailed extends Schema.TaggedError<WorkspaceFailed>()(
  "WorkspaceFailed",
  {
    path: Schema.String,
    operation: Schema.Literals(["prepare", "collect", "observe"]),
    cause: Schema.Defect(),
  }
) {
  override get message(): string {
    return `Could not ${this.operation} the Workspace at '${this.path}'.`;
  }
}

/**
 * Names that are never part of an artifact, wherever they are in the
 * Workspace: what they hold is large and is not what the harness session
 * produced.
 */
const EXCLUDED_NAMES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** How many changes wait for whoever observes the Workspace. */
const NOTICED_CHANGES = 64;

const PATH_SEPARATOR = /[\\/]/;

/** Whether a change at this path, relative to the Workspace, can change an artifact. */
const changesAnArtifact = (relativePath: string): boolean =>
  relativePath !== WORKSPACE_METADATA_FILE &&
  !relativePath
    .split(PATH_SEPARATOR)
    .some((segment) => EXCLUDED_NAMES.has(segment));

/** The file as an artifact carries it: as text when it is valid UTF-8. */
const encodeFile = (path: string, bytes: Uint8Array): ArtifactFile => {
  try {
    return {
      path,
      encoding: "utf8",
      // `ignoreBOM` keeps a byte order mark: without it the file would lose
      // its first three bytes on the way.
      content: new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes),
    };
  } catch {
    return { path, encoding: "base64", content: Base64.encode(bytes) };
  }
};

/**
 * Every regular file under `root`, in the order of its path. A symbolic link
 * is neither followed nor collected: what an artifact carries is inside the
 * Workspace, and a link may point anywhere on the machine.
 *
 * It fails before reading a file that would take the total past `maxBytes`:
 * no file travels in fewer bytes than it has, so the artifact could not be
 * sent, and a folder of gigabytes must not be read for nothing at every
 * change.
 */
const collectFiles = Effect.fnUntraced(function* (
  root: string,
  maxBytes: number
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: ArtifactFile[] = [];
  let total = 0;
  const collect = Effect.fnUntraced(function* (
    relative: string,
    absolute: string
  ) {
    if (total + Number((yield* fs.stat(absolute)).size) > maxBytes) {
      return yield* new WorkspaceTooLarge({ path: root, maxBytes });
    }
    // Counted by what was read: the file may have grown since it was
    // measured.
    const bytes = yield* fs.readFile(absolute);
    total += bytes.length;
    if (total > maxBytes) {
      return yield* new WorkspaceTooLarge({ path: root, maxBytes });
    }
    files.push(encodeFile(relative, bytes));
  });
  const visit = (
    folder: string,
    prefix: string
  ): Effect.Effect<void, PlatformError.PlatformError | WorkspaceTooLarge> =>
    Effect.gen(function* () {
      for (const entry of yield* fs.readDirectoryEntries(folder)) {
        // By name, whatever it is: `.git` is a file in a git worktree and
        // in a submodule.
        if (EXCLUDED_NAMES.has(entry.name)) {
          continue;
        }
        const relative = `${prefix}${entry.name}`;
        const absolute = path.join(folder, entry.name);
        if (entry.type === "File" && relative !== WORKSPACE_METADATA_FILE) {
          yield* collect(relative, absolute);
        }
        if (entry.type === "Directory") {
          yield* visit(absolute, `${relative}/`);
        }
      }
    });
  yield* visit(root, "");
  return files.sort((left, right) => {
    if (left.path === right.path) {
      return 0;
    }
    return left.path < right.path ? -1 : 1;
  });
});

/**
 * The files of the Workspace are more than an artifact can carry. Nothing was
 * collected: a part of the files would read as "the others are gone".
 */
export class WorkspaceTooLarge extends Schema.TaggedError<WorkspaceTooLarge>()(
  "WorkspaceTooLarge",
  { path: Schema.String, maxBytes: Schema.Int }
) {
  override get message(): string {
    return `The Workspace at '${this.path}' holds more than the ${this.maxBytes} bytes one artifact can carry.`;
  }
}

/** A room code or a participant id as one path segment that cannot leave its parent. */
const asSegment = (value: string): string => {
  const encoded = encodeURIComponent(value);
  if (encoded === ".") {
    return "%2E";
  }
  return encoded === ".." ? "%2E%2E" : encoded;
};

export class Workspace extends Context.Service<
  Workspace,
  {
    /**
     * Something in the Workspace changed. One element per change noticed, or
     * fewer: it says "look again", not what changed.
     */
    readonly changes: Stream.Stream<void, WorkspaceFailed>;
    /** The files of the Workspace as they are now, for an artifact. */
    readonly collect: Effect.Effect<
      readonly ArtifactFile[],
      WorkspaceFailed | WorkspaceTooLarge
    >;
    /** The absolute path of the folder the harness runs in. */
    readonly path: string;
  }
>()("gambi/core/Workspace") {
  /**
   * The default Workspace: a folder on this machine. Preparing it creates the
   * folder when it is missing and writes `.gambi.json` in it, and nothing
   * else.
   */
  static readonly layerLocalDirectory = (
    options: LocalDirectoryOptions
  ): Layer.Layer<
    Workspace,
    WorkspaceFailed,
    FileSystem.FileSystem | Path.Path
  > =>
    Layer.effect(
      Workspace,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder =
          options.path === undefined
            ? path.join(
                options.gambiHome ?? path.join(homedir(), ".gambi"),
                "workspaces",
                asSegment(options.roomCode),
                asSegment(options.participantId)
              )
            : path.resolve(options.path);
        const { harness, model, participantId, roomCode } = options;

        yield* fs.makeDirectory(folder, { recursive: true }).pipe(
          Effect.andThen(
            fs.writeFileString(
              path.join(folder, WORKSPACE_METADATA_FILE),
              `${JSON.stringify({ roomCode, participantId, harness, model }, null, 2)}\n`
            )
          ),
          Effect.mapError(
            (cause) =>
              new WorkspaceFailed({ path: folder, operation: "prepare", cause })
          )
        );

        // The folder is observed from here on, before anything runs in it:
        // a change is never missed for having come too early. Being unable
        // to observe does not fail the preparation; `changes` fails instead,
        // and the folder can still be collected.
        // Each element only says "look again", so the newest ones are enough
        // when nobody is reading them.
        const noticed = yield* Queue.sliding<
          void,
          WorkspaceFailed | Cause.Done
        >(NOTICED_CHANGES);
        const observing = yield* Deferred.make<void>();
        yield* fs
          .watch(folder, {
            recursive: true,
            onReady: () => Deferred.doneUnsafe(observing, Exit.void),
          })
          .pipe(
            // A watch reports a path inside the folder, or the whole path.
            Stream.filter((event) =>
              changesAnArtifact(
                path.isAbsolute(event.path)
                  ? path.relative(folder, event.path)
                  : event.path
              )
            ),
            Stream.runForEach(() => Queue.offer(noticed, undefined)),
            Effect.matchEffect({
              onSuccess: () => Queue.end(noticed),
              onFailure: (cause) =>
                Queue.fail(
                  noticed,
                  new WorkspaceFailed({
                    path: folder,
                    operation: "observe",
                    cause,
                  })
                ),
            }),
            Effect.ensuring(Deferred.succeed(observing, undefined)),
            Effect.forkScoped
          );
        yield* Deferred.await(observing);

        return Workspace.of({
          changes: Stream.fromQueue(noticed),
          collect: collectFiles(
            folder,
            options.maxArtifactBytes ?? MAX_ARTIFACT_BYTES
          ).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.catchTag(
              "PlatformError",
              (cause) =>
                new WorkspaceFailed({
                  path: folder,
                  operation: "collect",
                  cause,
                })
            )
          ),
          path: folder,
        });
      })
    );
}
