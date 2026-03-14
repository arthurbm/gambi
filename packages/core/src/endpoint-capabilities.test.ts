import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { probeEndpoint } from "./endpoint-capabilities.ts";

function getRandomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function startTestServer(
  fetch: (req: Request) => Response | Promise<Response>
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return Bun.serve({
        port: getRandomPort(),
        hostname: "127.0.0.1",
        fetch,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

describe("probeEndpoint", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = startTestServer((req) => {
      const authHeader = req.headers.get("Authorization");
      if (authHeader !== "Bearer test-token") {
        return new Response("Unauthorized", { status: 401 });
      }

      const url = new URL(req.url);
      if (url.pathname === "/v1/models" && req.method === "GET") {
        return Response.json({
          object: "list",
          data: [{ id: "llama3", object: "model", owned_by: "test" }],
        });
      }

      if (
        (url.pathname === "/v1/chat/completions" ||
          url.pathname === "/v1/responses") &&
        req.method === "POST"
      ) {
        return Response.json({ error: "Probe accepted" }, { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("detects models and capabilities when auth headers are provided", async () => {
    const result = await probeEndpoint(baseUrl, {
      authHeaders: {
        Authorization: "Bearer test-token",
      },
    });

    expect(result.success).toBe(true);
    expect(result.models).toEqual(["llama3"]);
    expect(result.capabilities.chatCompletions).toBe("supported");
    expect(result.capabilities.openResponses).toBe("supported");
  });

  test("does not detect protected endpoints without auth headers", async () => {
    const result = await probeEndpoint(baseUrl);

    expect(result.success).toBe(false);
    expect(result.models).toEqual([]);
  });
});
