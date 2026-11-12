import { expect } from "bun:test";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@gambi/testing/effect";
import { Effect, PlatformError } from "effect";
import {
  type RunOptions,
  runCommand,
  type SpawnedCommand,
  spawnerThat,
} from "./testing.ts";

it.effect("--dry-run prints the update plan and runs nothing", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([
      "self",
      "update",
      "--manager",
      "bun",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).data).toEqual({
      plan: {
        kind: "package-manager",
        manager: "bun",
        args: ["add", "-g", "gambi@latest"],
        command: "bun add -g gambi@latest",
      },
    });
  })
);

it.effect("--manager is read without regard to case", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([
      "self",
      "update",
      "--manager",
      "NPM",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data.plan).toEqual({
      kind: "package-manager",
      manager: "npm",
      args: ["install", "-g", "gambi@latest"],
      command: "npm install -g gambi@latest",
    });
  })
);

it.effect("a package manager gambi is not published to is invalid usage", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([
      "self",
      "update",
      "--manager",
      "pnpm",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "InvalidValue",
      details: { option: "manager", value: "pnpm" },
    });
  })
);

it.effect("on a terminal --dry-run prints the plan as one readable line", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(
      ["self", "update", "--manager", "npm", "--dry-run"],
      { tty: true }
    );

    expect(result.exitCode).toBe(0);
    expect(result.terminal).toBe("");
    expect(result.stdout).toBe("Would run: npm install -g gambi@latest\n");
  })
);

const BUN_PLAN = {
  kind: "package-manager",
  manager: "bun",
  args: ["add", "-g", "gambi@latest"],
  command: "bun add -g gambi@latest",
};

const NPM_PLAN = {
  kind: "package-manager",
  manager: "npm",
  args: ["install", "-g", "gambi@latest"],
  command: "npm install -g gambi@latest",
};

const BUN_GLOBAL_PATH =
  "/home/alice/.bun/install/global/node_modules/gambi/bin/.gambi";
const NPM_GLOBAL_PATH = "/usr/local/lib/node_modules/gambi/bin/.gambi";
const BUN_USER_AGENT = "bun/1.3.10 npm/? node/v22.0.0 linux x64";
const NPM_USER_AGENT = "npm/10.9.0 node/v22.0.0 linux x64";

/** The plan `self update --dry-run` prints for an installation. */
const planFor = (options: RunOptions, args: readonly string[] = []) =>
  runCommand(["self", "update", "--dry-run", ...args], options).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(JSON.parse(result.stdout).data.plan)
        : Effect.die(
            new Error(`self update --dry-run failed:\n${result.stderr}`)
          )
    )
  );

it.effect("--manager wins over where gambi is installed", () =>
  Effect.gen(function* () {
    const plan = yield* planFor(
      { installation: { execPath: NPM_GLOBAL_PATH } },
      ["--manager", "bun"]
    );

    expect(plan).toEqual(BUN_PLAN);
  })
);

it.effect("an executable under bun's global folder updates with bun", () =>
  Effect.gen(function* () {
    const plan = yield* planFor({
      installation: { execPath: BUN_GLOBAL_PATH },
    });

    expect(plan).toEqual(BUN_PLAN);
  })
);

it.effect("an executable under node_modules/gambi updates with npm", () =>
  Effect.gen(function* () {
    const plan = yield* planFor({
      installation: { execPath: NPM_GLOBAL_PATH },
    });

    expect(plan).toEqual(NPM_PLAN);
  })
);

it.effect("where the executable is wins over npm's user agent", () =>
  Effect.gen(function* () {
    const underBun = yield* planFor({
      installation: { execPath: BUN_GLOBAL_PATH },
      env: { npm_config_user_agent: NPM_USER_AGENT },
    });
    const underNpm = yield* planFor({
      installation: { execPath: NPM_GLOBAL_PATH },
      env: { npm_config_user_agent: BUN_USER_AGENT },
    });

    expect(underBun).toEqual(BUN_PLAN);
    expect(underNpm).toEqual(NPM_PLAN);
  })
);

it.effect(
  "the platform package of the npm distribution updates with npm, even outside node_modules",
  () =>
    Effect.gen(function* () {
      // A global install that is a symlink: the executable resolves to the
      // platform package itself.
      const plan = yield* planFor({
        installation: {
          execPath:
            "/workspace/packages/cli/dist/npm/gambi-linux-x64/bin/gambi",
          argv: ["bun", "/$bunfs/root/gambi-linux-x64", "self", "update"],
        },
      });

      expect(plan).toEqual(NPM_PLAN);
    })
);

it.effect(
  "the user agent of the package manager decides when the paths say nothing",
  () =>
    Effect.gen(function* () {
      const plan = yield* planFor({
        env: { npm_config_user_agent: BUN_USER_AGENT },
      });

      expect(plan).toEqual(BUN_PLAN);
    })
);

it.effect("an installation of unknown origin is not updated", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--dry-run"], {
      installation: {
        execPath: "/usr/local/bin/custom-gambi",
        argv: ["bun", "src/cli.ts", "self", "update"],
      },
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "UnknownInstallSource",
      message: "Could not tell how this gambi was installed.",
      hint: "Run it again with --manager bun or --manager npm.",
      exitCode: 3,
    });
  })
);

const STANDALONE_PATH = "/home/alice/.local/bin/gambi";

it.effect(
  "a standalone binary updates by download, whatever the user agent says",
  () =>
    Effect.gen(function* () {
      const plan = yield* planFor({
        installation: {
          execPath: STANDALONE_PATH,
          platform: "linux",
          arch: "x64",
        },
        env: {
          npm_config_user_agent: NPM_USER_AGENT,
          GAMBI_UPDATE_BASE_URL:
            "https://example.com/releases/latest/download/",
        },
      });

      expect(plan).toEqual({
        kind: "standalone",
        platform: "linux",
        binaryPath: STANDALONE_PATH,
        assetName: "gambi-linux-x64",
        downloadUrl:
          "https://example.com/releases/latest/download/gambi-linux-x64",
        command: `download gambi-linux-x64 and replace ${STANDALONE_PATH}`,
      });
    })
);

it.effect(
  "a standalone binary is told apart from the path Bun gives a compiled binary",
  () =>
    Effect.gen(function* () {
      const plan = yield* planFor({
        installation: {
          execPath: STANDALONE_PATH,
          argv: ["bun", "/$bunfs/root/gambi-darwin-arm64", "self", "update"],
          platform: "darwin",
          arch: "arm64",
        },
      });

      expect(plan).toMatchObject({
        kind: "standalone",
        assetName: "gambi-darwin-arm64",
        binaryPath: STANDALONE_PATH,
      });
    })
);

it.effect("a standalone binary downloads from the latest GitHub release", () =>
  Effect.gen(function* () {
    const plan = yield* planFor({
      installation: {
        execPath: "C:\\Users\\alice\\bin\\gambi.exe",
        platform: "win32",
        arch: "x64",
      },
    });

    expect(plan).toMatchObject({
      kind: "standalone",
      platform: "win32",
      assetName: "gambi-windows-x64.exe",
      downloadUrl:
        "https://github.com/arthurbm/gambi/releases/latest/download/gambi-windows-x64.exe",
    });
  })
);

it.effect("a platform without a released binary is of unknown origin", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--dry-run"], {
      installation: {
        execPath: "C:\\Users\\alice\\bin\\gambi.exe",
        platform: "win32",
        arch: "arm64",
      },
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr).error.name).toBe("UnknownInstallSource");
  })
);

it.effect("updates with the package manager and reports what it printed", () =>
  Effect.gen(function* () {
    const spawned: SpawnedCommand[] = [];

    const result = yield* runCommand(["self", "update"], {
      installation: { execPath: NPM_GLOBAL_PATH },
      spawner: spawnerThat((command) => {
        spawned.push(command);
        return { stdout: "updated\n", stderr: "warning\n" };
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    // Without a terminal nothing is asked.
    expect(result.terminal).toBe("");
    expect(JSON.parse(result.stdout).data).toEqual({
      plan: NPM_PLAN,
      result: { code: 0, stdout: "updated\n", stderr: "warning\n" },
    });
    expect(spawned).toMatchObject([
      { command: "npm", args: ["install", "-g", "gambi@latest"] },
    ]);
  })
);

it.effect("a package manager that fails is a failure of the update", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--manager", "bun"], {
      spawner: spawnerThat(() => ({
        exitCode: 7,
        stderr: "error: no permission to write\n",
      })),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toEqual({
      name: "PackageManagerFailed",
      message: "bun exited with code 7.",
      details: {
        manager: "bun",
        code: 7,
        stdout: "",
        stderr: "error: no permission to write\n",
      },
      exitCode: 1,
    });
  })
);

it.effect("a package manager that is not installed is named in the error", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--manager", "npm"], {
      spawner: spawnerThat(() =>
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description: "spawn npm ENOENT",
        })
      ),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toEqual({
      name: "PackageManagerUnavailable",
      message: "Could not run npm.",
      hint: "Check that npm is installed and on PATH, or choose another with --manager.",
      details: { manager: "npm" },
      exitCode: 1,
    });
  })
);

it.effect(
  "on a terminal it asks before updating and lets the package manager write",
  () =>
    Effect.gen(function* () {
      const spawned: SpawnedCommand[] = [];

      const result = yield* runCommand(["self", "update", "--manager", "npm"], {
        tty: true,
        answers: ["y"],
        spawner: spawnerThat((command) => {
          spawned.push(command);
          return { stdout: "added 1 package\n" };
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.terminal).toContain("npm install -g gambi@latest");
      expect(spawned).toMatchObject([
        {
          command: "npm",
          options: { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
        },
      ]);
      expect(result.stdout).toBe("Update finished.\n");
    })
);

it.effect("answering no cancels the update", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--manager", "npm"], {
      tty: true,
      answers: ["n"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Update cancelled.\n");
    expect(result.stderr).toBe("");
  })
);

it.effect("leaving the question unanswered cancels the update", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--manager", "npm"], {
      tty: true,
      answers: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Update cancelled.\n");
  })
);

it.effect("--yes updates without asking", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(
      ["self", "update", "--manager", "npm", "--yes"],
      { tty: true, answers: ["n"], spawner: spawnerThat(() => ({})) }
    );

    expect(result.exitCode).toBe(0);
    expect(result.terminal).toBe("");
    expect(result.stdout).toBe("Update finished.\n");
  })
);

it.effect("--no-interactive updates without asking, even on a terminal", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(
      ["self", "update", "--manager", "npm", "--no-interactive"],
      { tty: true, answers: ["n"], spawner: spawnerThat(() => ({})) }
    );

    expect(result.exitCode).toBe(0);
    expect(result.terminal).toBe("");
    expect(result.stdout).toBe("Update finished.\n");
  })
);

/** A folder with a standalone `gambi` in it, removed when the test ends. */
const installedBinary = (name = "gambi") =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-self-update-"))),
    (directory) =>
      Effect.promise(() => rm(directory, { force: true, recursive: true }))
  ).pipe(
    Effect.flatMap((directory) =>
      Effect.promise(async () => {
        const binaryPath = join(directory, name);
        await writeFile(binaryPath, "old-binary", { mode: 0o700 });
        return { binaryPath, directory };
      })
    )
  );

/**
 * A release on a loopback port: it serves `assets` by name, answers 404 to
 * the rest, and records the user agent of each request.
 */
const releaseWith = (assets: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const userAgents: (string | null)[] = [];
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) => {
            userAgents.push(request.headers.get("user-agent"));
            const asset = assets[new URL(request.url).pathname.slice(1)];
            return asset === undefined
              ? new Response("Not Found", { status: 404 })
              : new Response(asset, {
                  headers: { "content-type": "application/octet-stream" },
                });
          },
        })
      ),
      (running) => Effect.promise(() => running.stop(true))
    );
    return { url: `http://127.0.0.1:${server.port}`, userAgents };
  });

// Live from here on: each test downloads from a real socket on loopback.

it.live(
  "downloads the new binary and replaces the standalone one in place",
  () =>
    Effect.gen(function* () {
      const { binaryPath, directory } = yield* installedBinary();
      const release = yield* releaseWith({ "gambi-linux-x64": "new-binary" });

      const result = yield* runCommand(["self", "update"], {
        installation: { execPath: binaryPath, platform: "linux", arch: "x64" },
        env: { GAMBI_UPDATE_BASE_URL: release.url },
      });

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data).toMatchObject({
        plan: { kind: "standalone", binaryPath },
        result: { kind: "updated" },
      });
      expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
        "new-binary"
      );
      const mode = (yield* Effect.promise(() => stat(binaryPath))).mode;
      // biome-ignore lint/suspicious/noBitwiseOperators: the permission bits of the file
      expect(mode & 0o777).toBe(0o755);
      expect(yield* Effect.promise(() => readdir(directory))).toEqual([
        "gambi",
      ]);
      expect(release.userAgents).toEqual(["gambi-cli-update"]);
    })
);

it.live("a release without the binary leaves the installed one untouched", () =>
  Effect.gen(function* () {
    const { binaryPath, directory } = yield* installedBinary();
    const release = yield* releaseWith({});

    const result = yield* runCommand(["self", "update"], {
      installation: { execPath: binaryPath, platform: "linux", arch: "x64" },
      env: { GAMBI_UPDATE_BASE_URL: release.url },
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toEqual({
      name: "UpdateDownloadFailed",
      message: `Could not download ${release.url}/gambi-linux-x64 (HTTP 404).`,
      hint: "Check the network and try again.",
      details: { url: `${release.url}/gambi-linux-x64`, status: 404 },
      exitCode: 3,
    });
    expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
      "old-binary"
    );
    expect(yield* Effect.promise(() => readdir(directory))).toEqual(["gambi"]);
  })
);

it.live("a test never reaches a release outside this machine", () =>
  Effect.gen(function* () {
    const { binaryPath } = yield* installedBinary();

    // No GAMBI_UPDATE_BASE_URL: the plan points at GitHub.
    const result = yield* runCommand(["self", "update"], {
      installation: { execPath: binaryPath, platform: "linux", arch: "x64" },
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "UpdateDownloadFailed",
      message:
        "Could not download https://github.com/arthurbm/gambi/releases/latest/download/gambi-linux-x64.",
    });
    expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
      "old-binary"
    );
  })
);

// biome-ignore-start lint/suspicious/noMisplacedAssertion: Biome does not see that `it.live.skipIf(...)` is a test
// Root writes anywhere, so the folder cannot be closed to it.
it.live.skipIf(process.getuid?.() === 0)(
  "a folder gambi may not write to fails the update and keeps the binary",
  () =>
    Effect.gen(function* () {
      const { binaryPath, directory } = yield* installedBinary();
      const release = yield* releaseWith({ "gambi-linux-x64": "new-binary" });
      yield* Effect.acquireRelease(
        Effect.promise(() => chmod(directory, 0o500)),
        () => Effect.promise(() => chmod(directory, 0o700))
      );

      const result = yield* runCommand(["self", "update"], {
        installation: { execPath: binaryPath, platform: "linux", arch: "x64" },
        env: { GAMBI_UPDATE_BASE_URL: release.url },
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error).toEqual({
        name: "BinaryReplaceFailed",
        message: `Could not replace ${binaryPath}.`,
        hint: "Check that you may write to its folder.",
        details: { binaryPath },
        exitCode: 1,
      });
      expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
        "old-binary"
      );
    })
);
// biome-ignore-end lint/suspicious/noMisplacedAssertion: see above

it.live(
  "a download cut in the middle keeps the installed binary and leaves no temporary file",
  () =>
    Effect.gen(function* () {
      const { binaryPath, directory } = yield* installedBinary();
      // Answers with the head of a 1000-byte body, sends 9 bytes of it and
      // closes the connection.
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.listen({
            hostname: "127.0.0.1",
            port: 0,
            socket: {
              data(socket) {
                socket.end(
                  "HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ncontent-length: 1000\r\n\r\nhalf of a"
                );
              },
            },
          })
        ),
        (listening) => Effect.sync(() => listening.stop(true))
      );

      const result = yield* runCommand(["self", "update"], {
        installation: { execPath: binaryPath, platform: "linux", arch: "x64" },
        env: { GAMBI_UPDATE_BASE_URL: `http://127.0.0.1:${server.port}` },
      });

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr).error.name).toBe("UpdateDownloadFailed");
      expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
        "old-binary"
      );
      expect(yield* Effect.promise(() => readdir(directory))).toEqual([
        "gambi",
      ]);
    })
);

const WINDOWS = { platform: "win32", arch: "x64" } as const;

it.live(
  "on Windows the running binary is replaced by a script that outlives gambi",
  () =>
    Effect.gen(function* () {
      const { binaryPath, directory } = yield* installedBinary("gambi.exe");
      const release = yield* releaseWith({
        "gambi-windows-x64.exe": "new-binary",
      });
      const spawned: SpawnedCommand[] = [];

      const result = yield* runCommand(["self", "update"], {
        installation: { ...WINDOWS, execPath: binaryPath, pid: 4242 },
        env: { GAMBI_UPDATE_BASE_URL: release.url },
        spawner: spawnerThat((command) => {
          spawned.push(command);
          return {};
        }),
      });

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data).toMatchObject({
        plan: { kind: "standalone", platform: "win32", binaryPath },
        result: { kind: "scheduled" },
      });

      // Windows does not let a running executable be replaced: the new one
      // waits beside it, and a detached PowerShell script moves it once
      // this process is gone.
      const downloadedPath = join(directory, ".gambi.exe.tmp-4242");
      const scriptPath = join(directory, ".gambi.exe.update-4242.ps1");
      expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
        "old-binary"
      );
      expect(
        yield* Effect.promise(() => readFile(downloadedPath, "utf8"))
      ).toBe("new-binary");
      expect(spawned).toMatchObject([
        {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-ParentPid",
            "4242",
            "-SourcePath",
            downloadedPath,
            "-DestinationPath",
            binaryPath,
          ],
          options: { detached: true, stdout: "ignore", windowsHide: true },
          keptAlive: true,
        },
      ]);
      expect(
        yield* Effect.promise(() => readFile(scriptPath, "utf8"))
      ).toContain("Move-Item -Force $SourcePath $DestinationPath");
    })
);

it.live(
  "on Windows a script that cannot start leaves the binary and no temporary file",
  () =>
    Effect.gen(function* () {
      const { binaryPath, directory } = yield* installedBinary("gambi.exe");
      const release = yield* releaseWith({
        "gambi-windows-x64.exe": "new-binary",
      });

      const result = yield* runCommand(["self", "update"], {
        installation: { ...WINDOWS, execPath: binaryPath },
        env: { GAMBI_UPDATE_BASE_URL: release.url },
        spawner: spawnerThat(() =>
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            description: "spawn powershell.exe ENOENT",
          })
        ),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "UpdateNotScheduled",
        message:
          "Could not start the PowerShell script that finishes the update.",
        exitCode: 1,
      });
      expect(yield* Effect.promise(() => readFile(binaryPath, "utf8"))).toBe(
        "old-binary"
      );
      expect(yield* Effect.promise(() => readdir(directory))).toEqual([
        "gambi.exe",
      ]);
    })
);

it.effect("a test that does not script the subprocess starts none", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["self", "update", "--manager", "npm"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "The command spawned `npm install -g gambi@latest`, and the test did not say what it does."
    );
  })
);
