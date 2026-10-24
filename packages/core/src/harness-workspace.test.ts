import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalDirectoryWorkspace,
  defaultWorkspacePath,
} from "./harness-workspace";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const context = {
  roomCode: "ROOM42",
  participantId: "ana",
  harness: "opencode",
  model: "alpha",
};

test("the default workspace holds only participant metadata", async () => {
  const gambiHome = await temporaryDirectory("gambi-workspace-default-");

  const workspace = await createLocalDirectoryWorkspace({ gambiHome }).prepare(
    context
  );

  expect(workspace.path).toBe(defaultWorkspacePath(context, gambiHome));
  expect(await readdir(workspace.path)).toEqual([".gambi.json"]);
  expect(await Bun.file(join(workspace.path, ".gambi.json")).json()).toEqual(
    context
  );
  expect(await workspace.collect()).toEqual([]);
});

test("a chosen folder keeps its files and publishes them as the artifact", async () => {
  const folder = await temporaryDirectory("gambi-workspace-chosen-");
  await Bun.write(join(folder, "index.html"), "<h1>mine</h1>\n");
  await Bun.write(join(folder, "node_modules", "dep", "index.js"), "ignored");
  await Bun.write(join(folder, "assets", "pixel.bin"), new Uint8Array([255]));

  const workspace = await createLocalDirectoryWorkspace({
    path: folder,
  }).prepare(context);

  expect(workspace.path).toBe(folder);
  expect(await workspace.collect()).toEqual([
    { path: "assets/pixel.bin", content: "/w==", encoding: "base64" },
    { path: "index.html", content: "<h1>mine</h1>\n", encoding: "utf8" },
  ]);
});

test("unsafe room and participant ids cannot escape the workspace root", () => {
  const path = defaultWorkspacePath(
    { roomCode: "..", participantId: "../x" },
    "/gambi"
  );

  expect(path).toBe(join("/gambi", "workspaces", "%2E%2E", "..%2Fx"));
});

test("a composed workspace can seed starter content", async () => {
  const gambiHome = await temporaryDirectory("gambi-workspace-seeded-");
  const local = createLocalDirectoryWorkspace({ gambiHome });

  const workspace = await {
    async prepare(seedContext: typeof context) {
      const prepared = await local.prepare(seedContext);
      await Bun.write(join(prepared.path, "README.md"), "# starter\n");
      return prepared;
    },
  }.prepare(context);

  expect(await workspace.collect()).toEqual([
    { path: "README.md", content: "# starter\n", encoding: "utf8" },
  ]);
});
