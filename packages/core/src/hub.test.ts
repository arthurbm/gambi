import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { z } from "zod";
import { createHub, type Hub } from "./hub.ts";
import { Room } from "./room.ts";

const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.number(),
});

const RoomResponseSchema = z.object({
  room: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  hostId: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
});

const RoomsListResponseSchema = z.object({
  rooms: z.array(z.object({ participantCount: z.number() })),
});

const JoinResponseSchema = z.object({
  participant: z.object({ id: z.string(), nickname: z.string() }),
  roomId: z.string(),
});

const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

const ParticipantsResponseSchema = z.object({
  participants: z.array(z.object({ nickname: z.string() })),
});

const ModelsResponseSchema = z.object({
  object: z.string(),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.string(),
      owned_by: z.string(),
      gambiarra: z.object({
        nickname: z.string(),
        model: z.string(),
        endpoint: z.string(),
        capabilities: z
          .object({
            openResponses: z.string(),
            chatCompletions: z.string(),
          })
          .optional(),
      }),
    })
  ),
});

const ResponseSchema = z.object({
  id: z.string(),
  object: z.literal("response"),
  model: z.string(),
  output_text: z.string(),
});

const ResponseItemListSchema = z.object({
  object: z.literal("list"),
  data: z.array(z.object({ type: z.string() })),
});

function getRandomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createResponsePayload(
  responseId: string,
  model: string,
  outputText: string
) {
  return {
    id: responseId,
    created_at: Math.floor(Date.now() / 1000),
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model,
    object: "response" as const,
    output: [
      {
        id: `msg_${responseId}`,
        type: "message" as const,
        role: "assistant" as const,
        status: "completed" as const,
        content: [
          {
            type: "output_text" as const,
            text: outputText,
            annotations: [],
          },
        ],
      },
    ],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    background: null,
    conversation: null,
    max_output_tokens: null,
    previous_response_id: null,
    prompt: null,
    prompt_cache_retention: null,
    reasoning: null,
    service_tier: null,
    status: "completed",
    text: { format: { type: "text" }, verbosity: "medium" },
    truncation: "disabled",
    usage: {
      input_tokens: 5,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 3,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 8,
    },
  };
}

function createStreamingResponsesPayload(
  responseId: string,
  outputText: string
) {
  const response = createResponsePayload(responseId, "llama3", outputText);
  const encoder = new TextEncoder();
  const chunks = [
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      sequence_number: 0,
      response: {
        ...response,
        status: "in_progress",
        output: [],
        output_text: "",
      },
    })}\n\n`,
    `event: response.output_item.added\ndata: ${JSON.stringify({
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item: {
        id: `msg_${responseId}`,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      sequence_number: 2,
      output_index: 0,
      item_id: `msg_${responseId}`,
      content_index: 0,
      delta: outputText,
    })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({
      type: "response.output_item.done",
      sequence_number: 3,
      output_index: 0,
      item: response.output[0],
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      sequence_number: 4,
      response,
    })}\n\n`,
    "data: [DONE]\n\n",
  ];

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function createMockParticipantServer(mode: "responses" | "chat-only") {
  const responses = new Map<string, ReturnType<typeof createResponsePayload>>();
  const calls = {
    chatCompletions: 0,
    responses: 0,
  };

  const server = Bun.serve({
    port: getRandomPort(),
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/v1/responses" && req.method === "POST") {
        calls.responses += 1;
        if (mode === "chat-only") {
          return new Response("Not Found", { status: 404 });
        }

        const body = (await req.json()) as { model?: string; stream?: boolean };
        const responseId = `resp_${calls.responses}`;
        const payload = createResponsePayload(
          responseId,
          body.model ?? "llama3",
          "native response"
        );
        responses.set(responseId, payload);

        if (body.stream) {
          return new Response(
            createStreamingResponsesPayload(responseId, "native response"),
            {
              headers: { "Content-Type": "text/event-stream" },
            }
          );
        }

        return Response.json(payload);
      }

      if (
        url.pathname.startsWith("/v1/responses/") &&
        !url.pathname.endsWith("/cancel") &&
        !url.pathname.endsWith("/input_items") &&
        req.method === "GET"
      ) {
        const responseId = url.pathname.split("/").pop() ?? "";
        const payload = responses.get(responseId);
        return payload
          ? Response.json(payload)
          : new Response("Not Found", { status: 404 });
      }

      if (url.pathname.endsWith("/cancel") && req.method === "POST") {
        const responseId = url.pathname.split("/")[3] ?? "";
        const payload = responses.get(responseId);
        return payload
          ? Response.json(payload)
          : new Response("Not Found", { status: 404 });
      }

      if (url.pathname.endsWith("/input_items") && req.method === "GET") {
        return Response.json({
          object: "list",
          first_id: "item_1",
          has_more: false,
          last_id: "item_1",
          data: [
            {
              id: "item_1",
              type: "message",
              role: "user",
              content: "Hello from input items",
            },
          ],
        });
      }

      if (
        url.pathname.startsWith("/v1/responses/") &&
        !url.pathname.endsWith("/cancel") &&
        req.method === "DELETE"
      ) {
        const responseId = url.pathname.split("/").pop() ?? "";
        responses.delete(responseId);
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        calls.chatCompletions += 1;
        const body = (await req.json()) as { model?: string; stream?: boolean };

        if (body.stream) {
          const encoder = new TextEncoder();
          const chunks = [
            `data: ${JSON.stringify({
              id: "chatcmpl_stream",
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: body.model ?? "llama3",
              choices: [{ index: 0, delta: { content: "fallback stream" } }],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "chatcmpl_stream",
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: body.model ?? "llama3",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`,
            "data: [DONE]\n\n",
          ];

          return new Response(
            new ReadableStream({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } }
          );
        }

        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "llama3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "fallback response",
              },
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    calls,
    close: () => server.stop(),
    url: `http://127.0.0.1:${server.port}`,
  };
}

describe("Hub", () => {
  let hub: Hub;
  let baseUrl: string;

  beforeAll(() => {
    hub = createHub({ port: getRandomPort(), hostname: "127.0.0.1" });
    baseUrl = hub.url;
  });

  afterAll(() => {
    hub.close();
  });

  beforeEach(() => {
    Room.clear();
  });
  async function createRoom(name: string) {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return RoomResponseSchema.parse(await res.json());
  }

  async function joinRoom(
    code: string,
    participant: {
      id: string;
      nickname: string;
      model: string;
      endpoint: string;
      capabilities?: {
        openResponses: "supported" | "unsupported" | "unknown";
        chatCompletions: "supported" | "unsupported" | "unknown";
      };
    }
  ) {
    const res = await fetch(`${baseUrl}/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(participant),
    });
    return { res, data: await res.json() };
  }

  describe("GET /health", () => {
    test("returns health status", async () => {
      const res = await fetch(`${baseUrl}/health`);
      const data = HealthResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("POST /rooms", () => {
    test("creates a new room", async () => {
      const res = await fetch(`${baseUrl}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Room" }),
      });
      const data = RoomResponseSchema.parse(await res.json());

      expect(res.status).toBe(201);
      expect(data.room.name).toBe("Test Room");
      expect(data.room.code).toHaveLength(6);
      expect(data.hostId).toBeDefined();
    });

    test("returns error when name is missing", async () => {
      const res = await fetch(`${baseUrl}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error).toBe("Name is required");
    });
  });

  describe("GET /rooms", () => {
    test("returns empty list when no rooms", async () => {
      const res = await fetch(`${baseUrl}/rooms`);
      const data = RoomsListResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.rooms).toEqual([]);
    });

    test("returns list of rooms with participant count", async () => {
      await createRoom("Room 1");
      await createRoom("Room 2");

      const res = await fetch(`${baseUrl}/rooms`);
      const data = RoomsListResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.rooms).toHaveLength(2);
      const firstRoom = data.rooms[0];
      expect(firstRoom).toBeDefined();
      expect(firstRoom?.participantCount).toBe(0);
    });
  });

  describe("POST /rooms/:code/join", () => {
    test("joins a room", async () => {
      const { room } = await createRoom("Test Room");
      const { res, data } = await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(res.status).toBe(201);
      const joinData = JoinResponseSchema.parse(data);
      expect(joinData.participant.id).toBe("participant-1");
      expect(joinData.participant.nickname).toBe("test-user");
      expect(joinData.roomId).toBe(room.id);
    });

    test("returns error for non-existent room", async () => {
      const { res, data } = await joinRoom("XXXXXX", {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(res.status).toBe(404);
      const errorData = ErrorResponseSchema.parse(data);
      expect(errorData.error).toBe("Room not found");
    });

    test("returns error when required fields are missing", async () => {
      const { room } = await createRoom("Test Room");
      const res = await fetch(`${baseUrl}/rooms/${room.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "participant-1" }),
      });
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });
  });

  describe("DELETE /rooms/:code/leave/:id", () => {
    test("removes participant from room", async () => {
      const { room } = await createRoom("Test Room");
      await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(
        `${baseUrl}/rooms/${room.code}/leave/participant-1`,
        { method: "DELETE" }
      );
      const data = SuccessResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("returns error for non-existent participant", async () => {
      const { room } = await createRoom("Test Room");
      const res = await fetch(
        `${baseUrl}/rooms/${room.code}/leave/non-existent`,
        { method: "DELETE" }
      );
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error).toBe("Participant not found");
    });
  });

  describe("POST /rooms/:code/health", () => {
    test("updates participant last seen", async () => {
      const { room } = await createRoom("Test Room");
      await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(`${baseUrl}/rooms/${room.code}/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "participant-1" }),
      });
      const data = SuccessResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("returns error for non-existent participant", async () => {
      const { room } = await createRoom("Test Room");
      const res = await fetch(`${baseUrl}/rooms/${room.code}/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "non-existent" }),
      });
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error).toBe("Participant not found");
    });
  });

  describe("GET /rooms/:code/participants", () => {
    test("returns participants in room", async () => {
      const { room } = await createRoom("Test Room");
      await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(`${baseUrl}/rooms/${room.code}/participants`);
      const data = ParticipantsResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.participants).toHaveLength(1);
      const firstParticipant = data.participants[0];
      expect(firstParticipant).toBeDefined();
      expect(firstParticipant?.nickname).toBe("test-user");
    });

    test("returns error for non-existent room", async () => {
      const res = await fetch(`${baseUrl}/rooms/XXXXXX/participants`);
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error).toBe("Room not found");
    });
  });

  describe("GET /rooms/:code/v1/models", () => {
    test("returns OpenAI-compatible models list", async () => {
      const { room } = await createRoom("Test Room");
      await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(`${baseUrl}/rooms/${room.code}/v1/models`);
      const data = ModelsResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.object).toBe("list");
      expect(data.data).toHaveLength(1);
      const firstModel = data.data[0];
      expect(firstModel).toBeDefined();
      expect(firstModel?.id).toBe("participant-1");
      expect(firstModel?.object).toBe("model");
      expect(firstModel?.owned_by).toBe("test-user");
      expect(firstModel?.gambiarra).toEqual({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
        capabilities: {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
      });
    });

    test("only returns online participants", async () => {
      const { room } = await createRoom("Test Room");
      await joinRoom(room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      // Mark participant as offline
      Room.updateParticipantStatus(room.id, "participant-1", "offline");

      const res = await fetch(`${baseUrl}/rooms/${room.code}/v1/models`);
      const data = ModelsResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data).toHaveLength(0);
    });
  });

  describe("Responses API", () => {
    test("proxies native OpenResponses requests and lifecycle operations", async () => {
      const participantServer = createMockParticipantServer("responses");

      try {
        const { room } = await createRoom("Responses Room");
        await joinRoom(room.code, {
          id: "participant-native",
          nickname: "native-server",
          model: "llama3",
          endpoint: participantServer.url,
          capabilities: {
            openResponses: "supported",
            chatCompletions: "supported",
          },
        });

        const createResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-native",
              input: "Hello native",
            }),
          }
        );
        const created = ResponseSchema.parse(await createResponse.json());

        expect(createResponse.status).toBe(200);
        expect(created.output_text).toBe("native response");
        expect(participantServer.calls.responses).toBe(1);
        expect(participantServer.calls.chatCompletions).toBe(0);

        const retrieveResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses/${created.id}`
        );
        const retrieved = ResponseSchema.parse(await retrieveResponse.json());
        expect(retrieveResponse.status).toBe(200);
        expect(retrieved.id).toBe(created.id);

        const inputItemsResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses/${created.id}/input_items`
        );
        const inputItems = ResponseItemListSchema.parse(
          await inputItemsResponse.json()
        );
        expect(inputItemsResponse.status).toBe(200);
        expect(inputItems.data).toHaveLength(1);

        const cancelResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses/${created.id}/cancel`,
          { method: "POST" }
        );
        expect(cancelResponse.status).toBe(200);

        const deleteResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses/${created.id}`,
          { method: "DELETE" }
        );
        expect(deleteResponse.status).toBe(204);
      } finally {
        participantServer.close();
      }
    });

    test("falls back to chat/completions for create when OpenResponses is unsupported", async () => {
      const participantServer = createMockParticipantServer("chat-only");

      try {
        const { room } = await createRoom("Fallback Room");
        await joinRoom(room.code, {
          id: "participant-fallback",
          nickname: "fallback-server",
          model: "llama3",
          endpoint: participantServer.url,
          capabilities: {
            openResponses: "unsupported",
            chatCompletions: "supported",
          },
        });

        const createResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-fallback",
              input: "Hello fallback",
            }),
          }
        );
        const created = ResponseSchema.parse(await createResponse.json());

        expect(createResponse.status).toBe(200);
        expect(created.output_text).toBe("fallback response");
        expect(participantServer.calls.responses).toBe(0);
        expect(participantServer.calls.chatCompletions).toBe(1);

        const retrieveResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses/${created.id}`
        );
        const retrieveError = ErrorResponseSchema.parse(
          await retrieveResponse.json()
        );

        expect(retrieveResponse.status).toBe(501);
        expect(retrieveError.error).toContain("chat/completions fallback");
      } finally {
        participantServer.close();
      }
    });

    test("streams fallback responses in OpenResponses event format", async () => {
      const participantServer = createMockParticipantServer("chat-only");

      try {
        const { room } = await createRoom("Streaming Fallback Room");
        await joinRoom(room.code, {
          id: "participant-stream",
          nickname: "stream-server",
          model: "llama3",
          endpoint: participantServer.url,
          capabilities: {
            openResponses: "unsupported",
            chatCompletions: "supported",
          },
        });

        const response = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-stream",
              input: "Hello streaming fallback",
              stream: true,
            }),
          }
        );

        const text = await response.text();
        expect(response.status).toBe(200);
        expect(text).toContain("response.output_text.delta");
        expect(text).toContain("fallback stream");
        expect(text).toContain("response.completed");
      } finally {
        participantServer.close();
      }
    });
  });

  describe("OPTIONS (CORS)", () => {
    test("returns CORS headers", async () => {
      const res = await fetch(`${baseUrl}/rooms`, { method: "OPTIONS" });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("404 handling", () => {
    test("returns 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/unknown`);

      expect(res.status).toBe(404);
    });
  });
});
