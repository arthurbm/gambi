import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type BoardRuntime, createBoardApp } from "../app";
import type { BoardHarnessRuntime } from "../harness-runtime";
import type { AppRouterClient } from "../orpc/routers";

const runtimes: BoardRuntime[] = [];
const directories: string[] = [];
const servers: Bun.Server<unknown>[] = [];
const TRAILING_SLASH = /\/$/;

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

function rpcClient(runtime: BoardRuntime, admin = false): AppRouterClient {
  const link = new RPCLink({
    url: "http://board.test/rpc",
    headers: admin ? { "x-board-admin-token": "test-admin-token" } : {},
    fetch: async (input, init) => runtime.app.fetch(new Request(input, init)),
  });
  return createORPCClient(link);
}

function fakeHarness(prompts: string[] = []): BoardHarnessRuntime {
  return {
    close: () => Promise.resolve(),
    prompt: async () => ({ sessionId: "unused", revision: 0 }),
    promptSession: (input) => {
      prompts.push(input.prompt);
      return Promise.resolve(`Resposta do fake: ${input.prompt}`);
    },
    reconcileHosted: () => Promise.resolve(),
    subscribeArtifacts: () => () => undefined,
  };
}

function tileFiles(station = { name: "Águas", x: 2, z: -1 }) {
  return [
    {
      path: "manifest.json",
      encoding: "utf8" as const,
      content: JSON.stringify({
        name: "Estação das águas",
        description: "Distribui água e sombra durante a crise.",
        station,
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
      content: "<!doctype html><html><body>Estação das águas</body></html>",
    },
    {
      path: "README.md",
      encoding: "utf8" as const,
      content: "# Estação das águas\n\nDistribui água e sombra.",
    },
  ];
}

async function configureThreeSquads(runtime: BoardRuntime) {
  await rpcClient(runtime, true).admin.configure({
    theme: "Cidade da crise",
    squadCount: 3,
    hostedHarnessCount: 0,
  });
}

async function registerSquadOne(runtime: BoardRuntime) {
  const client = rpcClient(runtime);
  await client.people.join({ personId: "person-steerer", name: "Bia" });
  await client.squads.join({
    personId: "person-steerer",
    squadId: "squad-1",
  });
  await runtime.repository.reconcileHarnessParticipants([
    {
      id: "fake-squad-1",
      nickname: "Fake do squad 1",
      model: "fake-event",
      harness: { id: "fake", hosted: true, model: "fake-event" },
      connection: { connected: true },
    },
  ]);
  await client.harnesses.claimHosted({
    personId: "person-steerer",
    participantId: "fake-squad-1",
  });
  return client;
}

async function prepareRoundSquad(runtime: BoardRuntime) {
  const client = rpcClient(runtime);
  await client.harnesses.assign({
    actorPersonId: "person-steerer",
    squadId: "squad-1",
    participantId: "fake-squad-1",
  });
  await client.harnesses.electSteerer({
    actorPersonId: "person-steerer",
    squadId: "squad-1",
    personId: "person-steerer",
  });
  return client;
}

describe("rounds 4 to 6 and finale", () => {
  test("persists the crisis ring, typed dispatch, metro tile, and finale aggregates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gambi-coordination-"));
    directories.push(directory);
    const databaseUrl = `file:${join(directory, "board.db")}`;
    const prompts: string[] = [];
    const runtime = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: false,
      harnessRuntime: fakeHarness(prompts),
      onError: () => undefined,
    });
    runtimes.push(runtime);
    await configureThreeSquads(runtime);

    const crisis = await rpcClient(runtime).workflow.get({
      roundId: "round-5",
    });
    expect(
      crisis.challenges.map((challenge) => ({
        squadId: challenge.squadId,
        neighbor: challenge.dependsOnSquad?.id,
      }))
    ).toEqual([
      { squadId: "squad-1", neighbor: "squad-2" },
      { squadId: "squad-2", neighbor: "squad-3" },
      { squadId: "squad-3", neighbor: "squad-1" },
    ]);
    expect(crisis.challenges[0]?.objective).toContain(
      crisis.challenges[0]?.dependsOnSquad?.name ?? "missing neighbor"
    );

    const client = await registerSquadOne(runtime);
    const admin = rpcClient(runtime, true);
    for (let index = 0; index < 5; index += 1) {
      await admin.phase.advance();
    }
    await prepareRoundSquad(runtime);
    await admin.orchestrator.selectSteerer({
      actorPersonId: "person-steerer",
      personId: "person-steerer",
    });
    await client.orchestrator.publish({ actorPersonId: "person-steerer" });
    const challenge = (await client.workflow.get({})).challenges[0];
    await client.drafts.create({
      actorPersonId: "person-steerer",
      challengeId: challenge?.id ?? "",
      content: "Abrir uma cisterna compartilhada",
    });
    await client.drafts.requestFromHarness({
      actorPersonId: "person-steerer",
      challengeId: challenge?.id ?? "",
      request: "Proponha a ligação da cisterna com o vizinho",
    });
    await client.decisions.record({
      actorPersonId: "person-steerer",
      challengeId: challenge?.id ?? "",
      build: "Cisterna na divisa",
      cut: "Palco temporário",
      reason: "A água atende os dois bairros",
      consideredDraftIds: [challenge?.drafts[0]?.id ?? ""],
    });
    const dispatch = await client.dispatches.send({
      actorPersonId: "person-steerer",
      challengeId: challenge?.id ?? "",
      expectedOutput: "Lote atualizado com a cisterna",
      constraints: ["Preservar a estação"],
    });
    expect(prompts.at(-1)).toContain(
      `Dependência de crise: coordene a solução com o squad ${challenge?.dependsOnSquad?.name}.`
    );
    await client.reviews.record({
      actorPersonId: "person-steerer",
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Mostre a ligação com o bairro vizinho",
    });

    const session = await runtime.repository.getHarnessSessionById(
      dispatch.sessionId
    );
    await runtime.repository.ingestTileArtifact({
      participantId: "fake-squad-1",
      sessionId: session?.sessionId ?? "",
      sourceVersion: 1,
      reason: "final",
      files: tileFiles(),
    });
    await client.tiles.acceptLatest({
      actorPersonId: "person-steerer",
      squadId: "squad-1",
    });
    await runtime.repository.ingestTileArtifact({
      participantId: "fake-squad-1",
      sessionId: session?.sessionId ?? "",
      sourceVersion: 2,
      reason: "watch",
      files: tileFiles({ name: "Águas Norte", x: -3, z: 1 }),
    });
    expect((await client.board.state()).tiles[0]?.manifest?.station).toEqual({
      name: "Águas",
      x: 2,
      z: -1,
    });
    await admin.tiles.publish({
      squadId: "squad-1",
      boardVersion: 2,
      actorName: "Facilitadora",
    });
    expect((await client.board.state()).tiles[0]?.manifest?.station).toEqual({
      name: "Águas Norte",
      x: -3,
      z: 1,
    });

    const finale = await client.workflow.finale();
    expect(finale.squads[0]).toMatchObject({
      draftCounts: { human: 1, harness: 1 },
      returnedReviews: 1,
      liveTile: {
        boardVersion: 2,
        manifest: { station: { name: "Águas Norte", x: -3, z: 1 } },
      },
    });
    expect(finale.squads[0]?.decisions[0]).toMatchObject({
      roundNumber: 5,
      build: "Cisterna na divisa",
    });

    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    const restarted = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: false,
      harnessRuntime: fakeHarness(),
      onError: () => undefined,
    });
    runtimes.push(restarted);
    const recovered = await rpcClient(restarted).workflow.finale();
    const recoveredCrisis = await rpcClient(restarted).workflow.get({
      roundId: "round-5",
    });
    expect(recovered).toEqual(finale);
    expect(recoveredCrisis.challenges[0]?.dependsOnSquad).toEqual(
      crisis.challenges[0]?.dependsOnSquad
    );
  });

  test("swaps only in round 6 and recovers the model while the fake hub stays alive", async () => {
    let modelRequests = 0;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname.endsWith("/v1/models")) {
          modelRequests += 1;
          return Response.json({
            object: "list",
            data: [
              {
                id: "model-a",
                object: "model",
                created: 0,
                owned_by: "fixture",
                gambi: { nickname: "Modelo A", model: "fixture-a" },
              },
              {
                id: "model-b",
                object: "model",
                created: 0,
                owned_by: "fixture",
                gambi: { nickname: "Modelo B", model: "fixture-b" },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const directory = await mkdtemp(join(tmpdir(), "gambi-model-swap-"));
    directories.push(directory);
    const databaseUrl = `file:${join(directory, "board.db")}`;
    const sharedFakeHarness = fakeHarness();
    const createRuntime = () =>
      createBoardApp({
        adminToken: "test-admin-token",
        databaseUrl,
        harness: {
          hubUrl: server.url.toString().replace(TRAILING_SLASH, ""),
          roomCode: "FAKE01",
          hostedHarnessId: "fake",
        },
        harnessRuntime: sharedFakeHarness,
        onError: () => undefined,
      });
    const runtime = await createRuntime();
    runtimes.push(runtime);
    await configureThreeSquads(runtime);
    const client = await registerSquadOne(runtime);
    const admin = rpcClient(runtime, true);
    await admin.phase.advance();
    await prepareRoundSquad(runtime);
    await admin.orchestrator.selectSteerer({
      actorPersonId: "person-steerer",
      personId: "person-steerer",
    });
    await client.orchestrator.publish({ actorPersonId: "person-steerer" });
    const roundOne = (await client.workflow.get({})).challenges[0];
    await client.decisions.record({
      actorPersonId: "person-steerer",
      challengeId: roundOne?.id ?? "",
      build: "Praça sombreada",
      cut: "Muros altos",
      reason: "Manter o acesso livre",
      consideredDraftIds: [roundOne?.drafts[0]?.id ?? ""],
    });
    await expect(
      client.orchestrator.swapModel({
        actorPersonId: "person-steerer",
        participantId: "model-a",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let index = 0; index < 5; index += 1) {
      await admin.phase.advance();
    }
    await client.people.join({ personId: "person-observer", name: "Lia" });
    await admin.orchestrator.selectSteerer({
      actorPersonId: "person-steerer",
      personId: "person-steerer",
    });

    expect(
      (await client.orchestrator.models()).map((model) => model.id)
    ).toEqual(["model-a", "model-b"]);
    await expect(
      client.orchestrator.swapModel({
        actorPersonId: "person-observer",
        participantId: "model-a",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.orchestrator.swapModel({
        actorPersonId: "person-steerer",
        participantId: "missing-model",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const swapped = await client.orchestrator.swapModel({
      actorPersonId: "person-steerer",
      participantId: "model-a",
    });
    const handoff = JSON.parse(swapped.handoff) as {
      squads: unknown[];
      decisions: Array<{ build: string }>;
      pending: unknown[];
    };
    expect(handoff.squads).toHaveLength(3);
    expect(handoff.decisions[0]?.build).toBe("Praça sombreada");
    expect(handoff.pending).toHaveLength(3);
    await expect(
      client.orchestrator.swapModel({
        actorPersonId: "person-steerer",
        participantId: "model-a",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    const restarted = await createRuntime();
    runtimes.push(restarted);
    const recovered = await rpcClient(restarted).workflow.get({
      roundId: "round-6",
    });
    expect(recovered.orchestratorModel).toMatchObject({
      participantId: "model-a",
      modelLabel: "Modelo A · fixture-a",
      handoff: swapped.handoff,
      consumedAt: null,
    });
    expect(await rpcClient(restarted).orchestrator.models()).toHaveLength(2);
    expect(modelRequests).toBeGreaterThanOrEqual(3);
  });
});
