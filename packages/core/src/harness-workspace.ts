import { type FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const WORKSPACE_METADATA_FILE = ".gambi.json";
const EXCLUDED_ARTIFACT_DIRECTORIES = new Set([".git", "node_modules"]);
const PATH_SEPARATOR_REGEX = /[\\/]/;

type ErrorAwareFsWatcher = FSWatcher & {
  on: (event: "error", listener: (error: Error) => void) => FSWatcher;
};

/** Who a workspace is prepared for. */
export interface WorkspaceContext {
  harness: string;
  model: string;
  participantId: string;
  roomCode: string;
}

/** One file of an artifact snapshot, as sent through the tunnel. */
export interface WorkspaceArtifactFile {
  content: string;
  encoding: "base64" | "utf8";
  path: string;
}

/** A workspace that is ready for a harness session to run in. */
export interface PreparedWorkspace {
  /** Collects the current files to publish as an artifact. */
  collect: () => Promise<WorkspaceArtifactFile[]>;
  /** Absolute path of the folder the harness runs in. */
  readonly path: string;
  /** Calls `onChange` when the content changes. Returns a function that stops watching. */
  watch: (onChange: () => void, onError: (error: Error) => void) => () => void;
}

/**
 * Where a harness session runs on the participant's machine. The hub never
 * sees it. Compose it to seed starter content: prepare a local directory
 * workspace, write files into `path`, and return the prepared workspace.
 */
export interface Workspace {
  prepare: (context: WorkspaceContext) => Promise<PreparedWorkspace>;
}

export interface LocalDirectoryWorkspaceOptions {
  /** Base directory for the default location. Defaults to `~/.gambi`. */
  gambiHome?: string;
  /** Folder to run in. Defaults to `<gambiHome>/workspaces/<room>/<participant>/`. */
  path?: string;
}

function encodeWorkspaceSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded === ".") {
    return "%2E";
  }
  if (encoded === "..") {
    return "%2E%2E";
  }
  return encoded;
}

export function defaultWorkspacePath(
  context: Pick<WorkspaceContext, "participantId" | "roomCode">,
  gambiHome = join(homedir(), ".gambi")
): string {
  return join(
    gambiHome,
    "workspaces",
    encodeWorkspaceSegment(context.roomCode),
    encodeWorkspaceSegment(context.participantId)
  );
}

async function collectArtifactFiles(
  workspacePath: string
): Promise<WorkspaceArtifactFile[]> {
  const files: WorkspaceArtifactFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === WORKSPACE_METADATA_FILE) {
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_ARTIFACT_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const bytes = await readFile(absolutePath);
      let content: string;
      let encoding: "base64" | "utf8";
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        encoding = "utf8";
      } catch {
        content = bytes.toString("base64");
        encoding = "base64";
      }
      files.push({
        path: relative(workspacePath, absolutePath).split(sep).join("/"),
        content,
        encoding,
      });
    }
  }

  await visit(workspacePath);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function watchWorkspace(
  workspacePath: string,
  onChange: () => void,
  onError: (error: Error) => void
): () => void {
  const watcher = watch(
    workspacePath,
    { recursive: true },
    (_eventType, filename) => {
      if (
        !filename ||
        filename.split(PATH_SEPARATOR_REGEX).includes(WORKSPACE_METADATA_FILE)
      ) {
        return;
      }
      onChange();
    }
  );
  (watcher as ErrorAwareFsWatcher).on("error", onError);
  return () => watcher.close();
}

/**
 * The default workspace: a plain folder on the participant's machine. It
 * writes only `.gambi.json` and never seeds other content.
 */
export function createLocalDirectoryWorkspace(
  options: LocalDirectoryWorkspaceOptions = {}
): Workspace {
  return {
    async prepare(context) {
      const path = options.path
        ? resolve(options.path)
        : defaultWorkspacePath(context, options.gambiHome);
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, WORKSPACE_METADATA_FILE),
        `${JSON.stringify(
          {
            roomCode: context.roomCode,
            participantId: context.participantId,
            harness: context.harness,
            model: context.model,
          },
          null,
          2
        )}\n`
      );
      return {
        path,
        collect: () => collectArtifactFiles(path),
        watch: (onChange, onError) => watchWorkspace(path, onChange, onError),
      };
    },
  };
}
