import { Buffer } from "node:buffer";
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
import { TunnelServerMessage } from "./tunnel-protocol.ts";
import type { RoomEvent } from "./types.ts";

const ApiMetaSchema = z.object({
  requestId: z.string(),
});

function successSchema<T extends z.ZodType>(schema: T) {
  return z.object({
    data: schema,
    meta: ApiMetaSchema,
  });
}

const HealthResponseSchema = successSchema(
  z.object({
    status: z.string(),
    timestamp: z.number(),
  })
);

const RoomSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  passwordProtected: z.boolean(),
  participantCount: z.number(),
  defaults: z
    .object({
      hasInstructions: z.boolean(),
      temperature: z.number().optional(),
    })
    .optional(),
});

const RoomResponseSchema = successSchema(
  z.object({
    room: RoomSummarySchema,
    hostId: z.string(),
  })
);

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  meta: ApiMetaSchema,
});

const LegacyErrorResponseSchema = z.object({
  error: z.string(),
});

const RoomsListResponseSchema = successSchema(z.array(RoomSummarySchema));

const JoinResponseSchema = successSchema(
  z.object({
    participant: z.object({
      id: z.string(),
      nickname: z.string(),
      endpoint: z.string().optional(),
      status: z.string(),
      connection: z.object({
        kind: z.literal("tunnel"),
        connected: z.boolean(),
        lastTunnelSeenAt: z.number().nullable(),
      }),
      config: z.object({
        hasInstructions: z.boolean(),
        temperature: z.number().optional(),
        max_tokens: z.number().optional(),
      }),
    }),
    roomId: z.string(),
    tunnel: z.object({
      url: z.string(),
      token: z.string(),
    }),
  })
);

const SuccessResponseSchema = successSchema(
  z.object({
    success: z.boolean(),
  })
);

const ParticipantsResponseSchema = successSchema(
  z.array(
    z.object({
      nickname: z.string(),
      status: z.string(),
      connection: z.object({
        kind: z.literal("tunnel"),
        connected: z.boolean(),
        lastTunnelSeenAt: z.number().nullable(),
      }),
      config: z.object({
        hasInstructions: z.boolean(),
        temperature: z.number().optional(),
        max_tokens: z.number().optional(),
      }),
    })
  )
);

const ModelsResponseSchema = z.object({
  object: z.string(),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.string(),
      owned_by: z.string(),
      gambi: z.object({
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

function startServerWithRetry(
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

function createHubWithRetry(): Hub {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return createHub({ port: getRandomPort(), hostname: "127.0.0.1" });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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

function createMockParticipantServer(
  mode: "responses" | "chat-only",
  authHeader?: { name: string; value: string }
) {
  const responses = new Map<string, ReturnType<typeof createResponsePayload>>();
  const calls = {
    chatCompletions: 0,
    responses: 0,
  };
  let lastChatCompletionsBody: unknown;
  let lastResponsesBody: unknown;

  const server = startServerWithRetry(async (req) => {
    const url = new URL(req.url);

    if (authHeader) {
      const receivedAuthHeader = req.headers.get(authHeader.name);
      if (receivedAuthHeader !== authHeader.value) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    if (url.pathname === "/v1/models" && req.method === "GET") {
      return Response.json({
        object: "list",
        data: [{ id: "llama3", object: "model", owned_by: "mock" }],
      });
    }

    if (url.pathname === "/v1/responses" && req.method === "POST") {
      calls.responses += 1;
      if (mode === "chat-only") {
        return new Response("Not Found", { status: 404 });
      }

      const body = (await req.json()) as { model?: string; stream?: boolean };
      lastResponsesBody = body;
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
      lastChatCompletionsBody = body;

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
  });

  return {
    calls,
    close: () => server.stop(),
    lastChatCompletionsBody: () => lastChatCompletionsBody,
    lastResponsesBody: () => lastResponsesBody,
    url: `http://127.0.0.1:${server.port}`,
  };
}

describe("Hub", () => {
  let hub: Hub;
  let baseUrl: string;
  const tunnelSockets = new Set<WebSocket>();

  beforeAll(() => {
    hub = createHubWithRetry();
    baseUrl = hub.url;
  });

  afterAll(() => {
    hub.close();
  });

  beforeEach(() => {
    Room.clear();
    for (const socket of tunnelSockets) {
      socket.close();
    }
    tunnelSockets.clear();
  });

  async function createRoom(
    name: string,
    defaults?: {
      instructions?: string;
      max_tokens?: number;
      temperature?: number;
    }
  ) {
    const res = await fetch(`${baseUrl}/v1/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaults, name }),
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
      config?: {
        instructions?: string;
        max_tokens?: number;
        temperature?: number;
      };
      authHeaders?: Record<string, string>;
      capabilities?: {
        openResponses: "supported" | "unsupported" | "unknown";
        chatCompletions: "supported" | "unsupported" | "unknown";
      };
    },
    headers?: Record<string, string>
  ) {
    const res = await fetch(
      `${baseUrl}/v1/rooms/${code}/participants/${participant.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(participant),
      }
    );
    const data = await res.json();
    const parsed = JoinResponseSchema.safeParse(data);
    if (res.ok && parsed.success) {
      await connectParticipantTunnel({
        endpoint: participant.endpoint,
        authHeaders: participant.authHeaders,
        tunnel: parsed.data.data.tunnel,
      });
    }
    return { res, data };
  }

  async function connectParticipantTunnel(params: {
    authHeaders?: Record<string, string>;
    endpoint: string;
    tunnel: { token: string; url: string };
  }) {
    const url = new URL(params.tunnel.url);
    url.searchParams.set("token", params.tunnel.token);

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(ws), { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("Failed to connect participant tunnel.")),
        { once: true }
      );
    });
    tunnelSockets.add(socket);

    socket.addEventListener("message", async (event) => {
      const text =
        typeof event.data === "string"
          ? event.data
          : Buffer.from(event.data as ArrayBuffer).toString("utf8");
      const parsed = TunnelServerMessage.safeParse(JSON.parse(text));
      if (!parsed.success || parsed.data.type === "tunnel.pong") {
        return;
      }

      const response = await fetch(
        `${params.endpoint.replace(/\/$/, "")}${parsed.data.path}`,
        {
          method: parsed.data.method,
          headers: {
            ...(params.authHeaders ?? {}),
            ...parsed.data.headers,
          },
          body:
            parsed.data.body === undefined
              ? undefined
              : JSON.stringify(parsed.data.body),
        }
      );

      socket.send(
        JSON.stringify({
          type: "tunnel.response.start",
          requestId: parsed.data.requestId,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        })
      );

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            socket.send(
              JSON.stringify({
                type: "tunnel.response.chunk",
                requestId: parsed.data.requestId,
                chunk: Buffer.from(value).toString("base64"),
              })
            );
          }
        }
      }

      socket.send(
        JSON.stringify({
          type: "tunnel.response.end",
          requestId: parsed.data.requestId,
        })
      );
    });

    socket.send(
      JSON.stringify({
        type: "tunnel.ping",
        timestamp: Date.now(),
      })
    );

    return socket;
  }

  async function connectRoomEvents(roomCode: string) {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/v1/rooms/${roomCode}/events`, {
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Expected an SSE response body.");
    }

    const decoder = new TextDecoder();
    const queuedEvents: RoomEvent[] = [];
    let buffer = "";

    return {
      close: async () => {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          // The stream can already be closed by the time cleanup runs.
        }
      },
      nextEvent: async () => {
        if (queuedEvents[0]) {
          return queuedEvents.shift() as RoomEvent;
        }

        while (true) {
          const { done, value } = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Timed out waiting for room event.")), 1000);
            }),
          ]);
          if (done) {
            throw new Error("Event stream closed before the expected event arrived.");
          }

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const payloadLine = block
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!payloadLine) {
              continue;
            }

            queuedEvents.push(JSON.parse(payloadLine.slice(6)) as RoomEvent);
          }

          if (queuedEvents[0]) {
            return queuedEvents.shift() as RoomEvent;
          }
        }
      },
    };
  }

  describe("mDNS", () => {
    test("starts and stops with mDNS enabled", () => {
      const mdnsHub = createHub({
        port: getRandomPort(),
        hostname: "127.0.0.1",
        mdns: true,
      });

      expect(mdnsHub.mdnsName).toBeDefined();

      mdnsHub.close();
    });
  });

  describe("GET /v1/health", () => {
    test("returns health status", async () => {
      const res = await fetch(`${baseUrl}/v1/health`);
      const data = HealthResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data.status).toBe("ok");
      expect(data.data.timestamp).toBeDefined();
    });
  });

  describe("POST /v1/rooms", () => {
    test("creates a new room", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Room" }),
      });
      const data = RoomResponseSchema.parse(await res.json());

      expect(res.status).toBe(201);
      expect(data.data.room.name).toBe("Test Room");
      expect(data.data.room.code).toHaveLength(6);
      expect(data.data.hostId).toBeDefined();
    });

    test("returns error when name is missing", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error.code).toBe("INVALID_REQUEST");
    });

    test("returns typed error when the body is invalid JSON", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error.code).toBe("INVALID_REQUEST");
      expect(data.error.message).toBe("Invalid JSON body.");
      expect(data.meta.requestId).toBeDefined();
    });

    test("accepts room defaults and redacts instructions in public responses", async () => {
      const { data } = await createRoom("Configured Room", {
        instructions: "Room-level system prompt",
        temperature: 0.3,
      });

      expect(data.room.defaults).toEqual({
        hasInstructions: true,
        temperature: 0.3,
      });
      expect(data.room.defaults).not.toHaveProperty("instructions");
    });
  });

  describe("GET /v1/rooms", () => {
    test("returns empty list when no rooms", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms`);
      const data = RoomsListResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data).toEqual([]);
    });

    test("returns list of rooms with participant count", async () => {
      await createRoom("Room 1");
      await createRoom("Room 2");

      const res = await fetch(`${baseUrl}/v1/rooms`);
      const data = RoomsListResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data).toHaveLength(2);
      const firstRoom = data.data[0];
      expect(firstRoom).toBeDefined();
      expect(firstRoom?.participantCount).toBe(0);
    });
  });

  describe("PUT /v1/rooms/:code/participants/:id", () => {
    test("joins a room", async () => {
      const { data: created } = await createRoom("Test Room");
      const { res, data } = await joinRoom(created.room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(res.status).toBe(201);
      const joinData = JoinResponseSchema.parse(data);
      expect(joinData.data.participant.id).toBe("participant-1");
      expect(joinData.data.participant.nickname).toBe("test-user");
      expect(joinData.data.roomId).toBe(created.room.id);
      expect(joinData.data.participant.status).toBe("offline");
      expect(joinData.data.participant.connection.connected).toBe(false);
      expect("authHeaders" in joinData.data.participant).toBe(false);
      expect(joinData.data.participant.config.hasInstructions).toBe(false);
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
      expect(errorData.error.code).toBe("ROOM_NOT_FOUND");
    });

    test("returns error when required fields are missing", async () => {
      const { data: created } = await createRoom("Test Room");
      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/participant-1`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error.code).toBe("INVALID_REQUEST");
    });

    test("returns typed error when the participant payload is invalid JSON", async () => {
      const { data: created } = await createRoom("Test Room");
      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/participant-1`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }
      );
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(400);
      expect(data.error.code).toBe("INVALID_REQUEST");
      expect(data.error.message).toBe("Invalid JSON body.");
      expect(data.meta.requestId).toBeDefined();
    });

    test("accepts loopback endpoints for remote participants and returns tunnel bootstrap", async () => {
      const { data: created } = await createRoom("Remote Room");
      const { res, data } = await joinRoom(
        created.room.code,
        {
          id: "participant-remote",
          nickname: "remote-user",
          model: "llama3",
          endpoint: "http://localhost:11434",
        },
        { "x-forwarded-for": "192.168.1.50" }
      );

      expect(res.status).toBe(201);
      const joinData = JoinResponseSchema.parse(data);
      expect(joinData.data.participant.endpoint).toBe("http://localhost:11434");
      expect(joinData.data.tunnel.url).toContain("/participants/participant-remote/tunnel");
    });

    test("keeps the replacement tunnel connected when an older socket closes", async () => {
      const { data: created } = await createRoom("Reconnect Room");
      const participantId = "participant-reconnect";

      const firstRegistrationResponse = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/${participantId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participantId,
            nickname: "reconnect-user",
            model: "llama3",
            endpoint: "http://localhost:11434",
          }),
        }
      );
      const firstRegistration = JoinResponseSchema.parse(
        await firstRegistrationResponse.json()
      );
      const firstSocket = await connectParticipantTunnel({
        endpoint: "http://localhost:11434",
        tunnel: firstRegistration.data.tunnel,
      });

      const secondRegistrationResponse = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/${participantId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: participantId,
            nickname: "reconnect-user",
            model: "llama3",
            endpoint: "http://localhost:11434",
          }),
        }
      );
      const secondRegistration = JoinResponseSchema.parse(
        await secondRegistrationResponse.json()
      );
      const secondSocket = await connectParticipantTunnel({
        endpoint: "http://localhost:11434",
        tunnel: secondRegistration.data.tunnel,
      });

      await Bun.sleep(25);

      const participantsResponse = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants`
      );
      const participants = ParticipantsResponseSchema.parse(
        await participantsResponse.json()
      );

      expect(firstSocket.readyState).toBe(WebSocket.CLOSED);
      expect(secondSocket.readyState).toBe(WebSocket.OPEN);
      expect(participants.data[0]?.status).toBe("online");
      expect(participants.data[0]?.connection.connected).toBe(true);
    });

    test("redacts participant instructions in join and list responses", async () => {
      const { data: created } = await createRoom("Test Room");
      const { data } = await joinRoom(created.room.code, {
        id: "participant-redacted",
        nickname: "config-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
        config: {
          instructions: "Never leak me",
          temperature: 0.5,
          max_tokens: 256,
        },
      });

      const joinData = JoinResponseSchema.parse(data);
      expect(joinData.data.participant.config).toEqual({
        hasInstructions: true,
        temperature: 0.5,
        max_tokens: 256,
      });
      expect(joinData.data.participant.config).not.toHaveProperty(
        "instructions"
      );

      const participantsResponse = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants`
      );
      const participantsData = ParticipantsResponseSchema.parse(
        await participantsResponse.json()
      );
      expect(participantsData.data[0]?.config).toEqual({
        hasInstructions: true,
        temperature: 0.5,
        max_tokens: 256,
      });
      expect(participantsData.data[0]?.config).not.toHaveProperty(
        "instructions"
      );
    });
  });

  describe("DELETE /v1/rooms/:code/participants/:id", () => {
    test("removes participant from room", async () => {
      const { data: created } = await createRoom("Test Room");
      await joinRoom(created.room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/participant-1`,
        { method: "DELETE" }
      );
      const data = SuccessResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data.success).toBe(true);
    });

    test("returns error for non-existent participant", async () => {
      const { data: created } = await createRoom("Test Room");
      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/non-existent`,
        { method: "DELETE" }
      );
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error.code).toBe("PARTICIPANT_NOT_FOUND");
    });
  });

  describe("POST /v1/rooms/:code/participants/:id/heartbeat", () => {
    test("updates participant last seen", async () => {
      const { data: created } = await createRoom("Test Room");
      await joinRoom(created.room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/participant-1/heartbeat`,
        {
          method: "POST",
        }
      );
      const data = successSchema(
        z.object({
          success: z.literal(true),
          status: z.string(),
          lastSeen: z.number(),
        })
      ).parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data.success).toBe(true);
    });

    test("returns error for non-existent participant", async () => {
      const { data: created } = await createRoom("Test Room");
      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants/non-existent/heartbeat`,
        {
          method: "POST",
        }
      );
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error.code).toBe("PARTICIPANT_NOT_FOUND");
    });
  });

  describe("GET /v1/rooms/:code/participants", () => {
    test("returns participants in room", async () => {
      const { data: created } = await createRoom("Test Room");
      await joinRoom(created.room.code, {
        id: "participant-1",
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const res = await fetch(
        `${baseUrl}/v1/rooms/${created.room.code}/participants`
      );
      const data = ParticipantsResponseSchema.parse(await res.json());

      expect(res.status).toBe(200);
      expect(data.data).toHaveLength(1);
      const firstParticipant = data.data[0];
      expect(firstParticipant).toBeDefined();
      expect(firstParticipant?.nickname).toBe("test-user");
      expect(firstParticipant).not.toHaveProperty("authHeaders");
    });

    test("returns error for non-existent room", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms/XXXXXX/participants`);
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error.code).toBe("ROOM_NOT_FOUND");
    });
  });

  describe("GET /v1/rooms/:code/events", () => {
    test("returns a typed 404 envelope for missing rooms", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms/XXXXXX/events`);
      const data = ErrorResponseSchema.parse(await res.json());

      expect(res.status).toBe(404);
      expect(data.error.code).toBe("ROOM_NOT_FOUND");
      expect(data.meta.requestId).toBeDefined();
    });
  });

  describe("GET /rooms/:code/v1/models", () => {
    test("returns OpenAI-compatible models list", async () => {
      const {
        data: { room },
      } = await createRoom("Test Room");
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
      expect(firstModel?.gambi).toEqual({
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
      const {
        data: { room },
      } = await createRoom("Test Room");
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

  describe("LLM lifecycle events", () => {
    test("emits llm.complete after a successful non-streaming responses request", async () => {
      const participantEndpoint = createMockParticipantServer("responses");
      try {
        const {
          data: { room },
        } = await createRoom("Responses Events Room");
        await joinRoom(room.code, {
          id: "participant-events",
          nickname: "events-worker",
          model: "llama3",
          endpoint: participantEndpoint.url,
        });

        const events = await connectRoomEvents(room.code);
        try {
          const connectedEvent = await events.nextEvent();
          expect(connectedEvent.type).toBe("connected");

          const response = await fetch(`${baseUrl}/rooms/${room.code}/v1/responses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-events",
              input: "Hello",
            }),
          });
          expect(response.status).toBe(200);

          const requestEvent = await events.nextEvent();
          const completeEvent = await events.nextEvent();

          expect(requestEvent.type).toBe("llm.request");
          expect(requestEvent.data).toMatchObject({
            participantId: "participant-events",
            model: "participant-events",
            protocol: "openResponses",
          });
          expect(completeEvent.type).toBe("llm.complete");
          expect(completeEvent.data).toMatchObject({
            participantId: "participant-events",
            protocol: "openResponses",
            metrics: expect.any(Object),
          });
        } finally {
          await events.close();
        }
      } finally {
        participantEndpoint.close();
      }
    });
  });

  describe("Responses API", () => {
    test("proxies native OpenResponses requests and lifecycle operations", async () => {
      const participantServer = createMockParticipantServer("responses");

      try {
        const {
          data: { room },
        } = await createRoom("Responses Room");
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

    test("keeps provider auth local to the tunnel without exposing it publicly", async () => {
      const participantServer = createMockParticipantServer("responses", {
        name: "Authorization",
        value: "Bearer secret-token",
      });

      try {
        const {
          data: { room },
        } = await createRoom("Authenticated Responses Room");
        const { data, res } = await joinRoom(room.code, {
          id: "participant-auth",
          nickname: "auth-server",
          model: "llama3",
          endpoint: participantServer.url,
          authHeaders: {
            Authorization: "Bearer secret-token",
          },
          capabilities: {
            openResponses: "supported",
            chatCompletions: "supported",
          },
        });
        expect(res.status).toBe(201);
        const joined = JoinResponseSchema.parse(data);

        expect(joined.data.participant).not.toHaveProperty("authHeaders");

        const participantsResponse = await fetch(
          `${baseUrl}/v1/rooms/${room.code}/participants`
        );
        const participants = ParticipantsResponseSchema.parse(
          await participantsResponse.json()
        );
        expect(participants.data[0]).not.toHaveProperty("authHeaders");

        const createResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/responses`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-auth",
              input: "Hello secure provider",
            }),
          }
        );
        const created = ResponseSchema.parse(await createResponse.json());

        expect(createResponse.status).toBe(200);
        expect(created.output_text).toBe("native response");
        expect(participantServer.calls.responses).toBe(1);
      } finally {
        participantServer.close();
      }
    });

    test("falls back to chat/completions for create when OpenResponses is unsupported", async () => {
      const participantServer = createMockParticipantServer("chat-only");

      try {
        const {
          data: { room },
        } = await createRoom("Fallback Room");
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
        const retrieveError = LegacyErrorResponseSchema.parse(
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
        const {
          data: { room },
        } = await createRoom("Streaming Fallback Room");
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

    test("merges room, participant, and request defaults for responses", async () => {
      const participantServer = createMockParticipantServer("responses");

      try {
        const {
          data: { room },
        } = await createRoom("Merged Responses Room", {
          instructions: "Room instructions",
          temperature: 0.2,
          max_tokens: 128,
        });
        await joinRoom(room.code, {
          id: "participant-merged-responses",
          nickname: "merge-server",
          model: "llama3",
          endpoint: participantServer.url,
          config: {
            instructions: "Participant instructions",
            temperature: 0.4,
            max_tokens: 256,
          },
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
              model: "participant-merged-responses",
              input: "Hello merged defaults",
              temperature: 0.9,
            }),
          }
        );

        expect(createResponse.status).toBe(200);
        expect(participantServer.lastResponsesBody()).toMatchObject({
          instructions: "Participant instructions",
          max_output_tokens: 256,
          model: "llama3",
          temperature: 0.9,
        });
      } finally {
        participantServer.close();
      }
    });
  });

  describe("Chat Completions API", () => {
    test("injects merged defaults into chat/completions requests", async () => {
      const participantServer = createMockParticipantServer("chat-only");

      try {
        const {
          data: { room },
        } = await createRoom("Merged Chat Room", {
          instructions: "Room instructions",
          temperature: 0.2,
        });
        await joinRoom(room.code, {
          id: "participant-merged-chat",
          nickname: "chat-server",
          model: "llama3",
          endpoint: participantServer.url,
          config: {
            instructions: "Participant instructions",
            temperature: 0.4,
            max_tokens: 321,
          },
          capabilities: {
            openResponses: "unsupported",
            chatCompletions: "supported",
          },
        });

        const completionResponse = await fetch(
          `${baseUrl}/rooms/${room.code}/v1/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "participant-merged-chat",
              messages: [{ role: "user", content: "Hello chat defaults" }],
            }),
          }
        );

        expect(completionResponse.status).toBe(200);
        expect(participantServer.lastChatCompletionsBody()).toMatchObject({
          max_tokens: 321,
          model: "llama3",
          temperature: 0.4,
        });
        expect(participantServer.lastChatCompletionsBody()).toHaveProperty(
          "messages"
        );
        const requestBody = participantServer.lastChatCompletionsBody() as {
          messages: Array<{ content: string | null; role: string }>;
        };
        expect(requestBody.messages[0]).toEqual({
          role: "system",
          content: "Participant instructions",
        });
      } finally {
        participantServer.close();
      }
    });
  });

  describe("OPTIONS (CORS)", () => {
    test("returns CORS headers", async () => {
      const res = await fetch(`${baseUrl}/v1/rooms`, { method: "OPTIONS" });

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
