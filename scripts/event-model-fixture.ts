import { createParticipantSession } from "../packages/core/src/participant-session";

interface FixtureConfig {
  hubUrl: string;
  model: string;
  nickname: string;
  participantId: string;
  port: number;
  roomCode: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readConfig(): FixtureConfig {
  const port = Number(requireEnv("FIXTURE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("FIXTURE_PORT must be an integer from 1 to 65535");
  }
  return {
    hubUrl: requireEnv("GAMBI_HUB_URL"),
    model: requireEnv("FIXTURE_MODEL"),
    nickname: requireEnv("FIXTURE_NICKNAME"),
    participantId: requireEnv("FIXTURE_PARTICIPANT_ID"),
    port,
    roomCode: requireEnv("GAMBI_ROOM_CODE"),
  };
}

function completion(model: string) {
  return {
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "Fixture event model acknowledged the coordination request.",
        },
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
  };
}

const config = readConfig();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/models") {
      return Response.json({
        object: "list",
        data: [
          {
            id: config.model,
            object: "model",
            owned_by: "gambi-event-fixture",
          },
        ],
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      return Response.json(completion(config.model));
    }
    return new Response("Not Found", { status: 404 });
  },
});

const session = await createParticipantSession({
  endpoint: `http://127.0.0.1:${server.port}`,
  hubUrl: config.hubUrl,
  model: config.model,
  nickname: config.nickname,
  participantId: config.participantId,
  roomCode: config.roomCode,
});

console.log(
  JSON.stringify({
    type: "ready",
    participantId: session.participant.id,
    model: config.model,
    endpoint: `http://127.0.0.1:${server.port}`,
  })
);

let stopping = false;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  await session.close();
  server.stop();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
await session.waitUntilClosed();
server.stop();
