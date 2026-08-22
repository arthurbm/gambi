import { afterEach, describe, expect, test } from "bun:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type BoardRuntime, createBoardApp } from "../app";
import type { AppRouterClient } from "../orpc/routers";

const runtimes: BoardRuntime[] = [];
const REVISION_PATTERN = /"revision":\d+/;

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
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
});
