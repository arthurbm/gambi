import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type BoardRuntime, createBoardApp } from "../app";
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
    first.close();

    const second = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      onError: () => undefined,
    });
    const recovered = await rpcClient(second).board.state();

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
    expect(recovered.events).toHaveLength(4);
    expect(recovered.revision).toBe(4);
    second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
