import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type BoardRuntime, createBoardApp } from "../app";
import type { BoardHarnessRuntime } from "../harness-runtime";
import type { AppRouterClient } from "../orpc/routers";

function rpcClient(runtime: BoardRuntime): AppRouterClient {
  const link = new RPCLink({
    url: "http://board.test/rpc",
    headers: { "x-board-admin-token": "test-admin-token" },
    fetch: async (input, init) => runtime.app.fetch(new Request(input, init)),
  });
  return createORPCClient(link);
}

test("recovers configuration, membership, phase, and audit events after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gambi-board-recovery-"));
  const databaseUrl = `file:${join(directory, "board.db")}`;

  try {
    const first = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      onError: () => undefined,
    });
    const firstClient = rpcClient(first);
    await firstClient.admin.configure({
      theme: "Cidade recuperada",
      squadCount: 4,
      hostedHarnessCount: 1,
    });
    await firstClient.people.join({ personId: "person-recovery", name: "Lia" });
    await firstClient.squads.join({
      personId: "person-recovery",
      squadId: "squad-4",
    });
    await firstClient.phase.advance();
    await firstClient.orchestrator.selectSteerer({
      actorPersonId: "person-recovery",
      personId: "person-recovery",
    });
    const workflow = await firstClient.workflow.get({});
    const challenge = workflow.challenges.find(
      (item) => item.squadId === "squad-4"
    );
    await firstClient.orchestrator.editChallenge({
      actorPersonId: "person-recovery",
      challengeId: challenge?.id ?? "",
      objective: "Objetivo editado antes do reinício",
    });
    await firstClient.orchestrator.publish({
      actorPersonId: "person-recovery",
    });
    await firstClient.drafts.create({
      actorPersonId: "person-recovery",
      challengeId: challenge?.id ?? "",
      content: "Draft que precisa sobreviver",
    });
    await first.close();

    const second = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      onError: () => undefined,
    });
    const secondClient = rpcClient(second);
    const recovered = await secondClient.board.state();
    const recoveredWorkflow = await secondClient.workflow.get({});

    expect(recovered.config).toMatchObject({
      theme: "Cidade recuperada",
      squadCount: 4,
      hostedHarnessCount: 1,
      currentPhase: "round:1",
    });
    expect(recovered.squads[3]?.members[0]).toMatchObject({
      id: "person-recovery",
      name: "Lia",
    });
    expect(recoveredWorkflow.orchestratorSteerer).toMatchObject({
      personId: "person-recovery",
    });
    expect(
      recoveredWorkflow.challenges.find((item) => item.id === challenge?.id)
    ).toMatchObject({
      objective: "Objetivo editado antes do reinício",
      status: "published",
    });
    expect(
      recoveredWorkflow.challenges
        .find((item) => item.id === challenge?.id)
        ?.drafts.some(
          (draft) => draft.content === "Draft que precisa sobreviver"
        )
    ).toBe(true);
    expect(recovered.events).toHaveLength(8);
    expect(recovered.revision).toBe(8);
    await second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("recovers a dispatched Decision and its escalation after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gambi-round-recovery-"));
  const databaseUrl = `file:${join(directory, "board.db")}`;
  const fakeHarness: BoardHarnessRuntime = {
    close: () => Promise.resolve(),
    prompt: async () => ({ sessionId: "unused", revision: 0 }),
    promptSession: () => Promise.resolve("Resposta recuperável do harness"),
    reconcileHosted: () => Promise.resolve(),
    subscribeArtifacts: () => () => undefined,
  };

  try {
    const first = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: false,
      harnessRuntime: fakeHarness,
      onError: () => undefined,
    });
    const client = rpcClient(first);
    await client.admin.configure({
      theme: "Cidade persistente",
      squadCount: 1,
      hostedHarnessCount: 1,
    });
    await client.people.join({ personId: "person-dispatch", name: "Bia" });
    await client.squads.join({
      personId: "person-dispatch",
      squadId: "squad-1",
    });
    await first.repository.reconcileHarnessParticipants([
      {
        id: "board-hosted-recovery",
        nickname: "Hospedado recuperação",
        model: "fake-event",
        harness: { id: "fake", hosted: true, model: "fake-event" },
        connection: { connected: true },
      },
    ]);
    await client.harnesses.claimHosted({
      personId: "person-dispatch",
      participantId: "board-hosted-recovery",
    });
    await client.phase.advance();
    await client.harnesses.assign({
      actorPersonId: "person-dispatch",
      squadId: "squad-1",
      participantId: "board-hosted-recovery",
    });
    await client.harnesses.electSteerer({
      actorPersonId: "person-dispatch",
      squadId: "squad-1",
      personId: "person-dispatch",
    });
    await client.orchestrator.selectSteerer({
      actorPersonId: "person-dispatch",
      personId: "person-dispatch",
    });
    const challenge = (await client.workflow.get({})).challenges[0];
    await client.orchestrator.publish({ actorPersonId: "person-dispatch" });
    await client.decisions.record({
      actorPersonId: "person-dispatch",
      challengeId: challenge?.id ?? "",
      build: "Praça com abrigo",
      cut: "Gradis",
      reason: "Manter a chegada aberta",
      consideredDraftIds: [challenge?.drafts[0]?.id ?? ""],
    });
    const dispatch = await client.dispatches.send({
      actorPersonId: "person-dispatch",
      challengeId: challenge?.id ?? "",
      expectedOutput: "Um lote navegável",
      constraints: ["Preservar o acesso"],
    });
    await client.reviews.record({
      actorPersonId: "person-dispatch",
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Falta sinalização",
    });
    const secondReturn = await client.reviews.record({
      actorPersonId: "person-dispatch",
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Falta contraste",
    });
    await client.orchestrator.answerEscalation({
      actorPersonId: "person-dispatch",
      escalationId: secondReturn.escalationId ?? "",
      response: "Mantenha o acesso e aumente o contraste",
    });
    await first.close();

    const second = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: false,
      onError: () => undefined,
    });
    const recovered = await rpcClient(second).workflow.get({});
    expect(recovered.challenges[0]?.decision).toMatchObject({
      build: "Praça com abrigo",
      cut: "Gradis",
      reason: "Manter a chegada aberta",
    });
    expect(recovered.challenges[0]?.dispatch).toMatchObject({
      id: dispatch.id,
      sessionId: dispatch.sessionId,
      status: "sent",
    });
    expect(recovered.challenges[0]?.dispatch?.reviews).toHaveLength(2);
    expect(recovered.escalations[0]).toMatchObject({
      status: "answered",
      response: "Mantenha o acesso e aumente o contraste",
      returnCount: 2,
    });
    await second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
