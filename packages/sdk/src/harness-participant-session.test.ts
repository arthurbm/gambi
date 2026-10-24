import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHub, type Hub } from "@gambi/core/hub";
import { createClient } from "./client.ts";
import {
  createFakeHarnessAdapter,
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
} from "./harness-participant-session.ts";

const hubs: Hub[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const hub of hubs.splice(0)) {
    hub.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

function createTestHub(): Hub {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const hub = createHub({
        hostname: "127.0.0.1",
        port: 30_000 + Math.floor(Math.random() * 20_000),
      });
      hubs.push(hub);
      return hub;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

test("a consumer hosts a harness with its own fake agent script and seeded workspace", async () => {
  const hub = createTestHub();
  const client = createClient({ hubUrl: hub.url });
  const {
    data: { room },
  } = await client.rooms.create({ name: "SDK harness" });

  const scratch = await mkdtemp(join(tmpdir(), "gambi-sdk-harness-"));
  temporaryDirectories.push(scratch);
  const sdkEntry = fileURLToPath(
    new URL("./harness-participant-session.ts", import.meta.url)
  );
  const fakeScript = join(scratch, "fake-acp-agent.ts");
  await Bun.write(
    fakeScript,
    `import { runFakeAcpAgent } from ${JSON.stringify(sdkEntry)};\nawait runFakeAcpAgent();\n`
  );

  const local = createLocalDirectoryWorkspace({
    path: join(scratch, "workspace"),
  });
  const session = await createHarnessParticipantSession({
    hubUrl: hub.url,
    roomCode: room.code,
    participantId: "hosted-fake",
    nickname: "Hosted fake",
    harnessId: "fake",
    hosted: true,
    adapter: createFakeHarnessAdapter({
      command: process.execPath,
      args: [fakeScript],
    }),
    workspace: {
      async prepare(context) {
        const prepared = await local.prepare(context);
        await Bun.write(join(prepared.path, "starter.md"), "# starter\n");
        return prepared;
      },
    },
  });

  expect(session.participant.harness).toMatchObject({
    id: "fake",
    hosted: true,
  });
  expect((await readdir(session.workspacePath)).sort()).toEqual([
    ".gambi.json",
    "starter.md",
  ]);

  const closed = await session.close();
  expect(closed.reason).toBe("closed");
}, 15_000);
