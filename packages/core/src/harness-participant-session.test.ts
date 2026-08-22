import { afterEach, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHarnessParticipantSession,
  HarnessDependencyError,
} from "./harness-participant-session.ts";
import { createHarnessWorkspace } from "./harness-workspace.ts";
import { createHub, type Hub } from "./hub.ts";

function randomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createTestHub(): Hub {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return createHub({ hostname: "127.0.0.1", port: randomPort() });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function openWebSocket(url: string): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(`Failed to open ${url}`)),
      { once: true }
    );
  });
}

function createFrameReader(socket: WebSocket) {
  const frames: unknown[] = [];
  const waiters: Array<(frame: unknown) => void> = [];
  socket.addEventListener("message", (event) => {
    const text =
      typeof event.data === "string"
        ? event.data
        : Buffer.from(event.data as ArrayBuffer).toString("utf8");
    const frame: unknown = JSON.parse(text);
    const waiter = waiters.shift();
    if (waiter) {
      waiter(frame);
    } else {
      frames.push(frame);
    }
  });

  return async () => {
    if (frames.length > 0) {
      return frames.shift();
    }
    return await Promise.race([
      new Promise<unknown>((resolve) => waiters.push(resolve)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out waiting for harness frame.")),
          3000
        )
      ),
    ]);
  };
}

describe("HarnessParticipantSession", () => {
  const hubs: Hub[] = [];
  const sockets: WebSocket[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;
    for (const hub of hubs) {
      hub.close();
    }
    hubs.length = 0;
    for (const directory of temporaryDirectories) {
      await rm(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  test("keeps room and participant identifiers inside the workspace root", async () => {
    const gambiHome = await mkdtemp(join(tmpdir(), "gambi safe workspace "));
    temporaryDirectories.push(gambiHome);
    const workspacePath = await createHarnessWorkspace({
      gambiHome,
      roomCode: "..",
      participantId: "../outside",
      harness: "fake",
      model: "fixture",
    });

    expect(workspacePath).toBe(
      join(gambiHome, "workspaces", "%2E%2E", "..%2Foutside")
    );
    expect(workspacePath.startsWith(join(gambiHome, "workspaces"))).toBe(true);
  });

  test("reports an actionable dependency error before touching the hub", async () => {
    await expect(
      createHarnessParticipantSession({
        roomCode: "ABC123",
        participantId: "missing-opencode",
        nickname: "Missing OpenCode",
        harnessId: "opencode",
        adapter: {
          id: "opencode",
          command: "opencode",
          args: ["acp"],
          notes: [],
          detect: async () => ({
            ok: false,
            message:
              "OpenCode is not installed. Install it from https://opencode.ai/docs and retry.",
          }),
        },
      })
    ).rejects.toEqual(
      new HarnessDependencyError(
        "OpenCode is not installed. Install it from https://opencode.ai/docs and retry."
      )
    );
  });

  test("bridges a real fake ACP process and publishes workspace artifacts", async () => {
    const hub = createTestHub();
    hubs.push(hub);
    const createResponse = await fetch(`${hub.url}/v1/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Harness runtime" }),
    });
    const createBody = (await createResponse.json()) as {
      data: { room: { code: string } };
    };
    const roomCode = createBody.data.room.code;
    const gambiHome = await mkdtemp(join(tmpdir(), "gambi harness home "));
    temporaryDirectories.push(gambiHome);
    const lifecycle: string[] = [];

    const session = await createHarnessParticipantSession({
      hubUrl: hub.url,
      roomCode,
      participantId: "fake-participant",
      nickname: "Fake participant",
      harnessId: "fake",
      model: "deterministic-fixture",
      gambiHome,
      artifactDebounceMs: 50,
      onEvent: (event) => lifecycle.push(event.type),
    });

    expect(session.workspacePath).toBe(
      join(gambiHome, "workspaces", roomCode, "fake-participant")
    );
    expect(
      await Bun.file(join(session.workspacePath, "index.html")).text()
    ).toContain("OrthographicCamera");
    expect(
      await Bun.file(join(session.workspacePath, "README.md")).text()
    ).toContain("Neighborhood sign");
    expect(
      await Bun.file(join(session.workspacePath, "manifest.json")).json()
    ).toMatchObject({
      station: null,
    });
    expect(lifecycle).toEqual(["harness_spawned", "session_opened"]);

    const attachUrl = new URL(
      `/v1/rooms/${roomCode}/participants/fake-participant/harness`,
      hub.url.replace("http:", "ws:")
    );
    const client = await openWebSocket(attachUrl.toString());
    sockets.push(client);
    const nextFrame = createFrameReader(client);

    client.send(
      JSON.stringify({
        type: "tunnel.harness.message",
        sessionId: session.sessionId,
        message: {
          jsonrpc: "2.0",
          id: 7,
          method: "session/prompt",
          params: {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "build the station" }],
          },
        },
      })
    );

    await expect(nextFrame()).resolves.toMatchObject({
      type: "tunnel.harness.message",
      sessionId: session.sessionId,
      message: {
        method: "session/update",
        params: {
          sessionId: session.sessionId,
          update: {
            content: { text: "Fake ACP response: build the station" },
          },
        },
      },
    });
    await expect(nextFrame()).resolves.toMatchObject({
      type: "tunnel.harness.message",
      sessionId: session.sessionId,
      message: { id: 7, result: { stopReason: "end_turn" } },
    });
    await expect(nextFrame()).resolves.toMatchObject({
      type: "tunnel.harness.artifact",
      sessionId: session.sessionId,
      version: 1,
      reason: "watch",
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "fake-output.txt",
          content: "Fake ACP response: build the station\n",
        }),
      ]),
    });

    await Bun.write(
      join(session.workspacePath, "human note.txt"),
      "reviewed\n"
    );
    const secondArtifact = (await nextFrame()) as {
      files: Array<{ path: string }>;
      version: number;
    };
    expect(secondArtifact.version).toBe(2);
    expect(secondArtifact.files.map((file) => file.path)).toContain(
      "human note.txt"
    );
    expect(secondArtifact.files.map((file) => file.path)).not.toContain(
      ".gambi.json"
    );

    client.send(
      JSON.stringify({
        type: "tunnel.harness.control",
        sessionId: "second-session",
        action: "open",
      })
    );
    await expect(nextFrame()).resolves.toMatchObject({
      type: "tunnel.harness.status",
      sessionId: "second-session",
      status: "opened",
    });
    client.send(
      JSON.stringify({
        type: "tunnel.harness.control",
        sessionId: "second-session",
        action: "close",
      })
    );
    await expect(nextFrame()).resolves.toMatchObject({
      type: "tunnel.harness.status",
      sessionId: "second-session",
      status: "closed",
    });

    const closeResult = await session.close();
    expect(closeResult.reason).toBe("closed");
    await expect(session.harnessExited).resolves.toBeNumber();
    expect(lifecycle).toContain("artifact_sent");
    expect(lifecycle).toContain("harness_exited");
  }, 15_000);
});
