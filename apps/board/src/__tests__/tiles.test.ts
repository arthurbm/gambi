import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type BoardRuntime, createBoardApp } from "../app";
import type { AppRouterClient } from "../orpc/routers";

const runtimes: BoardRuntime[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function createRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "gambi-board-tiles-"));
  temporaryDirectories.push(directory);
  const runtime = await createBoardApp({
    adminToken: "test-admin-token",
    databaseUrl: `file:${join(directory, "board.db")}`,
    harness: false,
    onError: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

function rpcClient(runtime: BoardRuntime, admin = false): AppRouterClient {
  const link = new RPCLink({
    url: "http://board.test/rpc",
    headers: admin ? { "x-board-admin-token": "test-admin-token" } : {},
    fetch: async (input, init) => runtime.app.fetch(new Request(input, init)),
  });
  return createORPCClient(link);
}

function artifactFiles(input: {
  name: string;
  description?: string;
  html?: string;
  readme?: string;
  station?: { name: string; x: number; z: number } | null;
}) {
  return [
    {
      path: "manifest.json",
      encoding: "utf8" as const,
      content: JSON.stringify({
        name: input.name,
        description: input.description ?? `${input.name} faz algo útil.`,
        station: input.station ?? null,
        palette: {
          sky: "#dce8e3",
          ground: "#d8c59e",
          accent: "#b9503f",
        },
      }),
    },
    {
      path: "index.html",
      encoding: "utf8" as const,
      content:
        input.html ??
        `<!doctype html><html><head><title>${input.name}</title></head><body>${input.name}</body></html>`,
    },
    {
      path: "README.md",
      encoding: "utf8" as const,
      content:
        input.readme ??
        `# ${input.name}\n\n${input.description ?? "Serviço de bairro."}`,
    },
  ];
}

async function prepareSquad(
  runtime: BoardRuntime,
  input: { personId: string; personName: string; squadId: string }
) {
  const client = rpcClient(runtime);
  const participantId = `board-person-${input.personId}`;
  await client.people.join({
    personId: input.personId,
    name: input.personName,
  });
  await client.squads.join({
    personId: input.personId,
    squadId: input.squadId,
  });
  await runtime.repository.reconcileHarnessParticipants([
    {
      id: participantId,
      nickname: input.personName,
      model: "fixture-model",
      harness: { id: "fake", model: "fixture-model" },
      connection: { connected: true },
    },
  ]);
  await client.harnesses.assign({
    actorPersonId: input.personId,
    squadId: input.squadId,
    participantId,
  });
  await client.harnesses.electSteerer({
    actorPersonId: input.personId,
    squadId: input.squadId,
    personId: input.personId,
  });
  const view = await runtime.repository.getSquadHarness(input.squadId);
  const session = await runtime.repository.ensureHarnessSession({
    squadId: input.squadId,
    roundId: view.roundId,
    participantId,
  });
  return { participantId, sessionId: session.sessionId };
}

describe("tile versions and publication", () => {
  test("keeps board versions monotonic when a source counter resets", async () => {
    const runtime = await createRuntime();
    await rpcClient(runtime, true).phase.advance();
    const binding = await prepareSquad(runtime, {
      personId: "person-tile-reset",
      personName: "Bia",
      squadId: "squad-1",
    });

    const first = await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 1,
      reason: "watch",
      files: artifactFiles({ name: "Oficina solar" }),
    });
    const duplicate = await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 1,
      reason: "watch",
      files: artifactFiles({ name: "Oficina solar" }),
    });
    const second = await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 2,
      reason: "watch",
      files: artifactFiles({ name: "Oficina das águas" }),
    });
    const reset = await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 1,
      reason: "watch",
      files: artifactFiles({ name: "Oficina reconstruída" }),
    });

    expect(first).toMatchObject({ boardVersion: 1, created: true });
    expect(duplicate).toMatchObject({ boardVersion: 1, created: false });
    expect(second).toMatchObject({ boardVersion: 2, created: true });
    expect(reset).toMatchObject({ boardVersion: 3, created: true });
    expect(
      (await runtime.repository.listTileVersions("squad-1")).map((tile) => ({
        boardVersion: tile.boardVersion,
        sourceVersion: tile.sourceVersion,
      }))
    ).toEqual([
      { boardVersion: 3, sourceVersion: 1 },
      { boardVersion: 2, sourceVersion: 2 },
      { boardVersion: 1, sourceVersion: 1 },
    ]);
  });

  test("publishes an accepted artifact, waits when necessary, and preserves live on invalid input", async () => {
    const runtime = await createRuntime();
    const publicClient = rpcClient(runtime);
    await rpcClient(runtime, true).phase.advance();
    const binding = await prepareSquad(runtime, {
      personId: "person-tile-accept",
      personName: "Lia",
      squadId: "squad-1",
    });

    const pending = await publicClient.tiles.acceptLatest({
      actorPersonId: "person-tile-accept",
      squadId: "squad-1",
    });
    expect(pending).toMatchObject({ awaitingArtifact: true });

    await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 1,
      reason: "final",
      files: artifactFiles({
        name: "Biblioteca de trocas",
        station: { name: "Estação Livro", x: 2, z: -1 },
      }),
    });
    expect((await publicClient.board.state()).tiles[0]).toMatchObject({
      boardVersion: 1,
      isLive: true,
      manifest: {
        name: "Biblioteca de trocas",
        station: { name: "Estação Livro", x: 2, z: -1 },
      },
    });

    const invalid = await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 2,
      reason: "watch",
      files: artifactFiles({ name: "Sem README" }).filter(
        (file) => file.path !== "README.md"
      ),
    });
    expect(invalid).toMatchObject({ boardVersion: 2, valid: false });
    expect((await publicClient.board.state()).tiles[0]?.boardVersion).toBe(1);
    await expect(
      rpcClient(runtime, true).tiles.publish({
        squadId: "squad-1",
        boardVersion: 2,
        actorName: "Facilitadora",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("preserves malformed and oversized artifacts as immutable invalid versions", async () => {
    const runtime = await createRuntime();
    await rpcClient(runtime, true).phase.advance();
    const binding = await prepareSquad(runtime, {
      personId: "person-tile-invalid",
      personName: "Nina",
      squadId: "squad-1",
    });

    const malformed = artifactFiles({ name: "Manifesto quebrado" });
    const manifest = malformed.find((file) => file.path === "manifest.json");
    if (!manifest) {
      throw new Error("missing manifest fixture");
    }
    manifest.content = "{not-json";
    await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 1,
      reason: "watch",
      files: malformed,
    });
    await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 2,
      reason: "watch",
      files: artifactFiles({
        name: "README grande",
        readme: "x".repeat(512 * 1024 + 1),
      }),
    });

    const versions = await runtime.repository.listTileVersions("squad-1");
    expect(versions).toHaveLength(2);
    expect(versions).toEqual([
      expect.objectContaining({
        boardVersion: 2,
        valid: false,
        validationError: expect.stringContaining("README.md excede 512 KiB"),
      }),
      expect.objectContaining({
        boardVersion: 1,
        valid: false,
        validationError: expect.stringContaining(
          "manifest.json não segue o contrato"
        ),
      }),
    ]);
    await expect(
      runtime.client.execute("UPDATE tiles SET author_name = 'mutated'")
    ).rejects.toThrow("tiles are immutable");
    await expect(runtime.client.execute("DELETE FROM tiles")).rejects.toThrow(
      "tiles are immutable"
    );
  });

  test("serves three distinct sandboxed tiles and lets admin override a live version", async () => {
    const runtime = await createRuntime();
    const publicClient = rpcClient(runtime);
    const admin = rpcClient(runtime, true);
    await admin.phase.advance();
    const squads: Awaited<ReturnType<typeof prepareSquad>>[] = [];
    for (const ordinal of [1, 2, 3]) {
      squads.push(
        await prepareSquad(runtime, {
          personId: `person-tile-${ordinal}`,
          personName: `Pessoa ${ordinal}`,
          squadId: `squad-${ordinal}`,
        })
      );
    }
    for (const [index, binding] of squads.entries()) {
      await runtime.repository.ingestTileArtifact({
        ...binding,
        sourceVersion: 1,
        reason: "final",
        files: artifactFiles({
          name: `Bairro ${index + 1}`,
          readme:
            index === 2
              ? "# Bairro quebrado\n\n<img src=x onerror=alert(1)>"
              : undefined,
          html:
            index === 2
              ? "<!doctype html><html><head></head><body><script>throw new Error('broken fixture')</script></body></html>"
              : `<!doctype html><html><head></head><body>Bairro ${index + 1}</body></html>`,
        }),
      });
      await publicClient.tiles.acceptLatest({
        actorPersonId: `person-tile-${index + 1}`,
        squadId: `squad-${index + 1}`,
      });
    }

    expect((await publicClient.board.state()).tiles).toHaveLength(3);
    const brokenResponse = await runtime.app.request(
      "/tiles/squad-3/live/index.html"
    );
    const brokenHtml = await brokenResponse.text();
    expect(brokenResponse.status).toBe(200);
    expect(brokenResponse.headers.get("content-type")).toContain("text/html");
    expect(brokenResponse.headers.get("x-content-type-options")).toBe(
      "nosniff"
    );
    expect(brokenResponse.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts"
    );
    expect(brokenHtml).toContain("data-gambi-tile-bridge");
    expect(brokenHtml).toContain("broken fixture");
    expect(brokenHtml).not.toContain("onerror=alert");
    expect(brokenHtml.indexOf("data-gambi-tile-bridge")).toBeLessThan(
      brokenHtml.indexOf("broken fixture")
    );

    const binding = squads[0];
    if (!binding) {
      throw new Error("missing squad fixture");
    }
    await runtime.repository.ingestTileArtifact({
      ...binding,
      sourceVersion: 2,
      reason: "final",
      files: artifactFiles({ name: "Bairro 1 · revisão" }),
    });
    expect(
      (await publicClient.tiles.versions({ squadId: "squad-1" })).find(
        (tile) => tile.isLive
      )?.boardVersion
    ).toBe(1);
    const override = await admin.tiles.publish({
      squadId: "squad-1",
      boardVersion: 2,
      actorName: "Facilitadora",
    });
    expect(override).toMatchObject({ boardVersion: 2 });
    expect(
      (await publicClient.tiles.versions({ squadId: "squad-1" })).find(
        (tile) => tile.isLive
      )
    ).toMatchObject({
      boardVersion: 2,
      publicationKind: "admin_override",
      publishedByName: "Facilitadora",
    });
  });
});
