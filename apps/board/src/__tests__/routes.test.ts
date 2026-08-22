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
const REVISION_PATTERN = /"revision":\d+/;

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function createRuntime() {
  const runtime = await createBoardApp({
    adminToken: "test-admin-token",
    databaseUrl: ":memory:",
    onError: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

function rpcClient(runtime: BoardRuntime, token?: string): AppRouterClient {
  const link = new RPCLink({
    url: "http://board.test/rpc",
    headers: token ? { "x-board-admin-token": token } : {},
    fetch: async (input, init) => runtime.app.fetch(new Request(input, init)),
  });
  return createORPCClient(link);
}

describe.serial("board routes", () => {
  test("configures the lobby and rejects invalid admin tokens", async () => {
    const runtime = await createRuntime();
    const publicClient = rpcClient(runtime);
    const adminClient = rpcClient(runtime, "test-admin-token");

    await expect(publicClient.admin.getConfig()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const configured = await adminClient.admin.configure({
      theme: "Bairro das gambiarras",
      squadCount: 3,
      hostedHarnessCount: 2,
    });

    expect(configured).toMatchObject({
      theme: "Bairro das gambiarras",
      squadCount: 3,
      hostedHarnessCount: 2,
      currentPhase: "lobby",
    });
    expect(await publicClient.squads.list()).toHaveLength(3);
    const workflow = await publicClient.workflow.get({});
    expect(workflow.challenges).toHaveLength(3);
    expect(
      workflow.challenges.every((challenge) => challenge.drafts.length === 3)
    ).toBe(true);
    await expect(runtime.client.execute("DELETE FROM events")).rejects.toThrow(
      "events are append-only"
    );
  });

  test("requires a name and moves one person between squads", async () => {
    const runtime = await createRuntime();
    const client = rpcClient(runtime);
    const adminClient = rpcClient(runtime, "test-admin-token");

    await expect(
      client.people.join({ personId: "person-0001", name: "   " })
    ).rejects.toBeDefined();
    await client.people.join({ personId: "person-0001", name: "  Bia  " });
    await client.squads.join({ personId: "person-0001", squadId: "squad-1" });
    await client.squads.join({ personId: "person-0001", squadId: "squad-2" });

    const state = await client.board.state();
    expect(state.squads[0]?.members).toHaveLength(0);
    expect(state.squads[1]?.members).toEqual([
      expect.objectContaining({ id: "person-0001", name: "Bia" }),
    ]);
    expect(state.events.slice(-3).map((event) => event.type)).toEqual([
      "person.joined",
      "squad.joined",
      "squad.joined",
    ]);
    await expect(
      adminClient.admin.configure({
        theme: state.config.theme,
        squadCount: 1,
        hostedHarnessCount: 0,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("advances phases and only skips rounds marked skippable", async () => {
    const runtime = await createRuntime();
    const client = rpcClient(runtime, "test-admin-token");

    expect(await client.phase.advance()).toMatchObject({
      currentPhase: "round:1",
    });
    expect(await client.phase.advance()).toMatchObject({
      currentPhase: "round:2",
    });
    await expect(client.phase.skip()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await client.phase.advance()).toMatchObject({
      currentPhase: "round:3",
    });
    expect(await client.phase.skip()).toMatchObject({
      currentPhase: "round:4",
    });
    await expect(
      client.admin.configure({
        theme: "Late",
        squadCount: 4,
        hostedHarnessCount: 0,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const state = await client.board.state();
    expect(state.rounds.find((round) => round.number === 3)?.status).toBe(
      "skipped"
    );
    expect(state.events.at(-1)?.type).toBe("phase.skipped");
  });

  test("sends a snapshot and live revisions over SSE", async () => {
    const runtime = await createRuntime();
    const client = rpcClient(runtime);
    const controller = new AbortController();
    const response = await runtime.app.request("/events", {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    const first = await reader?.read();
    const body = new TextDecoder().decode(first?.value);
    expect(body).toContain("event: board.snapshot");
    expect(body).toMatch(REVISION_PATTERN);

    await client.people.join({ personId: "person-live-0001", name: "Lia" });
    const next = await reader?.read();
    const notification = new TextDecoder().decode(next?.value);
    expect(notification).toContain("event: board.changed");
    expect(notification).toContain('"change":"person.joined"');

    controller.abort();
    await reader?.cancel();
  });

  test("claims one hosted harness and records round assignment and steerer rotation", async () => {
    const runtime = await createRuntime();
    const client = rpcClient(runtime);
    const admin = rpcClient(runtime, "test-admin-token");
    await client.people.join({ personId: "person-harness-a", name: "Bia" });
    await client.people.join({ personId: "person-harness-b", name: "Lia" });
    await client.squads.join({
      personId: "person-harness-a",
      squadId: "squad-1",
    });
    await client.squads.join({
      personId: "person-harness-b",
      squadId: "squad-1",
    });
    await runtime.repository.reconcileHarnessParticipants([
      {
        id: "board-hosted-01",
        nickname: "Hospedado 01",
        model: "fake-event",
        harness: { id: "fake", hosted: true, model: "fake-event" },
        connection: { connected: true },
      },
    ]);
    await client.harnesses.claimHosted({
      personId: "person-harness-a",
      participantId: "board-hosted-01",
    });
    await expect(
      client.harnesses.claimHosted({
        personId: "person-harness-b",
        participantId: "board-hosted-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await admin.phase.advance();
    await client.harnesses.assign({
      actorPersonId: "person-harness-a",
      squadId: "squad-1",
      participantId: "board-hosted-01",
    });
    await client.harnesses.electSteerer({
      actorPersonId: "person-harness-a",
      squadId: "squad-1",
      personId: "person-harness-b",
    });

    const view = await client.harnesses.squad({ squadId: "squad-1" });
    expect(view.assignment).toMatchObject({
      participantId: "board-hosted-01",
      ownerName: "Bia",
      connected: true,
    });
    expect(view.steerer).toEqual({
      personId: "person-harness-b",
      personName: "Lia",
    });
    await expect(
      runtime.repository.requirePromptBinding({
        actorPersonId: "person-harness-a",
        squadId: "squad-1",
      })
    ).rejects.toThrow("Somente Lia");
    expect(
      await runtime.repository.requirePromptBinding({
        actorPersonId: "person-harness-b",
        squadId: "squad-1",
      })
    ).toMatchObject({ roundId: view.roundId });
    expect(
      (await client.board.state()).events
        .map((event) => event.type)
        .filter((type) =>
          ["harness.claimed", "harness.assigned", "steerer.elected"].includes(
            type
          )
        )
    ).toEqual(["harness.claimed", "harness.assigned", "steerer.elected"]);
  });

  test("runs a complete recoverable round through the fake harness", async () => {
    const prompts: Array<{ sessionId: string; prompt: string }> = [];
    const orchestratorPrompts: string[] = [];
    const fakeHarness: BoardHarnessRuntime = {
      close: () => Promise.resolve(),
      reconcileHosted: () => Promise.resolve(),
      subscribeArtifacts: () => () => undefined,
      prompt: async () => ({ sessionId: "unused", revision: 0 }),
      promptSession: (input) => {
        prompts.push({ sessionId: input.sessionId, prompt: input.prompt });
        return Promise.resolve(`Resposta real do harness: ${input.prompt}`);
      },
    };
    const runtime = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl: ":memory:",
      harness: false,
      harnessRuntime: fakeHarness,
      orchestratorRuntime: {
        listModels: () => Promise.resolve([]),
        proposeChallenges: () =>
          Promise.reject(new Error("fixture uses deterministic fallback")),
        run: (prompt) => {
          orchestratorPrompts.push(prompt);
          return Promise.resolve();
        },
        swapModel: () => "handoff",
      },
      onError: () => undefined,
    });
    runtimes.push(runtime);
    const client = rpcClient(runtime);
    const admin = rpcClient(runtime, "test-admin-token");
    await client.people.join({ personId: "person-round-owner", name: "Bia" });
    await client.people.join({ personId: "person-round-steer", name: "Lia" });
    await client.squads.join({
      personId: "person-round-owner",
      squadId: "squad-1",
    });
    await client.squads.join({
      personId: "person-round-steer",
      squadId: "squad-1",
    });
    await runtime.repository.reconcileHarnessParticipants([
      {
        id: "board-hosted-09",
        nickname: "Hospedado 01",
        model: "fake-event",
        harness: { id: "fake", hosted: true, model: "fake-event" },
        connection: { connected: true },
      },
    ]);
    await client.harnesses.claimHosted({
      personId: "person-round-owner",
      participantId: "board-hosted-09",
    });
    await admin.phase.advance();
    await client.harnesses.assign({
      actorPersonId: "person-round-owner",
      squadId: "squad-1",
      participantId: "board-hosted-09",
    });
    await client.harnesses.electSteerer({
      actorPersonId: "person-round-owner",
      squadId: "squad-1",
      personId: "person-round-steer",
    });
    await admin.orchestrator.selectSteerer({
      actorPersonId: "person-round-owner",
      personId: "person-round-owner",
    });

    await client.orchestrator.propose({
      actorPersonId: "person-round-owner",
      objective: "Crie uma cidade acolhedora",
    });
    let workflow = await client.workflow.get({});
    const challenge = workflow.challenges.find(
      (item) => item.squadId === "squad-1"
    );
    expect(challenge?.drafts).toHaveLength(3);
    await client.orchestrator.editChallenge({
      actorPersonId: "person-round-owner",
      challengeId: challenge?.id ?? "",
      objective: "Abra uma praça de chegada",
    });
    await client.orchestrator.publish({ actorPersonId: "person-round-owner" });
    const manual = await client.drafts.create({
      actorPersonId: "person-round-steer",
      challengeId: challenge?.id ?? "",
      content: "Banco contínuo sob as árvores",
    });
    await client.drafts.requestFromHarness({
      actorPersonId: "person-round-owner",
      challengeId: challenge?.id ?? "",
      request: "Proponha uma entrada sem degraus",
    });
    workflow = await client.workflow.get({});
    const harnessDraft = workflow.challenges
      .find((item) => item.id === challenge?.id)
      ?.drafts.find((draft) => draft.origin === "harness" && !draft.seeded);
    expect(harnessDraft?.content).toContain("Resposta real do harness:");
    expect(harnessDraft?.content).not.toBe("Proponha uma entrada sem degraus");
    await client.decisions.record({
      actorPersonId: "person-round-steer",
      challengeId: challenge?.id ?? "",
      build: "Praça acessível com sombra",
      cut: "Palco elevado",
      reason: "A chegada precisa servir todos os corpos",
      consideredDraftIds: [manual.id],
    });
    const sent = await client.dispatches.send({
      actorPersonId: "person-round-steer",
      challengeId: challenge?.id ?? "",
      expectedOutput: "Lote navegável em HTML",
      constraints: ["Preservar os arquivos iniciais"],
    });
    expect(JSON.parse(prompts.at(-1)?.prompt ?? "{}")).toMatchObject({
      objective: "Abra uma praça de chegada",
      decision: { steererName: "Lia" },
    });
    const firstReturn = await client.reviews.record({
      actorPersonId: "person-round-steer",
      dispatchId: sent.id,
      outcome: "returned",
      reason: "A entrada ainda tem um degrau",
    });
    expect(firstReturn.escalationId).toBeUndefined();
    expect(prompts.at(-1)).toEqual({
      sessionId: sent.sessionId,
      prompt: "Devolvido por steerer: A entrada ainda tem um degrau",
    });
    const repeatedReturn = await client.reviews.record({
      actorPersonId: "person-round-steer",
      dispatchId: sent.id,
      outcome: "returned",
      reason: "A entrada ainda tem um degrau",
    });
    expect(repeatedReturn.duplicate).toBe(true);
    expect(prompts).toHaveLength(3);
    const secondReturn = await client.reviews.record({
      actorPersonId: "person-round-steer",
      dispatchId: sent.id,
      outcome: "returned",
      reason: "Falta contraste na sinalização",
    });
    expect(secondReturn.escalationId).toBeDefined();
    expect(prompts).toHaveLength(3);
    const answered = await client.orchestrator.answerEscalation({
      actorPersonId: "person-round-owner",
      escalationId: secondReturn.escalationId ?? "",
      response: "Mantenha a praça e simplifique a sinalização",
    });
    expect(answered.continuation).toBe("resumed");
    expect(orchestratorPrompts.at(-1)).toContain(
      "Mantenha a praça e simplifique a sinalização"
    );
    await client.reviews.record({
      actorPersonId: "person-round-steer",
      dispatchId: sent.id,
      outcome: "accepted",
      reason: "Aprovado",
    });
    workflow = await client.workflow.get({});
    expect(workflow.escalations[0]).toMatchObject({
      status: "answered",
      responderName: "Bia",
    });
    expect(
      workflow.challenges.find((item) => item.id === challenge?.id)?.dispatch
    ).toMatchObject({ status: "accepted", sessionId: sent.sessionId });
  });

  test("persists distinct typed Challenge content proposed by the orchestrator model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gambi-model-proposal-"));
    directories.push(directory);
    const runtime = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl: `file:${join(directory, "board.db")}`,
      harness: false,
      orchestratorRuntime: {
        listModels: () => Promise.resolve([]),
        run: () => Promise.resolve(),
        proposeChallenges: (_prompt, roundId) =>
          Promise.resolve(
            [1, 2].map((ordinal) => ({
              squadId: `squad-${ordinal}`,
              roundId,
              objective: `Desafio original do modelo ${ordinal}`,
              seededDrafts: [
                {
                  authorName: "Orquestrador modelo",
                  content: `Proposta ${ordinal}.A do modelo`,
                  origin: "harness" as const,
                },
                {
                  authorName: "Orquestrador modelo",
                  content: `Proposta ${ordinal}.B do modelo`,
                  origin: "harness" as const,
                },
              ],
            }))
          ),
        swapModel: () => "handoff",
      },
      onError: () => undefined,
    });
    runtimes.push(runtime);
    const client = rpcClient(runtime);
    const admin = rpcClient(runtime, "test-admin-token");
    await admin.admin.configure({
      theme: "Cidade modelada",
      squadCount: 2,
      hostedHarnessCount: 2,
    });
    await client.people.join({ personId: "person-model-owner", name: "Bia" });
    await client.squads.join({
      personId: "person-model-owner",
      squadId: "squad-1",
    });
    await admin.phase.advance();
    await admin.orchestrator.selectSteerer({
      actorPersonId: "person-model-owner",
      personId: "person-model-owner",
    });

    const proposed = await client.orchestrator.propose({
      actorPersonId: "person-model-owner",
      objective: "Faça propostas diferentes",
    });
    const workflow = await client.workflow.get({});

    expect(proposed.source).toBe("model");
    expect(workflow.challenges.map((item) => item.objective)).toEqual([
      "Desafio original do modelo 1",
      "Desafio original do modelo 2",
    ]);
    expect(
      workflow.challenges[1]?.drafts.map((draft) => draft.content)
    ).toEqual(["Proposta 2.A do modelo", "Proposta 2.B do modelo"]);
  });
});
