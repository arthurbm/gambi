/**
 * The Workspace seam and its default, a local folder, against real files.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { layer } from "@gambi/testing/effect";
import {
  type Cause,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Queue,
  Stream,
} from "effect";
import { type LocalDirectoryOptions, Workspace } from "./workspace.ts";

const who = {
  roomCode: "ROOM42",
  participantId: "ana",
  harness: "opencode",
  model: "alpha",
} as const;

/** A new empty folder, removed when the test ends. */
const temporaryFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "gambi-workspace-" })
);

/** The default Workspace, prepared, until the test ends. */
const prepare = (options: Partial<LocalDirectoryOptions> = {}) =>
  Layer.build(Workspace.layerLocalDirectory({ ...who, ...options })).pipe(
    Effect.map((context) => Context.get(context, Workspace))
  );

// Real files, on the real clock.
layer(BunServices.layer, { excludeTestServices: true })(
  "the Workspace of a harness participant",
  (it) => {
    it.effect(
      "the default is a local folder of the participant that holds only its metadata",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const gambiHome = yield* temporaryFolder;

          const workspace = yield* prepare({ gambiHome });

          expect(workspace.path).toBe(
            path.join(gambiHome, "workspaces", "ROOM42", "ana")
          );
          expect(yield* fs.readDirectory(workspace.path)).toEqual([
            ".gambi.json",
          ]);
          expect(
            JSON.parse(
              yield* fs.readFileString(path.join(workspace.path, ".gambi.json"))
            )
          ).toEqual(who);
          expect(yield* workspace.collect).toEqual([]);
        })
    );

    it.effect(
      "a folder the participant chose keeps its files, and they are what is collected: text in utf8, the rest in base64, without .git and node_modules",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* temporaryFolder;
          const write = (file: string, content: string | Uint8Array) =>
            fs
              .makeDirectory(path.dirname(path.join(folder, file)), {
                recursive: true,
              })
              .pipe(
                Effect.andThen(
                  typeof content === "string"
                    ? fs.writeFileString(path.join(folder, file), content)
                    : fs.writeFile(path.join(folder, file), content)
                )
              );
          yield* write("index.html", "<h1>frevo é meu</h1>\n");
          yield* write("assets/pixel.bin", new Uint8Array([255]));
          yield* write("assets/deep/notes.txt", "");
          yield* write("node_modules/dep/index.js", "ignored");
          yield* write("packages/app/node_modules/dep/index.js", "ignored");
          yield* write(".git/HEAD", "ref: refs/heads/main\n");

          const workspace = yield* prepare({ path: folder });

          expect(workspace.path).toBe(folder);
          expect(yield* workspace.collect).toEqual([
            { path: "assets/deep/notes.txt", encoding: "utf8", content: "" },
            { path: "assets/pixel.bin", encoding: "base64", content: "/w==" },
            {
              path: "index.html",
              encoding: "utf8",
              content: "<h1>frevo é meu</h1>\n",
            },
          ]);
          expect(
            yield* fs.readFileString(path.join(folder, "index.html"))
          ).toBe("<h1>frevo é meu</h1>\n");
        })
    );

    it.effect(
      "what is collected never leaves the folder: a link to somewhere else is not followed",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* temporaryFolder;
          const elsewhere = yield* temporaryFolder;
          yield* fs.writeFileString(path.join(elsewhere, "secret.txt"), "key");
          yield* fs.symlink(
            path.join(elsewhere, "secret.txt"),
            path.join(folder, "linked.txt")
          );
          yield* fs.symlink(elsewhere, path.join(folder, "linked"));
          yield* fs.writeFileString(path.join(folder, "mine.txt"), "mine");

          const workspace = yield* prepare({ path: folder });

          expect(yield* workspace.collect).toEqual([
            { path: "mine.txt", encoding: "utf8", content: "mine" },
          ]);
        })
    );

    it.effect(
      "a folder that holds more than one artifact can carry is not collected at all",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* temporaryFolder;
          yield* fs.writeFileString(path.join(folder, "a.txt"), "123456");
          yield* fs.writeFile(
            path.join(folder, "b.bin"),
            new Uint8Array([255, 255, 255, 255, 255, 255])
          );

          const fits = yield* prepare({ path: folder, maxArtifactBytes: 12 });
          const tooSmall = yield* prepare({
            path: folder,
            maxArtifactBytes: 11,
          });

          expect(yield* fits.collect).toHaveLength(2);
          const failure = yield* Effect.flip(tooSmall.collect);
          expect(failure._tag).toBe("WorkspaceTooLarge");
          expect(failure.message).toBe(
            `The Workspace at '${folder}' holds more than the 11 bytes one artifact can carry.`
          );
        })
    );

    it.effect(
      "a change anywhere in the folder is noticed, in a subfolder that did not exist when the Workspace was prepared too",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* temporaryFolder;
          const workspace = yield* prepare({ path: folder });

          yield* fs.makeDirectory(path.join(folder, "src", "pages"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(folder, "src", "pages", "index.html"),
            "<h1>oi</h1>"
          );

          // It waits for the change; nothing here sleeps.
          yield* Stream.runHead(workspace.changes);
          expect(yield* workspace.collect).toEqual([
            {
              path: "src/pages/index.html",
              encoding: "utf8",
              content: "<h1>oi</h1>",
            },
          ]);
        })
    );

    it.effect(
      "a change to what is never collected is not a change of the Workspace",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const folder = yield* temporaryFolder;
          // What the platform reports is decided here, so that the test
          // knows exactly which changes were reported and in which order.
          const reported = yield* Queue.unbounded<
            FileSystem.WatchEvent,
            Cause.Done
          >();
          const workspace = yield* Layer.build(
            Workspace.layerLocalDirectory({ ...who, path: folder }).pipe(
              Layer.provide(
                Layer.succeed(FileSystem.FileSystem, {
                  ...fs,
                  watch: (_path, options) =>
                    Stream.suspend(() => {
                      options?.onReady?.();
                      return Stream.fromQueue(reported);
                    }),
                })
              )
            )
          ).pipe(Effect.map((context) => Context.get(context, Workspace)));

          yield* Queue.offerAll(reported, [
            { _tag: "Update", path: ".gambi.json" },
            { _tag: "Create", path: "node_modules/dep/index.js" },
            { _tag: "Update", path: "packages/app/node_modules/dep/a.js" },
            { _tag: "Update", path: ".git/index" },
            { _tag: "Update", path: "src/index.ts" },
            { _tag: "Remove", path: "src/old.ts" },
          ]);
          yield* Queue.end(reported);

          const noticed = yield* Stream.runCollect(workspace.changes);
          expect(noticed).toHaveLength(2);
        })
    );

    it.effect(
      "a folder that cannot be observed is still prepared and collected; observing it is what fails",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* temporaryFolder;
          yield* fs.writeFileString(path.join(folder, "a.txt"), "a");
          const workspace = yield* Layer.build(
            Workspace.layerLocalDirectory({ ...who, path: folder }).pipe(
              Layer.provide(
                Layer.succeed(FileSystem.FileSystem, {
                  ...fs,
                  watch: (watched) =>
                    Stream.fail(
                      PlatformError.systemError({
                        _tag: "Unknown",
                        module: "FileSystem",
                        method: "watch",
                        pathOrDescriptor: watched,
                        description: "no space left for watches",
                      })
                    ),
                })
              )
            )
          ).pipe(Effect.map((context) => Context.get(context, Workspace)));

          const failure = yield* Effect.flip(
            Stream.runDrain(workspace.changes)
          );

          expect(failure._tag).toBe("WorkspaceFailed");
          expect(failure.message).toBe(
            `Could not observe the Workspace at '${folder}'.`
          );
          expect(yield* workspace.collect).toEqual([
            { path: "a.txt", encoding: "utf8", content: "a" },
          ]);
        })
    );

    it.effect(
      "a room code or a participant id cannot name a folder outside the workspaces of gambiHome",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const gambiHome = yield* temporaryFolder;

          const workspace = yield* prepare({
            gambiHome,
            roomCode: "..",
            participantId: "../x",
          });

          expect(workspace.path).toBe(
            path.join(gambiHome, "workspaces", "%2E%2E", "..%2Fx")
          );
        })
    );
  }
);
