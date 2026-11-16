/**
 * Carries out an update plan (`update-plan.ts`). The network is
 * `HttpClient`, the subprocess is `ChildProcessSpawner` and the disk is
 * `FileSystem`: the entrypoint provides the real ones, a test its own.
 */
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { HttpClient, type HttpClientError } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Installation } from "./installation.ts";
import {
  PACKAGE_MANAGERS,
  type PackageManagerUpdatePlan,
  type StandaloneUpdatePlan,
} from "./update-plan.ts";

/** The package manager could not be started: not installed, or not on PATH. */
export class PackageManagerUnavailable extends Schema.TaggedError<PackageManagerUnavailable>()(
  "PackageManagerUnavailable",
  { manager: Schema.Literals(PACKAGE_MANAGERS), cause: Schema.Defect() }
) {
  override get message(): string {
    return `Could not run ${this.manager}.`;
  }

  get hint(): string {
    return `Check that ${this.manager} is installed and on PATH, or choose another with --manager.`;
  }
}

/** The package manager ran and reported a failure. */
export class PackageManagerFailed extends Schema.TaggedError<PackageManagerFailed>()(
  "PackageManagerFailed",
  {
    manager: Schema.Literals(PACKAGE_MANAGERS),
    /** The exit code of the package manager. */
    code: Schema.Int,
    /** What it printed, when gambi captured it instead of showing it. */
    stdout: Schema.optionalKey(Schema.String),
    stderr: Schema.optionalKey(Schema.String),
  }
) {
  override get message(): string {
    return `${this.manager} exited with code ${this.code}.`;
  }
}

export interface PackageManagerResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

/** How long a package manager gets to stop after it is told to. */
const PACKAGE_MANAGER_KILL_GRACE = "3 seconds";

/**
 * Runs the package manager of `plan` to the end.
 *
 * With `capture` its output is collected and returned, so that stdout stays
 * a JSON document. Without it the package manager writes straight to the
 * terminal, as if the person had run it.
 */
export const runPackageManager = Effect.fn("update.runPackageManager")(
  function* (plan: PackageManagerUpdatePlan, options: { capture: boolean }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = options.capture ? "pipe" : "inherit";
    const unavailable = (cause: unknown) =>
      new PackageManagerUnavailable({ manager: plan.manager, cause });

    const handle = yield* spawner
      .spawn(
        ChildProcess.make(plan.manager, plan.args, {
          stdin: options.capture ? "ignore" : "inherit",
          stdout: output,
          stderr: output,
          // In the group of gambi, so that it reads the terminal and a
          // Ctrl+C reaches it too.
          detached: false,
          forceKillAfter: PACKAGE_MANAGER_KILL_GRACE,
        })
      )
      .pipe(Effect.mapError(unavailable));

    const [stdout, stderr, code] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ],
      { concurrency: "unbounded" }
    ).pipe(Effect.mapError(unavailable));

    if (code !== 0) {
      return yield* new PackageManagerFailed({
        manager: plan.manager,
        code,
        ...(options.capture ? { stdout, stderr } : {}),
      });
    }
    return { code, stdout, stderr } satisfies PackageManagerResult;
  },
  Effect.scoped
);

/** The new binary did not arrive: no network, or the release has no such file. */
export class UpdateDownloadFailed extends Schema.TaggedError<UpdateDownloadFailed>()(
  "UpdateDownloadFailed",
  {
    url: Schema.String,
    /** The HTTP status of the answer, when there was one. */
    status: Schema.optionalKey(Schema.Int),
    cause: Schema.Defect(),
  }
) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (HTTP ${this.status})`;
    return `Could not download ${this.url}${status}.`;
  }

  get hint(): string {
    return "Check the network and try again.";
  }
}

/** The new binary arrived, and could not be put in the place of the old one. */
export class BinaryReplaceFailed extends Schema.TaggedError<BinaryReplaceFailed>()(
  "BinaryReplaceFailed",
  { binaryPath: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Could not replace ${this.binaryPath}.`;
  }

  get hint(): string {
    return "Check that you may write to its folder.";
  }
}

/** On Windows, the script that finishes the update could not be started. */
export class UpdateNotScheduled extends Schema.TaggedError<UpdateNotScheduled>()(
  "UpdateNotScheduled",
  { binaryPath: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return "Could not start the PowerShell script that finishes the update.";
  }

  get hint(): string {
    return "Check that powershell.exe is on PATH.";
  }
}

export interface StandaloneUpdateResult {
  /**
   * `updated`: the new binary is in place. `scheduled`: on Windows, it is
   * put in place right after this process ends.
   */
  readonly kind: "scheduled" | "updated";
}

const updated: StandaloneUpdateResult = { kind: "updated" };
const scheduled: StandaloneUpdateResult = { kind: "scheduled" };

const DOWNLOAD_USER_AGENT = "gambi-cli-update";

/**
 * Windows does not let a running executable be replaced. This script waits
 * for gambi to end, moves the new binary over the old one and removes
 * itself.
 */
const WINDOWS_UPDATER_SCRIPT = [
  "param(",
  "  [int]$ParentPid,",
  "  [string]$SourcePath,",
  "  [string]$DestinationPath",
  ")",
  '$ErrorActionPreference = "Stop"',
  "while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {",
  "  Start-Sleep -Milliseconds 200",
  "}",
  "Move-Item -Force $SourcePath $DestinationPath",
  'Write-Host "[INFO] Gambi update finished."',
  "Remove-Item -Force $PSCommandPath",
  "",
].join("\n");

/**
 * Updates a standalone binary: downloads the binary of `plan` to a file
 * beside the installed one, then puts it in its place.
 *
 * Elsewhere than Windows that is a rename, which is atomic: the installed
 * binary is always whole, the old one or the new one. On Windows a detached
 * script does it once this process is gone.
 *
 * A failure, or a Ctrl+C, leaves the old binary and no temporary file.
 */
export const applyStandaloneUpdate = Effect.fn("update.applyStandaloneUpdate")(
  function* (plan: StandaloneUpdatePlan) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const { pid } = yield* Installation;
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk
    );

    const downloadFailed = (cause: HttpClientError.HttpClientError) =>
      new UpdateDownloadFailed({
        url: plan.downloadUrl,
        cause,
        ...(cause.response === undefined
          ? {}
          : { status: cause.response.status }),
      });
    const replaceFailed = (cause: unknown) =>
      new BinaryReplaceFailed({ binaryPath: plan.binaryPath, cause });

    const beside = (suffix: string) =>
      path.join(
        path.dirname(plan.binaryPath),
        `.${path.basename(plan.binaryPath)}.${suffix}-${pid}`
      );
    const downloadedPath = beside("tmp");
    const scriptPath = `${beside("update")}.ps1`;

    const download = Effect.gen(function* () {
      const response = yield* client
        .get(plan.downloadUrl, {
          headers: { "user-agent": DOWNLOAD_USER_AGENT },
        })
        .pipe(Effect.mapError(downloadFailed));
      yield* response.stream.pipe(
        Stream.mapError(downloadFailed),
        Stream.run(fs.sink(downloadedPath)),
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(replaceFailed(cause))
        )
      );
    });

    const replaceNow = Effect.gen(function* () {
      yield* fs.chmod(downloadedPath, 0o755);
      yield* fs.rename(downloadedPath, plan.binaryPath);
      return updated;
    }).pipe(Effect.mapError(replaceFailed));

    const replaceWhenGambiEnds = Effect.gen(function* () {
      yield* fs
        .writeFileString(scriptPath, WINDOWS_UPDATER_SCRIPT)
        .pipe(Effect.mapError(replaceFailed));
      const updater = yield* spawner.spawn(
        ChildProcess.make(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-ParentPid",
            String(pid),
            "-SourcePath",
            downloadedPath,
            "-DestinationPath",
            plan.binaryPath,
          ],
          {
            detached: true,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            windowsHide: true,
          }
        )
      );
      // Let go of it: a subprocess gambi still holds is killed when this
      // scope closes, and would keep gambi from ending.
      yield* updater.unref;
      return scheduled;
    }).pipe(
      Effect.scoped,
      Effect.catchTag("PlatformError", (cause) =>
        Effect.fail(
          new UpdateNotScheduled({ binaryPath: plan.binaryPath, cause })
        )
      )
    );

    return yield* download.pipe(
      Effect.andThen(
        plan.platform === "win32" ? replaceWhenGambiEnds : replaceNow
      ),
      Effect.onError(() =>
        Effect.all(
          [downloadedPath, scriptPath].map((file) =>
            Effect.ignore(fs.remove(file, { force: true }))
          ),
          { discard: true }
        )
      )
    );
  }
);
