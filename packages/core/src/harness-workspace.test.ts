import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHarnessWorkspace,
  deriveHarnessTilePalette,
} from "./harness-workspace";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

test("creates a fixed-fit city starter with a deterministic harness palette", async () => {
  const gambiHome = await mkdtemp(join(tmpdir(), "gambi-workspace-starter-"));
  temporaryDirectories.push(gambiHome);
  const palette = deriveHarnessTilePalette("OpenCode", "Alpha");
  expect(palette).toEqual(deriveHarnessTilePalette(" opencode ", " alpha "));
  expect(palette).not.toEqual(deriveHarnessTilePalette("codex", "gpt-5.6"));

  const workspace = await createHarnessWorkspace({
    gambiHome,
    roomCode: "CITY76",
    participantId: "starter-fixture",
    harness: "OpenCode",
    model: "Alpha",
  });
  const index = await Bun.file(join(workspace, "index.html")).text();
  const readme = await Bun.file(join(workspace, "README.md")).text();
  const manifest = await Bun.file(join(workspace, "manifest.json")).json();

  expect(index).toContain(
    "new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100)"
  );
  expect(index).toContain("camera.position.set(8, 8, 8)");
  expect(index).toContain("new THREE.BoxGeometry(10, 0.25, 10)");
  expect(index).toContain("Resize only the renderer");
  expect(index).toContain(`--accent: ${palette.accent}`);
  expect(readme).toContain("x/z -4.5 through 4.5");
  expect(readme).toContain("python3 -m http.server 4173");
  expect(readme).toContain("status bridge");
  expect(manifest).toEqual({
    name: "New neighborhood",
    description: "Describe what this neighborhood does.",
    station: null,
    palette,
  });
});
