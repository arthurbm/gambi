import { Buffer } from "node:buffer";
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
  TunnelClientMessage,
  type TunnelRequestMessage,
} from "./tunnel-protocol.ts";
import {
  type ApiErrorCode,
  type ApiMeta,
  HEALTH_CHECK_INTERVAL,
  type HeartbeatResult,
  PARTICIPANT_TIMEOUT,
  type ParticipantInfo,
  type ParticipantInfoInternal,
  ParticipantRegistration,
  ParticipantSummary,
  RoomSummary,
  RuntimeConfig,
  type TunnelBootstrap,
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
const MANAGEMENT_ROOM_PATH_REGEX = /^\/v1\/rooms\/([^/]+)/;
const MANAGEMENT_PARTICIPANT_PATH_REGEX =
  /^\/v1\/rooms\/([^/]+)\/participants\/([^/]+)(?:\/heartbeat)?$/;
const MANAGEMENT_PARTICIPANT_TUNNEL_PATH_REGEX =
  /^\/v1\/rooms\/([^/]+)\/participants\/([^/]+)\/tunnel$/;
const RESPONSES_PATH_REGEX =
  /^\/rooms\/([^/]+)\/v1\/responses\/([^/]+)(?:\/(cancel|input_items))?$/;
const SSE_LINE_SPLIT_REGEX = /\r?\n/;
const SSE_EVENT_SEPARATOR = "\n\n";
const FORWARDED_IP_SEPARATOR_REGEX = /,/;
const TUNNEL_TOKEN_TTL_MS = 60_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface AccumulatedToolCall {
  arguments: string;
  itemId: string;
  name?: string;
  toolCallId?: string;
}

interface ProxyRequestLifecycle {
  durationStartedAt: number;
  firstByteAt?: number;
  requestId: string;
}

interface TunnelBootstrapEntry {
  expiresAt: number;
  participantId: string;
  roomCode: string;
  roomId: string;
}

interface StoredTunnelBootstrap {
  token: string;
}

interface PendingTunnelRequest {
  chunks: Uint8Array[];
  headers?: Headers;
  reject: (error: Error) => void;
  resolve: (response: Response) => void;
  responseStarted: boolean;
  status?: number;
  stream: boolean;
  streamController?: ReadableStreamDefaultController<Uint8Array>;
  streamBody?: ReadableStream<Uint8Array>;
}

interface TunnelSession {
  lastTunnelSeenAt: number;
  participantId: string;
  pending: Map<string, PendingTunnelRequest>;
  roomCode: string;
  roomId: string;
  ws: Bun.ServerWebSocket<TunnelSocketData>;
}

interface TunnelSocketData {
  participantId: string;
  roomCode: string;
  roomId: string;
  sessionKey: string;
}

const responseRegistry = new Map<string, ResponseRegistryEntry>();
const tunnelBootstrapRegistry = new Map<string, TunnelBootstrapEntry>();
const tunnelSessionRegistry = new Map<string, TunnelSession>();
const participantActiveRequests = new Map<string, number>();

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

function getTunnelSessionKey(roomId: string, participantId: string): string {
  return `${roomId}:${participantId}`;
}

function getParticipantRequestKey(
  roomId: string,
  participantId: string
): string {
  return `${roomId}:${participantId}`;
}

function rememberTunnelBootstrap(
  entry: TunnelBootstrapEntry
): StoredTunnelBootstrap {
  const token = crypto.randomUUID();
  tunnelBootstrapRegistry.set(token, entry);
  return {
    token,
  };
}

function getTunnelBootstrap(token: string): TunnelBootstrapEntry | undefined {
  const entry = tunnelBootstrapRegistry.get(token);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt < Date.now()) {
    tunnelBootstrapRegistry.delete(token);
    return undefined;
  }

  return entry;
}

function consumeTunnelBootstrap(
  token: string
): TunnelBootstrapEntry | undefined {
  const entry = getTunnelBootstrap(token);
  if (!entry) {
    return undefined;
  }

  tunnelBootstrapRegistry.delete(token);
  return entry;
}

function clearExpiredTunnelBootstraps(): void {
  const now = Date.now();
  for (const [token, entry] of tunnelBootstrapRegistry) {
    if (entry.expiresAt < now) {
      tunnelBootstrapRegistry.delete(token);
    }
  }
}

function getTunnelSession(
  roomId: string,
  participantId: string
): TunnelSession | undefined {
  return tunnelSessionRegistry.get(getTunnelSessionKey(roomId, participantId));
}

function setParticipantActiveRequestCount(
  roomId: string,
  participantId: string,
  count: number
): void {
  const key = getParticipantRequestKey(roomId, participantId);
  if (count <= 0) {
    participantActiveRequests.delete(key);
    return;
  }

  participantActiveRequests.set(key, count);
}

function getParticipantActiveRequestCount(
  roomId: string,
  participantId: string
): number {
  return (
    participantActiveRequests.get(
      getParticipantRequestKey(roomId, participantId)
    ) ?? 0
  );
}

function incrementParticipantActiveRequestCount(
  roomId: string,
  participantId: string
): void {
  setParticipantActiveRequestCount(
    roomId,
    participantId,
    getParticipantActiveRequestCount(roomId, participantId) + 1
  );
}

function decrementParticipantActiveRequestCount(
  roomId: string,
  participantId: string
): void {
  setParticipantActiveRequestCount(
    roomId,
    participantId,
    getParticipantActiveRequestCount(roomId, participantId) - 1
  );
}

function beginParticipantProxyRequest(
  roomId: string,
  participantId: string
): void {
  incrementParticipantActiveRequestCount(roomId, participantId);
  Room.updateParticipantStatus(roomId, participantId, "busy");
}

function finishParticipantProxyRequest(
  roomId: string,
  participantId: string
): void {
  decrementParticipantActiveRequestCount(roomId, participantId);
  const participant = Room.getParticipantRecord(roomId, participantId)?.info;
  if (!participant) {
    return;
  }

  Room.updateParticipantStatus(
    roomId,
    participantId,
    participant.connection.connected ? "online" : "offline"
  );
}

function updateTunnelConnectionState(
  roomId: string,
  participantId: string,
  connected: boolean
): void {
  Room.updateParticipantConnection(roomId, participantId, {
    connected,
    lastTunnelSeenAt: connected ? Date.now() : null,
  });

  Room.updateParticipantStatus(
    roomId,
    participantId,
    connected ? "online" : "offline"
  );
}

function rejectPendingTunnelRequests(
  session: TunnelSession,
  message = "Participant tunnel disconnected."
): void {
  for (const pending of session.pending.values()) {
    pending.reject(new Error(message));
    pending.streamController?.error(new Error(message));
  }
  session.pending.clear();
  setParticipantActiveRequestCount(session.roomId, session.participantId, 0);
}

function clearTunnelSession(
  roomId: string,
  participantId: string,
  expectedWs?: TunnelSession["ws"]
): TunnelSession | undefined {
  const sessionKey = getTunnelSessionKey(roomId, participantId);
  const session = tunnelSessionRegistry.get(sessionKey);
  if (!session || (expectedWs && session.ws !== expectedWs)) {
    return undefined;
  }

  tunnelSessionRegistry.delete(sessionKey);
  updateTunnelConnectionState(roomId, participantId, false);
  rejectPendingTunnelRequests(session);
  return session;
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

function managementJson(
  data: unknown,
  requestId: string,
  status = 200
): Response {
  return json(
    {
      data,
      meta: { requestId } satisfies ApiMeta,
    },
    status
  );
}

function managementError(
  requestId: string,
  code: ApiErrorCode,
  message: string,
  hint?: string,
  status = 400,
  details?: unknown
): Response {
  return json(
    {
      error: {
        code,
        message,
        hint,
        details,
      },
      meta: { requestId } satisfies ApiMeta,
    },
    status
  );
}

function corsHeaders(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function createTunnelBootstrap(
  req: Request,
  roomId: string,
  roomCode: string,
  participantId: string
): TunnelBootstrap {
  const bootstrap = rememberTunnelBootstrap({
    roomId,
    roomCode,
    participantId,
    expiresAt: Date.now() + TUNNEL_TOKEN_TTL_MS,
  });

  const url = new URL(req.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/v1/rooms/${roomCode}/participants/${participantId}/tunnel`;
  url.search = "";
  return {
    ...bootstrap,
    url: url.toString(),
  };
}

function recordToHeaders(headers: Record<string, string> | undefined): Headers {
  return new Headers(headers ?? {});
}

function buildMetrics(params: {
  completedAt: number;
  lifecycle: ProxyRequestLifecycle;
  usage?: {
    completionTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
  };
}) {
  const ttftMs = Math.max(
    0,
    (params.lifecycle.firstByteAt ?? params.completedAt) -
      params.lifecycle.durationStartedAt
  );
  const durationMs = Math.max(
    0,
    params.completedAt - params.lifecycle.durationStartedAt
  );
  const inputTokens = params.usage?.promptTokens;
  const outputTokens = params.usage?.completionTokens;
  const totalTokens =
    params.usage?.totalTokens ??
    ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);

  return {
    ttftMs,
    durationMs,
    inputTokens,
    outputTokens,
    totalTokens,
    tokensPerSecond:
      outputTokens !== undefined && durationMs > 0
        ? (outputTokens / durationMs) * 1000
        : undefined,
  };
}

function tryParseMetricsFromBody(
  protocol: "openResponses" | "chatCompletions",
  bodyText: string
) {
  if (!bodyText.trim()) {
    return undefined;
  }

  try {
    const data = JSON.parse(bodyText) as Record<string, unknown>;
    if (protocol === "openResponses") {
      const usage = data.usage as
        | {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          }
        | undefined;
      return usage
        ? {
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined;
    }

    const usage = data.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined;
    return usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function decodeTunnelChunk(chunk: string): Uint8Array {
  return Buffer.from(chunk, "base64");
}

function finalizePendingTunnelRequest(
  session: TunnelSession,
  requestId: string,
  finalize: (pending: PendingTunnelRequest) => void
): void {
  const pending = session.pending.get(requestId);
  if (!pending) {
    return;
  }

  session.pending.delete(requestId);
  finalize(pending);
}

function handleTunnelMessage(
  session: TunnelSession,
  rawMessage: string | Buffer | ArrayBuffer | Uint8Array
): void {
  const text =
    typeof rawMessage === "string"
      ? rawMessage
      : Buffer.from(
          rawMessage instanceof ArrayBuffer
            ? new Uint8Array(rawMessage)
            : rawMessage
        ).toString("utf8");
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }

  const parsed = TunnelClientMessage.safeParse(message);
  if (!parsed.success) {
    return;
  }

  session.lastTunnelSeenAt = Date.now();
  Room.updateParticipantConnection(session.roomId, session.participantId, {
    connected: true,
    lastTunnelSeenAt: session.lastTunnelSeenAt,
  });

  if (parsed.data.type === "tunnel.ping") {
    session.ws.send(
      JSON.stringify({ type: "tunnel.pong", timestamp: Date.now() })
    );
    return;
  }

  if (parsed.data.type === "tunnel.response.start") {
    const pending = session.pending.get(parsed.data.requestId);
    if (!pending) {
      return;
    }

    pending.status = parsed.data.status;
    pending.headers = recordToHeaders(parsed.data.headers);
    pending.responseStarted = true;

    if (pending.stream && pending.streamController) {
      pending.resolve(
        new Response(pending.streamBody, {
          status: pending.status,
          headers: pending.headers,
        })
      );
    }
    return;
  }

  if (parsed.data.type === "tunnel.response.chunk") {
    const pending = session.pending.get(parsed.data.requestId);
    if (!pending) {
      return;
    }

    const chunk = decodeTunnelChunk(parsed.data.chunk);
    if (pending.stream && pending.streamController) {
      pending.streamController.enqueue(chunk);
      return;
    }

    pending.chunks.push(chunk);
    return;
  }

  if (parsed.data.type === "tunnel.response.end") {
    finalizePendingTunnelRequest(session, parsed.data.requestId, (pending) => {
      if (pending.stream && pending.streamController) {
        pending.streamController.close();
        return;
      }

      const body = pending.chunks.length
        ? Buffer.concat(pending.chunks.map((chunk) => Buffer.from(chunk)))
        : undefined;
      pending.resolve(
        new Response(body, {
          status: pending.status ?? 200,
          headers: pending.headers,
        })
      );
    });
    return;
  }

  if (parsed.data.type === "tunnel.response.error") {
    const { message, requestId } = parsed.data;
    finalizePendingTunnelRequest(session, requestId, (pending) => {
      const error = new Error(message);
      if (pending.stream && pending.streamController) {
        pending.streamController.error(error);
      }
      pending.reject(error);
    });
  }
}

function createBufferedResponseStream(pending: PendingTunnelRequest) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      pending.streamController = controller;
    },
  });
}

function dispatchTunnelRequest(
  session: TunnelSession,
  request: TunnelRequestMessage
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const pending: PendingTunnelRequest = {
      resolve,
      reject,
      stream: request.stream,
      chunks: [],
      responseStarted: false,
    };

    if (request.stream) {
      const stream = createBufferedResponseStream(pending);
      pending.streamBody = stream;
      pending.resolve = (response) => resolve(response);
      pending.reject = reject;
      session.pending.set(request.requestId, pending);
      const sent = session.ws.send(JSON.stringify(request));
      if (sent <= 0) {
        session.pending.delete(request.requestId);
        reject(new Error("Failed to send tunnel request."));
        return;
      }

      return;
    }

    session.pending.set(request.requestId, pending);
    const sent = session.ws.send(JSON.stringify(request));
    if (sent <= 0) {
      session.pending.delete(request.requestId);
      reject(new Error("Failed to send tunnel request."));
      return;
    }
  });
}

function getDefaultCapabilities(): ParticipantInfoInternal["capabilities"] {
  return {
    openResponses: "unknown",
    chatCompletions: "unknown",
  };
}

function getRequesterIp(
  req: Request,
  server?: { requestIP: (req: Request) => { address: string } | null }
): string | null {
  const forwarded = req.headers
    .get("x-forwarded-for")
    ?.split(FORWARDED_IP_SEPARATOR_REGEX)[0]
    ?.trim();
  if (forwarded) {
    return forwarded;
  }

  return server?.requestIP(req)?.address ?? null;
}

function createTunnelRequest(params: {
  body?: unknown;
  metadata?: Record<string, unknown>;
  method: "GET" | "POST" | "DELETE";
  operation: string;
  path: string;
  stream?: boolean;
}): TunnelRequestMessage {
  return {
    type: "tunnel.request",
    requestId: crypto.randomUUID(),
    operation: params.operation,
    method: params.method,
    path: params.path,
    headers:
      params.body === undefined ? {} : { "Content-Type": "application/json" },
    body: params.body,
    stream: params.stream ?? false,
    metadata: params.metadata,
  };
}

async function fetchParticipantThroughTunnel(
  participant: ParticipantInfoInternal,
  roomId: string,
  request: TunnelRequestMessage
): Promise<Response> {
  const session = getTunnelSession(roomId, participant.id);
  if (!(session && participant.connection.connected)) {
    throw new Error("Participant tunnel is not connected.");
  }

  return await dispatchTunnelRequest(session, request);
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
async function createRoom(req: Request, requestId: string): Promise<Response> {
  let body: {
    defaults?: unknown;
    name?: string;
    password?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch (error) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Invalid JSON body.",
      "Provide a valid JSON object and retry.",
      400,
      {
        cause: error instanceof Error ? error.message : String(error),
      }
    );
  }
  if (!body.name) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Name is required",
      "Provide a room name via the 'name' field."
    );
  }

  let defaults: RuntimeConfig | undefined;
  if (body.defaults !== undefined) {
    const parsedDefaults = RuntimeConfig.safeParse(body.defaults);
    if (!parsedDefaults.success) {
      return managementError(
        requestId,
        "INVALID_REQUEST",
        "Invalid room defaults.",
        "Check the runtime config payload and retry.",
        400,
        parsedDefaults.error.flatten()
      );
    }
    defaults = parsedDefaults.data;
  }

  const hostId = crypto.randomUUID();
  const room = await Room.create(body.name, hostId, body.password, defaults);

  // Strip password hash from public responses to prevent offline brute-force attacks
  const summary = RoomSummary.parse({
    ...Room.toPublic(room),
    participantCount: 0,
  });

  SSE.broadcast("room.created", summary, room.code);

  return managementJson({ room: summary, hostId }, requestId, 201);
}

function listRooms(requestId: string): Response {
  return managementJson(Room.listWithParticipantCount(), requestId);
}

function getRoomSummary(code: string, requestId: string): Response {
  const room = Room.getSummaryByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  return managementJson(room, requestId);
}

async function upsertParticipant(
  req: Request,
  code: string,
  participantId: string,
  _requesterIp: string | null,
  requestId: string
): Promise<Response> {
  const room = Room.getByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  let bodyInput: Record<string, unknown>;
  try {
    bodyInput = (await req.json()) as Record<string, unknown>;
  } catch (error) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Invalid JSON body.",
      "Provide a valid JSON object and retry.",
      400,
      {
        cause: error instanceof Error ? error.message : String(error),
      }
    );
  }
  bodyInput.id = participantId;
  if (Object.hasOwn(bodyInput, "authHeaders")) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Participant auth headers are not accepted by the hub.",
      "Pass authHeaders to createParticipantSession() or the CLI runtime so credentials stay local to the participant.",
      400,
      { forbidden: ["authHeaders"] }
    );
  }

  if (!(bodyInput.nickname && bodyInput.model && bodyInput.endpoint)) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Missing required fields.",
      "Provide nickname, model, and endpoint.",
      400,
      { required: ["nickname", "model", "endpoint"] }
    );
  }

  const parsedBody = ParticipantRegistration.safeParse(bodyInput);
  if (!parsedBody.success) {
    return managementError(
      requestId,
      "INVALID_REQUEST",
      "Invalid participant registration.",
      "Check the participant payload and retry.",
      400,
      parsedBody.error.flatten()
    );
  }

  const body = parsedBody.data;

  // Validate password if room is protected
  const isPasswordValid = await Room.validatePassword(
    room.id,
    body.password ?? ""
  );
  if (!isPasswordValid) {
    return managementError(
      requestId,
      "INVALID_PASSWORD",
      "Invalid password.",
      "Provide the correct room password and retry.",
      401
    );
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
    connection: {
      kind: "tunnel",
      connected: false,
      lastTunnelSeenAt: null,
    },
    status: "offline",
    joinedAt: now,
    lastSeen: now,
    updatedAt: now,
  };

  const result = Room.upsertParticipant(room.id, participant, {});
  if (!result) {
    return managementError(
      requestId,
      "INTERNAL_ERROR",
      "Failed to register participant.",
      "Retry the operation."
    );
  }

  const publicParticipant = ParticipantSummary.parse(
    Participant.toPublicInfo(result.participant)
  );

  SSE.broadcast(
    result.created ? "participant.joined" : "participant.updated",
    publicParticipant,
    code
  );

  const tunnel = createTunnelBootstrap(req, room.id, room.code, participantId);

  return managementJson(
    { participant: publicParticipant, roomId: room.id, tunnel },
    requestId,
    result.created ? 201 : 200
  );
}

function leaveRoom(
  code: string,
  participantId: string,
  requestId: string
): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  const removed = Room.removeParticipant(room.id, participantId);
  if (!removed) {
    return managementError(
      requestId,
      "PARTICIPANT_NOT_FOUND",
      "Participant not found.",
      "Check the participant id and retry.",
      404
    );
  }

  clearTunnelSession(room.id, participantId);

  SSE.broadcast("participant.left", { participantId }, code);

  return managementJson({ success: true }, requestId);
}

function heartbeatParticipant(
  code: string,
  participantId: string,
  requestId: string
): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  const updated = Room.updateLastSeen(room.id, participantId);
  if (!updated) {
    return managementError(
      requestId,
      "PARTICIPANT_NOT_FOUND",
      "Participant not found.",
      "Check the participant id and retry.",
      404
    );
  }

  const participant = Room.getParticipant(room.id, participantId);
  const heartbeat: HeartbeatResult = {
    success: true,
    status: participant?.status ?? "online",
    lastSeen: participant?.lastSeen ?? Date.now(),
  };

  return managementJson(heartbeat, requestId);
}

function getParticipants(code: string, requestId: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  return managementJson(Room.getParticipants(room.id), requestId);
}

function listModels(code: string): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return error("Room not found", 404);
  }

  const participants = Room.getParticipants(room.id).filter(
    (participant) =>
      participant.connection.connected && participant.status !== "offline"
  );

  const models: GambiModel[] = participants.map((participant) => ({
    id: participant.id,
    object: "model" as const,
    created: Math.floor(participant.joinedAt / 1000),
    owned_by: participant.nickname,
    gambi: {
      nickname: participant.nickname,
      model: participant.model,
      endpoint: participant.endpoint,
      capabilities: participant.capabilities,
      connection: participant.connection,
    },
  }));

  const response: ModelsListResponse = { object: "list", data: models };
  return json(response);
}

export interface GambiModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  gambi: {
    nickname: string;
    model: string;
    endpoint: string;
    capabilities: ParticipantInfo["capabilities"];
    connection: ParticipantInfo["connection"];
  };
}

export interface ModelsListResponse {
  object: "list";
  data: GambiModel[];
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
  const records = Room.getParticipantRecords(roomId)
    .map((record) => record.info)
    .filter(
      (participant) =>
        participant.connection.connected &&
        participant.status !== "offline" &&
        getParticipantActiveRequestCount(roomId, participant.id) === 0
    );

  if (modelId === "*" || modelId === "any") {
    if (records.length === 0) {
      return undefined;
    }
    return records[Math.floor(Math.random() * records.length)];
  }

  if (modelId.startsWith("model:")) {
    const actualModel = modelId.slice(6);
    return records.find((participant) => participant.model === actualModel);
  }

  const participantRecord = Room.getParticipantRecord(roomId, modelId);
  if (
    participantRecord?.info.connection.connected &&
    participantRecord.info.status !== "offline" &&
    getParticipantActiveRequestCount(roomId, participantRecord.info.id) === 0
  ) {
    return participantRecord.info;
  }

  return records.find((participant) => participant.model === modelId);
}

function resolveParticipant(
  code: string,
  modelId: string
):
  | {
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
    const specificParticipant = Room.getParticipantRecord(
      room.id,
      modelId
    )?.info;
    if (
      specificParticipant &&
      getParticipantActiveRequestCount(room.id, modelId) > 0
    ) {
      return error("Participant is already handling another request.", 409);
    }

    if (specificParticipant && !specificParticipant.connection.connected) {
      return error("Participant tunnel is not connected.", 503);
    }

    return error("No available participant for the requested model", 404);
  }

  const participantRecord = Room.getParticipantRecord(room.id, participant.id);
  if (!participantRecord) {
    return error("Participant connection details not found", 404);
  }

  return {
    room,
    participant,
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

function broadcastLlmComplete(
  code: string,
  participant: ParticipantInfoInternal,
  params: {
    metrics?: ReturnType<typeof buildMetrics>;
    protocol: "openResponses" | "chatCompletions";
    requestId: string;
  }
): void {
  SSE.broadcast(
    "llm.complete",
    {
      requestId: params.requestId,
      participantId: participant.id,
      model: participant.model,
      protocol: params.protocol,
      metrics: params.metrics,
    },
    code
  );
  console.info("[gambi] llm.complete", {
    requestId: params.requestId,
    participantId: participant.id,
    roomCode: code,
    protocol: params.protocol,
    metrics: params.metrics,
  });
}

function broadcastLlmError(
  code: string,
  participant: ParticipantInfoInternal,
  params: {
    error: unknown;
    model: string;
    protocol: "openResponses" | "chatCompletions";
    requestId: string;
    stage: string;
  }
): void {
  SSE.broadcast(
    "llm.error",
    {
      requestId: params.requestId,
      participantId: participant.id,
      nickname: participant.nickname,
      endpoint: participant.endpoint,
      model: params.model,
      protocol: params.protocol,
      stage: params.stage,
      error: String(params.error),
    },
    code
  );
  console.error("[gambi] llm.error", {
    requestId: params.requestId,
    participantId: participant.id,
    roomCode: code,
    protocol: params.protocol,
    stage: params.stage,
    error: String(params.error),
  });
}

function wrapProxyLifecycleStream(
  response: Response,
  params: {
    code: string;
    participant: ParticipantInfoInternal;
    protocol: "openResponses" | "chatCompletions";
    requestId: string;
    requestStartedAt: number;
    roomId: string;
  }
): Response {
  const lifecycle: ProxyRequestLifecycle = {
    requestId: params.requestId,
    durationStartedAt: params.requestStartedAt,
  };

  if (!response.body) {
    finishParticipantProxyRequest(params.roomId, params.participant.id);
    broadcastLlmComplete(params.code, params.participant, {
      requestId: params.requestId,
      protocol: params.protocol,
      metrics: buildMetrics({
        completedAt: Date.now(),
        lifecycle,
      }),
    });
    return response;
  }

  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finishParticipantProxyRequest(params.roomId, params.participant.id);
          broadcastLlmComplete(params.code, params.participant, {
            requestId: params.requestId,
            protocol: params.protocol,
            metrics: buildMetrics({
              completedAt: Date.now(),
              lifecycle,
            }),
          });
          controller.close();
          return;
        }

        if (value) {
          lifecycle.firstByteAt ??= Date.now();
          controller.enqueue(value);
        }
      } catch (streamError) {
        finishParticipantProxyRequest(params.roomId, params.participant.id);
        broadcastLlmError(params.code, params.participant, {
          requestId: params.requestId,
          model: params.participant.model,
          protocol: params.protocol,
          stage: "stream",
          error: streamError,
        });
        controller.error(streamError);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    headers: response.headers,
  });
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
  participant: ParticipantInfoInternal,
  roomId: string,
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

  const response = await fetchParticipantThroughTunnel(
    participant,
    roomId,
    createTunnelRequest({
      method: "POST",
      operation: "chat.completions.create",
      path: "/v1/chat/completions",
      body: { ...chatRequest, model: participant.model },
      stream: body.stream,
    })
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
  participant: ParticipantInfoInternal,
  roomId: string,
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

  let operation = "responses.get";
  if (action === "cancel") {
    operation = "responses.cancel";
  } else if (action === "input_items") {
    operation = "responses.input_items";
  } else if (req.method === "DELETE") {
    operation = "responses.delete";
  }

  const response = await fetchParticipantThroughTunnel(
    participant,
    roomId,
    createTunnelRequest({
      method: method as "GET" | "POST" | "DELETE",
      operation,
      path,
    })
  );

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
  async create({ participant, request, entry }) {
    const response = await fetchParticipantThroughTunnel(
      participant,
      entry.roomId,
      createTunnelRequest({
        method: "POST",
        operation: "responses.create",
        path: "/v1/responses",
        body: { ...request, model: participant.model },
        stream: request.stream,
      })
    );

    if (isProtocolFallbackStatus(response.status)) {
      return ADAPTER_SKIP;
    }

    return forwardNativeResponsesCreate(response, request.stream, entry);
  },
  proxyStoredResponse({ action, entry, participant, req, responseId }) {
    return proxyStoredOpenResponses(
      req,
      participant,
      entry.roomId,
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
  create({ entry, participant, request }) {
    return proxyFallbackResponsesCreate(
      participant,
      entry.roomId,
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
  async create({ participant, request, roomId }) {
    const response = await fetchParticipantThroughTunnel(
      participant,
      roomId,
      createTunnelRequest({
        method: "POST",
        operation: "chat.completions.create",
        path: "/v1/chat/completions",
        body: { ...request, model: participant.model },
        stream: request.stream,
      })
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

  const { room, participant } = resolved;
  const request = applyResponsesDefaults(
    body,
    buildMergedDefaults(room.defaults, participant.config)
  );
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  const baseEntry = {
    participantId: participant.id,
    roomId: room.id,
  };

  beginParticipantProxyRequest(room.id, participant.id);
  SSE.broadcast(
    "llm.request",
    {
      requestId,
      participantId: participant.id,
      model: body.model,
      protocol: "openResponses",
    },
    code
  );
  console.info("[gambi] llm.request", {
    requestId,
    participantId: participant.id,
    roomCode: code,
    protocol: "openResponses",
    model: body.model,
  });

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
        entry,
        participant,
        request,
      });

      if (response !== ADAPTER_SKIP) {
        const protocol =
          adapter.id === "chatCompletions"
            ? "chatCompletions"
            : "openResponses";
        if (request.stream) {
          return wrapProxyLifecycleStream(response, {
            code,
            participant,
            protocol,
            requestId,
            requestStartedAt,
            roomId: room.id,
          });
        }

        const metrics = buildMetrics({
          completedAt: Date.now(),
          lifecycle: {
            requestId,
            durationStartedAt: requestStartedAt,
          },
          usage: tryParseMetricsFromBody(
            protocol,
            await response.clone().text()
          ),
        });
        finishParticipantProxyRequest(room.id, participant.id);
        broadcastLlmComplete(code, participant, {
          requestId,
          protocol,
          metrics,
        });
        return response;
      }
    }

    finishParticipantProxyRequest(room.id, participant.id);
    return error(
      "No compatible protocol adapter available for the requested Responses operation",
      501
    );
  } catch (proxyError) {
    finishParticipantProxyRequest(room.id, participant.id);
    broadcastLlmError(code, participant, {
      requestId,
      model: body.model,
      protocol: "openResponses",
      stage: "dispatch",
      error: proxyError,
    });
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

  const { room, participant } = resolved;
  const request = applyChatCompletionsDefaults(
    body,
    buildMergedDefaults(room.defaults, participant.config)
  );
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();

  beginParticipantProxyRequest(room.id, participant.id);
  SSE.broadcast(
    "llm.request",
    {
      requestId,
      participantId: participant.id,
      model: body.model,
      protocol: "chatCompletions",
    },
    code
  );
  console.info("[gambi] llm.request", {
    requestId,
    participantId: participant.id,
    roomCode: code,
    protocol: "chatCompletions",
    model: body.model,
  });

  try {
    const response = await chatCompletionsAdapter.create({
      participant,
      request,
      roomId: room.id,
    });

    if (request.stream) {
      return wrapProxyLifecycleStream(response, {
        code,
        participant,
        protocol: "chatCompletions",
        requestId,
        requestStartedAt,
        roomId: room.id,
      });
    }

    const metrics = buildMetrics({
      completedAt: Date.now(),
      lifecycle: {
        requestId,
        durationStartedAt: requestStartedAt,
      },
      usage: tryParseMetricsFromBody(
        "chatCompletions",
        await response.clone().text()
      ),
    });
    finishParticipantProxyRequest(room.id, participant.id);
    broadcastLlmComplete(code, participant, {
      requestId,
      protocol: "chatCompletions",
      metrics,
    });
    return response;
  } catch (proxyError) {
    finishParticipantProxyRequest(room.id, participant.id);
    broadcastLlmError(code, participant, {
      requestId,
      model: body.model,
      protocol: "chatCompletions",
      stage: "dispatch",
      error: proxyError,
    });
    return error(`Failed to proxy request: ${proxyError}`, 502);
  }
}

function getStoredParticipant(
  code: string,
  responseId: string
):
  | {
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

  const { entry, participant } = storedParticipant;
  const adapter = responsesLifecycleAdapters.get(entry.adapterId);
  if (!adapter?.proxyStoredResponse) {
    return getLifecycleUnsupportedResponse();
  }

  return await adapter.proxyStoredResponse({
    action,
    entry,
    participant,
    req,
    responseId,
  });
}

function sseEvents(
  code: string,
  requestId: string = crypto.randomUUID()
): Response {
  const room = Room.getByCode(code);
  if (!room) {
    return managementError(
      requestId,
      "ROOM_NOT_FOUND",
      "Room not found.",
      "Run 'gambi room list' to inspect available rooms.",
      404
    );
  }

  const clientId = crypto.randomUUID();
  return SSE.createResponse(clientId, code);
}

function hubHealth(requestId: string): Response {
  return managementJson({ status: "ok", timestamp: Date.now() }, requestId);
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
  code: string,
  _requesterIp: string | null
): Promise<Response> | Response | null {
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

function handleManagementRoomRoute(
  req: Request,
  method: string,
  path: string,
  code: string,
  requesterIp: string | null,
  requestId: string
): Promise<Response> | Response | null {
  if (path === `/v1/rooms/${code}` && method === "GET") {
    return getRoomSummary(code, requestId);
  }

  if (path === `/v1/rooms/${code}/participants` && method === "GET") {
    return getParticipants(code, requestId);
  }

  const participantMatch = path.match(MANAGEMENT_PARTICIPANT_PATH_REGEX);
  if (participantMatch?.[1] === code && participantMatch[2]) {
    const participantId = participantMatch[2];
    const isHeartbeat = path.endsWith("/heartbeat");

    if (method === "PUT" && !isHeartbeat) {
      return upsertParticipant(
        req,
        code,
        participantId,
        requesterIp,
        requestId
      );
    }

    if (method === "DELETE" && !isHeartbeat) {
      return leaveRoom(code, participantId, requestId);
    }

    if (method === "POST" && isHeartbeat) {
      return heartbeatParticipant(code, participantId, requestId);
    }
  }

  if (path === `/v1/rooms/${code}/events` && method === "GET") {
    return sseEvents(code, requestId);
  }

  return null;
}

export function createHub(options: HubOptions = {}): Hub {
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? "0.0.0.0";
  const enableMdns = options.mdns ?? false;

  let mdnsName: string | undefined;
  if (enableMdns) {
    mdnsName = `gambi-hub-${port}`;
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
        SSE.broadcast("participant.offline", { participantId }, room.code);
      }
    }

    clearExpiredTunnelBootstraps();
    const now = Date.now();
    for (const session of tunnelSessionRegistry.values()) {
      if (now - session.lastTunnelSeenAt > PARTICIPANT_TIMEOUT) {
        session.ws.close(4001, "Tunnel heartbeat timed out.");
      }
    }
  }, HEALTH_CHECK_INTERVAL);

  const server = Bun.serve<TunnelSocketData>({
    port,
    hostname,
    websocket: {
      data: {} as TunnelSocketData,
      message(ws, message) {
        const session = tunnelSessionRegistry.get(ws.data.sessionKey);
        if (!session) {
          return;
        }
        handleTunnelMessage(session, message);
      },
      open(ws) {
        const existing = tunnelSessionRegistry.get(ws.data.sessionKey);
        if (existing && existing.ws !== ws) {
          rejectPendingTunnelRequests(
            existing,
            "Participant tunnel superseded by a newer session."
          );
          existing.ws.close(1000, "Superseded by a newer tunnel session.");
        }

        tunnelSessionRegistry.set(ws.data.sessionKey, {
          ws,
          roomId: ws.data.roomId,
          roomCode: ws.data.roomCode,
          participantId: ws.data.participantId,
          pending: new Map(),
          lastTunnelSeenAt: Date.now(),
        });
        updateTunnelConnectionState(
          ws.data.roomId,
          ws.data.participantId,
          true
        );
      },
      close(ws) {
        clearTunnelSession(ws.data.roomId, ws.data.participantId, ws);
      },
    },
    fetch(req) {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;
      const requestId = crypto.randomUUID();

      if (method === "OPTIONS") {
        return corsHeaders();
      }

      if (path === "/v1/health" && method === "GET") {
        return hubHealth(requestId);
      }

      if (path === "/v1/rooms" && method === "POST") {
        return createRoom(req, requestId);
      }
      if (path === "/v1/rooms" && method === "GET") {
        return listRooms(requestId);
      }

      const tunnelMatch = path.match(MANAGEMENT_PARTICIPANT_TUNNEL_PATH_REGEX);
      if (tunnelMatch?.[1] && tunnelMatch[2] && method === "GET") {
        const roomCode = tunnelMatch[1];
        const participantId = tunnelMatch[2];
        const room = Room.getByCode(roomCode);
        if (!room) {
          return managementError(
            requestId,
            "ROOM_NOT_FOUND",
            "Room not found.",
            "Run 'gambi room list' to inspect available rooms.",
            404
          );
        }

        const participant = Room.getParticipantRecord(
          room.id,
          participantId
        )?.info;
        if (!participant) {
          return managementError(
            requestId,
            "PARTICIPANT_NOT_FOUND",
            "Participant not found.",
            "Check the participant id and retry.",
            404
          );
        }

        const token = url.searchParams.get("token");
        if (!token) {
          return managementError(
            requestId,
            "INVALID_REQUEST",
            "Tunnel token is required.",
            "Reconnect using the bootstrap token returned during join.",
            400
          );
        }

        const bootstrap = getTunnelBootstrap(token);
        if (
          !bootstrap ||
          bootstrap.roomId !== room.id ||
          bootstrap.roomCode !== roomCode ||
          bootstrap.participantId !== participantId
        ) {
          return managementError(
            requestId,
            "INVALID_REQUEST",
            "Tunnel token is invalid or expired.",
            "Re-register the participant and retry the tunnel connection.",
            401
          );
        }

        const upgraded = server.upgrade(req, {
          data: {
            roomId: room.id,
            roomCode,
            participantId,
            sessionKey: getTunnelSessionKey(room.id, participantId),
          },
        });
        if (!upgraded) {
          return managementError(
            requestId,
            "INTERNAL_ERROR",
            "Failed to upgrade the participant tunnel.",
            "Retry the join operation."
          );
        }

        consumeTunnelBootstrap(token);
        return;
      }

      const managementRoomMatch = path.match(MANAGEMENT_ROOM_PATH_REGEX);
      if (managementRoomMatch?.[1]) {
        const requesterIp = getRequesterIp(req, server);
        const result = handleManagementRoomRoute(
          req,
          method,
          path,
          managementRoomMatch[1],
          requesterIp,
          requestId
        );
        if (result) {
          return result;
        }
      }

      const roomMatch = path.match(ROOM_PATH_REGEX);
      if (roomMatch?.[1]) {
        const requesterIp = getRequesterIp(req, server);
        const result = handleRoomRoute(
          req,
          method,
          path,
          roomMatch[1],
          requesterIp
        );
        if (result) {
          return result;
        }
      }

      return managementError(
        requestId,
        "INVALID_REQUEST",
        "Route not found.",
        "Check the requested path and HTTP method.",
        404
      );
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
      tunnelBootstrapRegistry.clear();
      for (const session of tunnelSessionRegistry.values()) {
        session.ws.close(1001, "Hub shutting down.");
      }
      tunnelSessionRegistry.clear();
      participantActiveRequests.clear();
      clearResponseRegistry();
      Room.clear();
      SSE.closeAll();
      server.stop();
    },
  };
}
