import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type {
  Response as OpenAIResponse,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { mDNS } from "./mdns.ts";
import { Participant } from "./participant.ts";
import {
  ADAPTER_SKIP,
  type ChatCompletionsProtocolAdapter,
  type ProtocolAdapterId,
  type ResponseRegistryEntry,
  type ResponsesProtocolAdapter,
} from "./protocol-adapters.ts";
import { Room } from "./room.ts";
import { SSE } from "./sse.ts";
import {
  HEALTH_CHECK_INTERVAL,
  type ParticipantAuthHeaders,
  type ParticipantInfo,
  type ParticipantInfoInternal,
  ParticipantRegistration,
  RuntimeConfig,
} from "./types.ts";

export interface HubOptions {
  port?: number;
  hostname?: string;
  cors?: string[];
  mdns?: boolean;
}

export interface Hub {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  mdnsName?: string;
  close: () => void;
}

// Top-level regex for route matching
const ROOM_PATH_REGEX = /^\/rooms\/([^/]+)/;
const LEAVE_PATH_REGEX = /^\/rooms\/[^/]+\/leave\/[^/]+$/;
const RESPONSES_PATH_REGEX =
  /^\/rooms\/([^/]+)\/v1\/responses\/([^/]+)(?:\/(cancel|input_items))?$/;
const TRAILING_SLASH_REGEX = /\/$/;
const SSE_LINE_SPLIT_REGEX = /\r?\n/;
const SSE_EVENT_SEPARATOR = "\n\n";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface AccumulatedToolCall {
  arguments: string;
  itemId: string;
  name?: string;
  toolCallId?: string;
}

const responseRegistry = new Map<string, ResponseRegistryEntry>();

function rememberResponse(
  responseId: string,
  entry: ResponseRegistryEntry
): void {
  responseRegistry.set(responseId, entry);
}

function getResponseEntry(
  responseId: string
): ResponseRegistryEntry | undefined {
  return responseRegistry.get(responseId);
}

function deleteResponseEntry(responseId: string): void {
  responseRegistry.delete(responseId);
}

function clearResponseRegistry(): void {
  responseRegistry.clear();
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function corsHeaders(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function getDefaultCapabilities(): ParticipantInfoInternal["capabilities"] {
  return {
    openResponses: "unknown",
    chatCompletions: "unknown",
  };
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(TRAILING_SLASH_REGEX, "");
}

function participantUrl(
  participant: ParticipantInfoInternal,
  path: string
): string {
  return `${normalizeEndpoint(participant.endpoint)}${path}`;
}

function createParticipantRequestHeaders(
  authHeaders: ParticipantAuthHeaders,
  headers?: RequestInit["headers"]
): Headers {
  const mergedHeaders = new Headers(headers);
  for (const [name, value] of Object.entries(authHeaders)) {
    mergedHeaders.set(name, value);
  }
  return mergedHeaders;
}

function createJsonParticipantHeaders(
  authHeaders: ParticipantAuthHeaders
): Headers {
  const headers = createParticipantRequestHeaders(authHeaders);
  headers.set("Content-Type", "application/json");
  return headers;
}

function fetchParticipant(
  participant: ParticipantInfoInternal,
  authHeaders: ParticipantAuthHeaders,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(participantUrl(participant, path), {
    ...init,
    headers: createParticipantRequestHeaders(authHeaders, init?.headers),
  });
}

function isResponseLike(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (typeof part !== "object" || part === null) {
        return "";
      }

      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }

      if ("input_text" in part && typeof part.input_text === "string") {
        return part.input_text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildMergedDefaults(
  roomDefaults: RuntimeConfig | undefined,
  participantConfig: RuntimeConfig
): RuntimeConfig {
  return Participant.mergeConfig(roomDefaults ?? {}, participantConfig);
}

function applyResponsesDefaults(
  request: ResponsesCreateRequest,
  defaults: RuntimeConfig
): ResponsesCreateRequest {
  const mergedRequest = { ...request };

  if (mergedRequest.instructions == null && defaults.instructions) {
    mergedRequest.instructions = defaults.instructions;
  }
  if (mergedRequest.temperature == null && defaults.temperature !== undefined) {
    mergedRequest.temperature = defaults.temperature;
  }
  if (mergedRequest.top_p == null && defaults.top_p !== undefined) {
    mergedRequest.top_p = defaults.top_p;
  }
  if (
    mergedRequest.max_output_tokens == null &&
    defaults.max_tokens !== undefined
  ) {
    mergedRequest.max_output_tokens = defaults.max_tokens;
  }
  if (mergedRequest.stop_sequences == null && defaults.stop !== undefined) {
    mergedRequest.stop_sequences = defaults.stop;
  }
  if (
    mergedRequest.frequency_penalty == null &&
    defaults.frequency_penalty !== undefined
  ) {
    mergedRequest.frequency_penalty = defaults.frequency_penalty;
  }
  if (
    mergedRequest.presence_penalty == null &&
    defaults.presence_penalty !== undefined
  ) {
    mergedRequest.presence_penalty = defaults.presence_penalty;
  }
  if (mergedRequest.seed == null && defaults.seed !== undefined) {
    mergedRequest.seed = defaults.seed;
  }

  return mergedRequest;
}

function hasSystemMessage(
  messages: ChatCompletionRequest["messages"]
): boolean {
  return messages.some((message) => message.role === "system");
}

function applyChatCompletionsDefaults(
  request: ChatCompletionRequest,
  defaults: RuntimeConfig
): ChatCompletionRequest {
  const mergedRequest: ChatCompletionRequest = {
    ...request,
    messages: [...request.messages],
  };

  if (!hasSystemMessage(mergedRequest.messages) && defaults.instructions) {
    mergedRequest.messages.unshift({
      role: "system",
      content: defaults.instructions,
    });
  }
  if (mergedRequest.temperature == null && defaults.temperature !== undefined) {
    mergedRequest.temperature = defaults.temperature;
  }
  if (mergedRequest.top_p == null && defaults.top_p !== undefined) {
    mergedRequest.top_p = defaults.top_p;
  }
  if (mergedRequest.max_tokens == null && defaults.max_tokens !== undefined) {
    mergedRequest.max_tokens = defaults.max_tokens;
  }
  if (mergedRequest.stop == null && defaults.stop !== undefined) {
    mergedRequest.stop = defaults.stop;
  }
  if (
    mergedRequest.frequency_penalty == null &&
    defaults.frequency_penalty !== undefined
  ) {
    mergedRequest.frequency_penalty = defaults.frequency_penalty;
  }
  if (
    mergedRequest.presence_penalty == null &&
    defaults.presence_penalty !== undefined
  ) {
    mergedRequest.presence_penalty = defaults.presence_penalty;
  }
  if (mergedRequest.seed == null && defaults.seed !== undefined) {
    mergedRequest.seed = defaults.seed;
  }

  return mergedRequest;
}

// Route handlers
async function createRoom(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    defaults?: unknown;
    name?: string;
    password?: string;
  };
  if (!body.name) {
    return error("Name is required");
  }

  let defaults: RuntimeConfig | undefined;
  if (body.defaults !== undefined) {
    const parsedDefaults = RuntimeConfig.safeParse(body.defaults);
    if (!parsedDefaults.success) {
      return error(`Invalid room defaults: ${parsedDefaults.error.message}`);
    }
    defaults = parsedDefaults.data;
  }

  const hostId = crypto.randomUUID();
  const room = await Room.create(body.name, hostId, body.password, defaults);

  // Strip password hash from public responses to prevent offline brute-force attacks
  const publicRoom = Room.toPublic(room);

  SSE.broadcast("room:created", publicRoom);

  return json({ room: publicRoom, hostId }, 201);
}

function listRooms(): Response {
  return json({ rooms: Room.listWithParticipantCount() });
}

async function joinRoom(req: Request, code: string): Promise<Response> {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const bodyInput = (await req.json()) as Record<string, unknown>;
  if (
    !(
      bodyInput.id &&
      bodyInput.nickname &&
      bodyInput.model &&
      bodyInput.endpoint
    )
  ) {
    return error("Missing required fields: id, nickname, model, endpoint");
  }

  const parsedBody = ParticipantRegistration.safeParse(bodyInput);
  if (!parsedBody.success) {
    return error(
      `Invalid participant registration: ${parsedBody.error.message}`
    );
  }

  const body = parsedBody.data;

  // Validate password if room is protected
  const isPasswordValid = await Room.validatePassword(
    room.id,
    body.password ?? ""
  );
  if (!isPasswordValid) {
    return error("Invalid password", 401);
  }

  const now = Date.now();
  const participant: ParticipantInfoInternal = {
    id: body.id,
    nickname: body.nickname,
    model: body.model,
    endpoint: body.endpoint,
    specs: body.specs ?? {},
    config: body.config ?? {},
    capabilities: body.capabilities ?? getDefaultCapabilities(),
    status: "online",
    joinedAt: now,
    lastSeen: now,
  };

  Room.addParticipant(room.id, participant, body.authHeaders ?? {});

  const publicParticipant = Participant.toPublicInfo(participant);

  SSE.broadcast("participant:joined", publicParticipant, code);

  return json({ participant: publicParticipant, roomId: room.id }, 201);
}

function leaveRoom(code: string, participantId: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const removed = Room.removeParticipant(room.id, participantId);
  if (!removed) {
    return error("Participant not found", 404);
  }

  SSE.broadcast("participant:left", { participantId }, code);

  return json({ success: true });
}

async function healthCheck(req: Request, code: string): Promise<Response> {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const body = (await req.json()) as { id: string };
  if (!body.id) {
    return error("Participant ID is required");
  }

  const updated = Room.updateLastSeen(room.id, body.id);
  if (!updated) {
    return error("Participant not found", 404);
  }

  return json({ success: true });
}

function getParticipants(code: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  return json({ participants: Room.getParticipants(room.id) });
}

function listModels(code: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const participants = Room.getParticipants(room.id).filter(
    (participant) => participant.status === "online"
  );

  const models: GambiarraModel[] = participants.map((participant) => ({
    id: participant.id,
    object: "model" as const,
    created: Math.floor(participant.joinedAt / 1000),
    owned_by: participant.nickname,
    gambiarra: {
      nickname: participant.nickname,
      model: participant.model,
      endpoint: participant.endpoint,
      capabilities: participant.capabilities,
    },
  }));

  const response: ModelsListResponse = { object: "list", data: models };
  return json(response);
}

export interface GambiarraModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  gambiarra: {
    nickname: string;
    model: string;
    endpoint: string;
    capabilities: ParticipantInfo["capabilities"];
  };
}

export interface ModelsListResponse {
  object: "list";
  data: GambiarraModel[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool" | "function";
    content: string | null;
    [key: string]: unknown;
  }>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface ResponsesCreateRequest {
  model: string;
  input?: string | ResponseInputItem[] | null;
  instructions?: string | ResponseInputItem[] | null;
  stream?: boolean;
  [key: string]: unknown;
}

function findParticipant(
  roomId: string,
  modelId: string
): ParticipantInfoInternal | undefined {
  if (modelId === "*" || modelId === "any") {
    return Room.getRandomOnlineParticipant(roomId);
  }

  if (modelId.startsWith("model:")) {
    const actualModel = modelId.slice(6);
    return Room.findParticipantByModel(roomId, actualModel);
  }

  const participantRecord = Room.getParticipantRecord(roomId, modelId);
  if (participantRecord) {
    return participantRecord.info;
  }

  return Room.findParticipantByModel(roomId, modelId);
}

function resolveParticipant(
  code: string,
  modelId: string
):
  | {
      authHeaders: ParticipantAuthHeaders;
      room: NonNullable<ReturnType<typeof Room.getByCode>>;
      participant: ParticipantInfoInternal;
    }
  | Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const participant = findParticipant(room.id, modelId);
  if (!participant) {
    return error("No available participant for the requested model", 404);
  }

  if (participant.status !== "online") {
    return error("Participant is offline", 503);
  }

  const participantRecord = Room.getParticipantRecord(room.id, participant.id);
  if (!participantRecord) {
    return error("Participant connection details not found", 404);
  }

  return {
    room,
    participant,
    authHeaders: participantRecord.authHeaders,
  };
}

function isProtocolFallbackStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

function mapResponseItemToChatMessage(
  item: ResponseInputItem
): ChatCompletionRequest["messages"][number] {
  const typedItem = item as unknown as Record<string, unknown>;
  const itemType =
    typeof typedItem.type === "string" ? typedItem.type : "message";

  if (itemType === "message") {
    const role = typedItem.role;
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "system" &&
      role !== "developer"
    ) {
      throw new Error(`Unsupported Responses message role: ${String(role)}`);
    }

    return {
      role: role === "developer" ? "system" : role,
      content: extractTextContent(typedItem.content),
    };
  }

  if (itemType === "function_call_output") {
    const output = typedItem.output;
    return {
      role: "tool",
      content:
        typeof output === "string" ? output : JSON.stringify(output ?? null),
      tool_call_id:
        typeof typedItem.call_id === "string" ? typedItem.call_id : undefined,
    };
  }

  throw new Error(`Unsupported Responses input item type: ${itemType}`);
}

function convertResponsesRequestToChatCompletions(
  body: ResponsesCreateRequest
): ChatCompletionRequest {
  const unsupportedFields = [
    "background",
    "conversation",
    "previous_response_id",
    "reasoning",
    "store",
    "text",
    "truncation",
  ].filter((field) => body[field] != null);

  if (unsupportedFields.length > 0) {
    throw new Error(
      `Responses -> chat/completions fallback does not support: ${unsupportedFields.join(
        ", "
      )}`
    );
  }

  const messages: ChatCompletionRequest["messages"] = [];

  if (typeof body.instructions === "string") {
    messages.push({ role: "system", content: body.instructions });
  } else if (Array.isArray(body.instructions)) {
    for (const item of body.instructions) {
      messages.push(mapResponseItemToChatMessage(item));
    }
  }

  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      messages.push(mapResponseItemToChatMessage(item));
    }
  }

  if (messages.length === 0) {
    throw new Error(
      "Responses fallback requires textual input or instructions"
    );
  }

  const tools = Array.isArray(body.tools) ? body.tools : undefined;
  if (
    tools?.some(
      (tool) =>
        typeof tool !== "object" ||
        tool === null ||
        !("type" in tool) ||
        tool.type !== "function"
    )
  ) {
    throw new Error(
      "Responses -> chat/completions fallback only supports function tools"
    );
  }

  return {
    model: body.model,
    messages,
    stream: body.stream,
    tools,
    tool_choice: body.tool_choice,
    temperature:
      typeof body.temperature === "number" ? body.temperature : undefined,
    top_p: typeof body.top_p === "number" ? body.top_p : undefined,
    max_tokens:
      typeof body.max_output_tokens === "number"
        ? body.max_output_tokens
        : undefined,
    stop:
      Array.isArray(body.stop_sequences) ||
      typeof body.stop_sequences === "string"
        ? body.stop_sequences
        : undefined,
    frequency_penalty:
      typeof body.frequency_penalty === "number"
        ? body.frequency_penalty
        : undefined,
    presence_penalty:
      typeof body.presence_penalty === "number"
        ? body.presence_penalty
        : undefined,
    seed: typeof body.seed === "number" ? body.seed : undefined,
  };
}

function createSyntheticResponseId(): string {
  return `resp_${crypto.randomUUID().replace(/-/g, "")}`;
}

function createSyntheticItemId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function createResponseUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): ResponseUsage {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage?.completion_tokens ?? 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens:
      usage?.total_tokens ??
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
  };
}

function createResponseMessageItem(text: string) {
  return {
    id: createSyntheticItemId("msg"),
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [
      {
        type: "output_text" as const,
        text,
        annotations: [],
      },
    ],
  };
}

function createResponseFunctionItem(
  toolCall: ChatCompletionMessageFunctionToolCall
) {
  return {
    id: toolCall.id ?? createSyntheticItemId("fc"),
    arguments: toolCall.function.arguments,
    call_id: toolCall.id ?? createSyntheticItemId("call"),
    name: toolCall.function.name,
    status: "completed",
    type: "function_call",
  };
}

function createAccumulatedResponseFunctionItem(toolCall: AccumulatedToolCall) {
  return {
    id: toolCall.itemId,
    arguments: toolCall.arguments,
    call_id: toolCall.toolCallId ?? toolCall.itemId,
    name: toolCall.name ?? "tool",
    status: "completed" as const,
    type: "function_call" as const,
  };
}

function isFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall
): toolCall is ChatCompletionMessageFunctionToolCall {
  return toolCall.type === "function";
}

function adaptChatCompletionToResponse(
  chatCompletion: ChatCompletion,
  requestBody: ResponsesCreateRequest,
  model: string,
  responseId: string
): OpenAIResponse {
  const firstChoice = chatCompletion.choices[0];
  const message = firstChoice?.message;
  const outputItems: Record<string, unknown>[] = [];
  let outputText = "";

  const text = extractTextContent(message?.content ?? null);
  if (text.length > 0) {
    outputText = text;
    outputItems.push(createResponseMessageItem(text));
  }

  for (const toolCall of message?.tool_calls ?? []) {
    if (!isFunctionToolCall(toolCall)) {
      continue;
    }

    outputItems.push(createResponseFunctionItem(toolCall));
  }

  let incompleteDetails: {
    reason: "content_filter" | "max_output_tokens";
  } | null = null;
  if (firstChoice?.finish_reason === "length") {
    incompleteDetails = { reason: "max_output_tokens" };
  } else if (firstChoice?.finish_reason === "content_filter") {
    incompleteDetails = { reason: "content_filter" };
  }

  return {
    id: responseId,
    created_at: chatCompletion.created ?? Math.floor(Date.now() / 1000),
    output_text: outputText,
    error: null,
    incomplete_details: incompleteDetails,
    instructions: requestBody.instructions ?? null,
    metadata: null,
    model,
    object: "response",
    output: outputItems as unknown as OpenAIResponse["output"],
    parallel_tool_calls: false,
    temperature:
      typeof requestBody.temperature === "number"
        ? requestBody.temperature
        : null,
    tool_choice: (requestBody.tool_choice ??
      "auto") as OpenAIResponse["tool_choice"],
    tools: (Array.isArray(requestBody.tools)
      ? requestBody.tools
      : []) as OpenAIResponse["tools"],
    top_p: typeof requestBody.top_p === "number" ? requestBody.top_p : null,
    background: null,
    conversation: null,
    max_output_tokens:
      typeof requestBody.max_output_tokens === "number"
        ? requestBody.max_output_tokens
        : null,
    previous_response_id: null,
    prompt: null,
    prompt_cache_key: undefined,
    prompt_cache_retention: null,
    reasoning: null,
    safety_identifier: undefined,
    service_tier: null,
    status: "completed",
    text: { format: { type: "text" }, verbosity: "medium" },
    truncation: "disabled",
    usage: createResponseUsage(chatCompletion.usage),
    user: undefined,
  } as unknown as OpenAIResponse;
}

function writeSseEvent(event: Record<string, unknown>): Uint8Array {
  const payload = JSON.stringify(event);
  return textEncoder.encode(
    `event: ${event.type}\ndata: ${payload}${SSE_EVENT_SEPARATOR}`
  );
}

function writeSseDone(): Uint8Array {
  return textEncoder.encode("data: [DONE]\n\n");
}

function extractSseEvents(
  buffer: string,
  onEvent: (event: Record<string, unknown>) => void
): string {
  let remainder = buffer;

  while (true) {
    const separatorIndex = remainder.indexOf(SSE_EVENT_SEPARATOR);
    if (separatorIndex === -1) {
      return remainder;
    }

    const rawEvent = remainder.slice(0, separatorIndex);
    remainder = remainder.slice(separatorIndex + SSE_EVENT_SEPARATOR.length);

    const dataLines = rawEvent
      .split(SSE_LINE_SPLIT_REGEX)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      continue;
    }

    try {
      const event = JSON.parse(payload) as Record<string, unknown>;
      onEvent(event);
    } catch {
      // Ignore malformed SSE payloads and keep proxying the original stream.
    }
  }
}

function trackResponseStream(
  stream: ReadableStream<Uint8Array>,
  entry: ResponseRegistryEntry
): ReadableStream<Uint8Array> {
  let buffer = "";

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = textDecoder.decode(chunk, { stream: true });
        buffer = extractSseEvents(buffer + text, (event) => {
          const response = event.response;
          if (isResponseLike(response)) {
            rememberResponse(response.id, entry);
          }
        });
        controller.enqueue(chunk);
      },
      flush(controller) {
        const text = textDecoder.decode();
        if (text.length > 0) {
          buffer = extractSseEvents(buffer + text, (event) => {
            const response = event.response;
            if (isResponseLike(response)) {
              rememberResponse(response.id, entry);
            }
          });
        }
        controller.enqueue(new Uint8Array());
      },
    })
  );
}

function buildFallbackResponseOutputItems(
  accumulatedText: string,
  messageId: string,
  toolCalls: Map<number, AccumulatedToolCall>
): Record<string, unknown>[] {
  const outputItems: Record<string, unknown>[] = [];

  if (accumulatedText.length > 0) {
    outputItems.push({
      id: messageId,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: accumulatedText,
          annotations: [],
        },
      ],
    });
  }

  for (const toolCall of toolCalls.values()) {
    outputItems.push(createAccumulatedResponseFunctionItem(toolCall));
  }

  return outputItems;
}

function createFallbackCompletedResponse(
  requestBody: ResponsesCreateRequest,
  participantModel: string,
  responseId: string,
  createdAt: number,
  accumulatedText: string,
  outputItems: Record<string, unknown>[],
  usage?: ChatCompletion["usage"],
  finishReason?: string | null
): OpenAIResponse {
  return {
    id: responseId,
    created_at: createdAt,
    output_text: accumulatedText,
    error: null,
    incomplete_details:
      finishReason === "length" ? { reason: "max_output_tokens" } : null,
    instructions: requestBody.instructions ?? null,
    metadata: null,
    model: participantModel,
    object: "response",
    output: outputItems as unknown as OpenAIResponse["output"],
    parallel_tool_calls: false,
    temperature:
      typeof requestBody.temperature === "number"
        ? requestBody.temperature
        : null,
    tool_choice: (requestBody.tool_choice ??
      "auto") as OpenAIResponse["tool_choice"],
    tools: (Array.isArray(requestBody.tools)
      ? requestBody.tools
      : []) as OpenAIResponse["tools"],
    top_p: typeof requestBody.top_p === "number" ? requestBody.top_p : null,
    background: null,
    conversation: null,
    max_output_tokens:
      typeof requestBody.max_output_tokens === "number"
        ? requestBody.max_output_tokens
        : null,
    previous_response_id: null,
    prompt: null,
    prompt_cache_key: undefined,
    prompt_cache_retention: null,
    reasoning: null,
    safety_identifier: undefined,
    service_tier: null,
    status: "completed",
    text: { format: { type: "text" }, verbosity: "medium" },
    truncation: "disabled",
    usage: createResponseUsage(usage),
    user: undefined,
  } as unknown as OpenAIResponse;
}

function emitCompletedOutputItems(
  controller: Pick<ReadableStreamDefaultController<Uint8Array>, "enqueue">,
  outputItems: Record<string, unknown>[],
  sequenceNumber: number
): number {
  let nextSequenceNumber = sequenceNumber;

  for (const [index, item] of outputItems.entries()) {
    controller.enqueue(
      writeSseEvent({
        type: "response.output_item.done",
        sequence_number: nextSequenceNumber++,
        output_index: index,
        item,
      })
    );
  }

  return nextSequenceNumber;
}

function transformChatStreamToResponses(
  stream: ReadableStream<Uint8Array>,
  requestBody: ResponsesCreateRequest,
  participantModel: string,
  responseId: string,
  entry: ResponseRegistryEntry
): ReadableStream<Uint8Array> {
  const createdAt = Math.floor(Date.now() / 1000);
  const messageId = createSyntheticItemId("msg");
  let buffer = "";
  let sequenceNumber = 0;
  let usage: ChatCompletion["usage"];
  let accumulatedText = "";
  let emittedTextStart = false;
  let finished = false;
  const toolCalls = new Map<number, AccumulatedToolCall>();

  rememberResponse(responseId, entry);

  const emitCompleted = (
    controller: Pick<ReadableStreamDefaultController<Uint8Array>, "enqueue">,
    finishReason?: string | null
  ) => {
    if (finished) {
      return;
    }

    finished = true;
    const outputItems = buildFallbackResponseOutputItems(
      accumulatedText,
      messageId,
      toolCalls
    );
    const response = createFallbackCompletedResponse(
      requestBody,
      participantModel,
      responseId,
      createdAt,
      accumulatedText,
      outputItems,
      usage,
      finishReason
    );

    sequenceNumber = emitCompletedOutputItems(
      controller,
      outputItems,
      sequenceNumber
    );

    controller.enqueue(
      writeSseEvent({
        type: "response.completed",
        sequence_number: sequenceNumber++,
        response,
      })
    );
    controller.enqueue(writeSseDone());
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        writeSseEvent({
          type: "response.created",
          sequence_number: sequenceNumber++,
          response: {
            id: responseId,
            created_at: createdAt,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: requestBody.instructions ?? null,
            metadata: null,
            model: participantModel,
            object: "response",
            output: [],
            parallel_tool_calls: false,
            temperature:
              typeof requestBody.temperature === "number"
                ? requestBody.temperature
                : null,
            tool_choice: requestBody.tool_choice ?? "auto",
            tools: Array.isArray(requestBody.tools) ? requestBody.tools : [],
            top_p:
              typeof requestBody.top_p === "number" ? requestBody.top_p : null,
            status: "in_progress",
            text: { format: { type: "text" }, verbosity: "medium" },
            truncation: "disabled",
            usage: createResponseUsage(),
          },
        })
      );

      const reader = stream.getReader();

      const processChunk = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          emitCompleted(controller, null);
          controller.close();
          return;
        }

        buffer = extractSseEvents(
          buffer + textDecoder.decode(value, { stream: true }),
          // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Translating streamed chat chunks into OpenResponses SSE requires handling text, tool calls, finish reasons, and usage updates together.
          (event) => {
            const chunk = event as unknown as ChatCompletionChunk;
            const choice = chunk.choices?.[0];
            if (!choice) {
              return;
            }

            if (chunk.usage) {
              usage = {
                prompt_tokens: chunk.usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens,
                total_tokens: chunk.usage.total_tokens,
              };
            }

            const delta = choice.delta;
            const textDelta = extractTextContent(delta?.content ?? null);
            if (textDelta.length > 0) {
              if (!emittedTextStart) {
                emittedTextStart = true;
                controller.enqueue(
                  writeSseEvent({
                    type: "response.output_item.added",
                    sequence_number: sequenceNumber++,
                    output_index: 0,
                    item: {
                      id: messageId,
                      type: "message",
                      role: "assistant",
                      status: "in_progress",
                      content: [],
                    },
                  })
                );
              }

              accumulatedText += textDelta;
              controller.enqueue(
                writeSseEvent({
                  type: "response.output_text.delta",
                  sequence_number: sequenceNumber++,
                  output_index: 0,
                  item_id: messageId,
                  content_index: 0,
                  delta: textDelta,
                })
              );
            }

            for (const toolCallDelta of delta?.tool_calls ?? []) {
              const index = toolCallDelta.index ?? 0;
              const toolCall =
                toolCalls.get(index) ??
                (() => {
                  const initial: AccumulatedToolCall = {
                    arguments: "",
                    itemId: toolCallDelta.id ?? createSyntheticItemId("fc"),
                    toolCallId: toolCallDelta.id,
                  };
                  toolCalls.set(index, initial);
                  return initial;
                })();

              if (toolCallDelta.id) {
                toolCall.toolCallId = toolCallDelta.id;
              }

              if (toolCallDelta.function?.name) {
                toolCall.name = toolCallDelta.function.name;
              }

              if (toolCallDelta.function?.arguments) {
                toolCall.arguments += toolCallDelta.function.arguments;
                controller.enqueue(
                  writeSseEvent({
                    type: "response.function_call_arguments.delta",
                    sequence_number: sequenceNumber++,
                    output_index: emittedTextStart ? index + 1 : index,
                    item_id: toolCall.itemId,
                    delta: toolCallDelta.function.arguments,
                  })
                );
              }
            }

            if (choice.finish_reason) {
              emitCompleted(controller, choice.finish_reason);
            }
          }
        );

        await processChunk();
      };

      processChunk().catch((streamError) => {
        controller.error(streamError);
      });
    },
  });
}

function createStreamingHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

async function forwardNativeResponsesCreate(
  response: Response,
  isStreaming: boolean | undefined,
  entry: ResponseRegistryEntry
): Promise<Response> {
  if (isStreaming) {
    if (!response.body) {
      return error("Target endpoint returned an empty streaming body", 502);
    }

    return new Response(trackResponseStream(response.body, entry), {
      status: response.status,
      headers: createStreamingHeaders(),
    });
  }

  const data = await response.json();
  if (isResponseLike(data)) {
    rememberResponse(data.id, entry);
  }

  return json(data, response.status);
}

async function proxyFallbackResponsesCreate(
  authHeaders: ParticipantAuthHeaders,
  participant: ParticipantInfoInternal,
  body: ResponsesCreateRequest,
  entry: ResponseRegistryEntry
): Promise<Response> {
  let chatRequest: ChatCompletionRequest;
  try {
    chatRequest = convertResponsesRequestToChatCompletions(body);
  } catch (conversionError) {
    return error(
      conversionError instanceof Error
        ? conversionError.message
        : "Unsupported Responses request for chat/completions fallback",
      400
    );
  }

  const responseId = createSyntheticResponseId();
  rememberResponse(responseId, entry);

  const response = await fetchParticipant(
    participant,
    authHeaders,
    "/v1/chat/completions",
    {
      method: "POST",
      headers: createJsonParticipantHeaders(authHeaders),
      body: JSON.stringify({ ...chatRequest, model: participant.model }),
    }
  );

  if (body.stream) {
    if (!response.body) {
      return error("Target endpoint returned an empty streaming body", 502);
    }

    return new Response(
      transformChatStreamToResponses(
        response.body,
        body,
        participant.model,
        responseId,
        entry
      ),
      {
        status: response.status,
        headers: createStreamingHeaders(),
      }
    );
  }

  const data = (await response.json()) as ChatCompletion;
  const adapted = adaptChatCompletionToResponse(
    data,
    body,
    participant.model,
    responseId
  );

  return json(adapted, response.status);
}

async function proxyStoredOpenResponses(
  req: Request,
  authHeaders: ParticipantAuthHeaders,
  participant: ParticipantInfoInternal,
  responseId: string,
  entry: ResponseRegistryEntry,
  action?: "cancel" | "input_items"
): Promise<Response> {
  const search = new URL(req.url).search;
  let path = `/v1/responses/${responseId}${search}`;
  let method = req.method;

  if (action === "cancel") {
    path = `/v1/responses/${responseId}/cancel`;
    method = "POST";
  } else if (action === "input_items") {
    path = `/v1/responses/${responseId}/input_items${search}`;
    method = "GET";
  }

  const response = await fetchParticipant(participant, authHeaders, path, {
    method,
    headers: createJsonParticipantHeaders(authHeaders),
  });

  if (response.status === 404 && action === undefined) {
    deleteResponseEntry(responseId);
  }

  if (req.method === "DELETE" && response.ok) {
    deleteResponseEntry(responseId);
  }

  if ((req.method === "GET" || method === "POST") && response.body) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return new Response(trackResponseStream(response.body, entry), {
        status: response.status,
        headers: createStreamingHeaders(),
      });
    }
  }

  if (response.status === 204 || req.method === "DELETE") {
    return new Response(null, {
      status: response.status,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const data = await response.json();
  return json(data, response.status);
}

const openResponsesAdapter: ResponsesProtocolAdapter = {
  id: "openResponses",
  canCreate: (participant) =>
    participant.capabilities.openResponses !== "unsupported",
  async create({ authHeaders, participant, request, entry }) {
    const response = await fetchParticipant(
      participant,
      authHeaders,
      "/v1/responses",
      {
        method: "POST",
        headers: createJsonParticipantHeaders(authHeaders),
        body: JSON.stringify({ ...request, model: participant.model }),
      }
    );

    if (isProtocolFallbackStatus(response.status)) {
      return ADAPTER_SKIP;
    }

    return forwardNativeResponsesCreate(response, request.stream, entry);
  },
  proxyStoredResponse({
    action,
    authHeaders,
    entry,
    participant,
    req,
    responseId,
  }) {
    return proxyStoredOpenResponses(
      req,
      authHeaders,
      participant,
      responseId,
      entry,
      action
    );
  },
};

const chatCompletionsFallbackAdapter: ResponsesProtocolAdapter = {
  id: "chatCompletions",
  canCreate: (participant) =>
    participant.capabilities.chatCompletions !== "unsupported",
  create({ authHeaders, entry, participant, request }) {
    return proxyFallbackResponsesCreate(
      authHeaders,
      participant,
      request,
      entry
    );
  },
};

const responsesProtocolAdapters: ResponsesProtocolAdapter[] = [
  openResponsesAdapter,
  chatCompletionsFallbackAdapter,
];

const responsesLifecycleAdapters = new Map<
  ProtocolAdapterId,
  ResponsesProtocolAdapter
>(
  responsesProtocolAdapters
    .filter((adapter) => adapter.proxyStoredResponse !== undefined)
    .map((adapter) => [adapter.id, adapter] as const)
);

const chatCompletionsAdapter: ChatCompletionsProtocolAdapter = {
  id: "chatCompletions",
  async create({ authHeaders, participant, request }) {
    const response = await fetchParticipant(
      participant,
      authHeaders,
      "/v1/chat/completions",
      {
        method: "POST",
        headers: createJsonParticipantHeaders(authHeaders),
        body: JSON.stringify({ ...request, model: participant.model }),
      }
    );

    if (request.stream) {
      return new Response(response.body, {
        status: response.status,
        headers: createStreamingHeaders(),
      });
    }

    const data = await response.json();
    return json(data, response.status);
  },
};

async function proxyResponsesCreate(
  req: Request,
  code: string
): Promise<Response> {
  const body = (await req.json()) as ResponsesCreateRequest;
  const resolved = resolveParticipant(code, body.model);
  if (resolved instanceof Response) {
    return resolved;
  }

  const { authHeaders, room, participant } = resolved;
  const request = applyResponsesDefaults(
    body,
    buildMergedDefaults(room.defaults, participant.config)
  );
  const baseEntry = {
    participantId: participant.id,
    roomId: room.id,
  };

  SSE.broadcast(
    "llm:request",
    { participantId: participant.id, model: body.model },
    code
  );

  try {
    for (const adapter of responsesProtocolAdapters) {
      if (!adapter.canCreate(participant)) {
        continue;
      }

      const entry: ResponseRegistryEntry = {
        ...baseEntry,
        adapterId: adapter.id,
      };
      const response = await adapter.create({
        authHeaders,
        entry,
        participant,
        request,
      });

      if (response !== ADAPTER_SKIP) {
        return response;
      }
    }

    return error(
      "No compatible protocol adapter available for the requested Responses operation",
      501
    );
  } catch (proxyError) {
    SSE.broadcast(
      "llm:error",
      { participantId: participant.id, error: String(proxyError) },
      code
    );
    return error(`Failed to proxy request: ${proxyError}`, 502);
  }
}

async function proxyChatCompletions(
  req: Request,
  code: string
): Promise<Response> {
  const body = (await req.json()) as ChatCompletionRequest;
  const resolved = resolveParticipant(code, body.model);
  if (resolved instanceof Response) {
    return resolved;
  }

  const { authHeaders, room, participant } = resolved;
  const request = applyChatCompletionsDefaults(
    body,
    buildMergedDefaults(room.defaults, participant.config)
  );

  SSE.broadcast(
    "llm:request",
    { participantId: participant.id, model: body.model },
    code
  );

  try {
    return await chatCompletionsAdapter.create({
      authHeaders,
      participant,
      request,
    });
  } catch (proxyError) {
    SSE.broadcast(
      "llm:error",
      { participantId: participant.id, error: String(proxyError) },
      code
    );
    return error(`Failed to proxy request: ${proxyError}`, 502);
  }
}

function getStoredParticipant(
  code: string,
  responseId: string
):
  | {
      authHeaders: ParticipantAuthHeaders;
      entry: ResponseRegistryEntry;
      participant: ParticipantInfoInternal;
      room: NonNullable<ReturnType<typeof Room.getByCode>>;
    }
  | Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const entry = getResponseEntry(responseId);
  if (!entry || entry.roomId !== room.id) {
    return error("Response not found", 404);
  }

  const participantRecord = Room.getParticipantRecord(
    room.id,
    entry.participantId
  );
  if (!participantRecord) {
    return error("Participant not found for response", 404);
  }

  return {
    entry,
    participant: participantRecord.info,
    authHeaders: participantRecord.authHeaders,
    room,
  };
}

function getLifecycleUnsupportedResponse(): Response {
  return error(
    "This response was created via chat/completions fallback and does not support Responses lifecycle operations",
    501
  );
}

async function proxyStoredResponse(
  req: Request,
  code: string,
  responseId: string,
  action?: "cancel" | "input_items"
): Promise<Response> {
  const storedParticipant = getStoredParticipant(code, responseId);
  if (storedParticipant instanceof Response) {
    return storedParticipant;
  }

  const { authHeaders, entry, participant } = storedParticipant;
  const adapter = responsesLifecycleAdapters.get(entry.adapterId);
  if (!adapter?.proxyStoredResponse) {
    return getLifecycleUnsupportedResponse();
  }

  return await adapter.proxyStoredResponse({
    action,
    authHeaders,
    entry,
    participant,
    req,
    responseId,
  });
}

function sseEvents(code: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const clientId = crypto.randomUUID();
  return SSE.createResponse(clientId, code);
}

function hubHealth(): Response {
  return json({ status: "ok", timestamp: Date.now() });
}

function handleResponsesRoute(
  req: Request,
  method: string,
  path: string,
  code: string
): Promise<Response> | Response | null {
  if (path === `/rooms/${code}/v1/responses` && method === "POST") {
    return proxyResponsesCreate(req, code);
  }

  const match = path.match(RESPONSES_PATH_REGEX);
  if (!match || match[1] !== code) {
    return null;
  }

  const responseId = match[2];
  if (!responseId) {
    return null;
  }

  const action = match[3] as "cancel" | "input_items" | undefined;

  if (action === "cancel" && method === "POST") {
    return proxyStoredResponse(req, code, responseId, "cancel");
  }

  if (action === "input_items" && method === "GET") {
    return proxyStoredResponse(req, code, responseId, "input_items");
  }

  if (!action && method === "GET") {
    return proxyStoredResponse(req, code, responseId);
  }

  if (!action && method === "DELETE") {
    return proxyStoredResponse(req, code, responseId);
  }

  return null;
}

function handleRoomRoute(
  req: Request,
  method: string,
  path: string,
  code: string
): Promise<Response> | Response | null {
  if (path === `/rooms/${code}/join` && method === "POST") {
    return joinRoom(req, code);
  }

  if (LEAVE_PATH_REGEX.test(path) && method === "DELETE") {
    const participantId = path.split("/").pop();
    if (participantId) {
      return leaveRoom(code, participantId);
    }
  }

  if (path === `/rooms/${code}/health` && method === "POST") {
    return healthCheck(req, code);
  }

  if (path === `/rooms/${code}/participants` && method === "GET") {
    return getParticipants(code);
  }

  if (path === `/rooms/${code}/v1/models` && method === "GET") {
    return listModels(code);
  }

  const responsesRoute = handleResponsesRoute(req, method, path, code);
  if (responsesRoute) {
    return responsesRoute;
  }

  if (path === `/rooms/${code}/v1/chat/completions` && method === "POST") {
    return proxyChatCompletions(req, code);
  }

  if (path === `/rooms/${code}/events` && method === "GET") {
    return sseEvents(code);
  }

  return null;
}

export function createHub(options: HubOptions = {}): Hub {
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? "0.0.0.0";
  const enableMdns = options.mdns ?? false;

  let mdnsName: string | undefined;
  if (enableMdns) {
    mdnsName = `gambiarra-hub-${port}`;
    mDNS.publish({
      name: mdnsName,
      port,
      txt: { version: "1.0", protocol: "http" },
    });
  }

  const healthInterval = setInterval(() => {
    const stale = Room.checkStaleParticipants();
    for (const { roomId, participantId } of stale) {
      const room = Room.get(roomId);
      if (room) {
        SSE.broadcast("participant:offline", { participantId }, room.code);
      }
    }
  }, HEALTH_CHECK_INTERVAL);

  const server = Bun.serve({
    port,
    hostname,
    fetch(req) {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      if (method === "OPTIONS") {
        return corsHeaders();
      }

      if (path === "/health" && method === "GET") {
        return hubHealth();
      }

      if (path === "/rooms" && method === "POST") {
        return createRoom(req);
      }
      if (path === "/rooms" && method === "GET") {
        return listRooms();
      }

      const roomMatch = path.match(ROOM_PATH_REGEX);
      if (roomMatch?.[1]) {
        const result = handleRoomRoute(req, method, path, roomMatch[1]);
        if (result) {
          return result;
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  const actualPort = server.port;
  const url = `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${actualPort}`;

  return {
    server,
    url,
    mdnsName,
    close: () => {
      clearInterval(healthInterval);
      if (mdnsName) {
        mDNS.unpublish(mdnsName);
      }
      clearResponseRegistry();
      Room.clear();
      SSE.closeAll();
      server.stop();
    },
  };
}
