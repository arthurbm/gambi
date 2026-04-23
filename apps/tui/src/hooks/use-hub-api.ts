import {
  type MachineSpecs,
  type ParticipantAuthHeaders,
  type ParticipantCapabilities,
  ParticipantInfo,
  RoomSummary,
  type RuntimeConfig,
} from "@gambi/core/types";
import { useCallback } from "react";
import { z } from "zod";
import { useAppStore } from "../store/app-store";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

// Response schemas for validation
const HealthResponse = z.object({
  status: z.literal("ok"),
  timestamp: z.number(),
});

const CreateRoomResponse = z.object({
  room: RoomSummary,
  hostId: z.string(),
});

const ListRoomsResponse = z.array(RoomSummary);

const JoinRoomResponse = z.object({
  participant: ParticipantInfo,
  roomId: z.string(),
});

const SuccessResponse = z.object({
  success: z.literal(true),
});

const ParticipantsResponse = z.array(ParticipantInfo);

// Inferred types
type HealthResponse = z.infer<typeof HealthResponse>;
type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;
type ListRoomsResponse = z.infer<typeof ListRoomsResponse>;
type JoinRoomResponse = z.infer<typeof JoinRoomResponse>;
type SuccessResponse = z.infer<typeof SuccessResponse>;
type ParticipantsResponse = z.infer<typeof ParticipantsResponse>;

// Participant data for joining
export interface JoinParticipantData {
  id: string;
  nickname: string;
  model: string;
  endpoint: string;
  password?: string;
  specs?: z.infer<typeof MachineSpecs>;
  config?: RuntimeConfig;
  capabilities?: ParticipantCapabilities;
  authHeaders?: ParticipantAuthHeaders;
}

export interface CreateRoomData {
  defaults?: RuntimeConfig;
  name: string;
  password?: string;
}

export interface UseHubApiReturn {
  checkHub: () => Promise<ApiResult<HealthResponse>>;
  listRooms: () => Promise<ApiResult<ListRoomsResponse>>;
  createRoom: (data: CreateRoomData) => Promise<ApiResult<CreateRoomResponse>>;
  joinRoom: (
    code: string,
    participantData: JoinParticipantData
  ) => Promise<ApiResult<JoinRoomResponse>>;
  leaveRoom: (
    code: string,
    participantId: string
  ) => Promise<ApiResult<SuccessResponse>>;
  healthCheck: (
    code: string,
    participantId: string
  ) => Promise<ApiResult<SuccessResponse>>;
  getParticipants: (code: string) => Promise<ApiResult<ParticipantsResponse>>;
}

// ============================================================================
// Helper Functions (exported for testing)
// ============================================================================

export function createErrorResult<T>(error: string): ApiResult<T> {
  return { data: null, error };
}

export function createSuccessResult<T>(data: T): ApiResult<T> {
  return { data, error: null };
}

export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage =
        (errorBody as { error?: { message?: string } }).error?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
      return createErrorResult(errorMessage);
    }

    const envelope: unknown = await response.json();
    const rawData =
      envelope && typeof envelope === "object" && "data" in envelope
        ? (envelope as { data: unknown }).data
        : envelope;
    const parsed = schema.safeParse(rawData);

    if (!parsed.success) {
      return createErrorResult(`Invalid response: ${parsed.error.message}`);
    }

    return createSuccessResult(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return createErrorResult(message);
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useHubApi(): UseHubApiReturn {
  const hubUrl = useAppStore((s) => s.hubUrl);

  const checkHub = useCallback(
    (): Promise<ApiResult<HealthResponse>> =>
      fetchJson(`${hubUrl}/v1/health`, HealthResponse),
    [hubUrl]
  );

  const listRooms = useCallback(
    (): Promise<ApiResult<ListRoomsResponse>> =>
      fetchJson(`${hubUrl}/v1/rooms`, ListRoomsResponse),
    [hubUrl]
  );

  const createRoom = useCallback(
    (data: CreateRoomData): Promise<ApiResult<CreateRoomResponse>> =>
      fetchJson(`${hubUrl}/v1/rooms`, CreateRoomResponse, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    [hubUrl]
  );

  const joinRoom = useCallback(
    (
      code: string,
      participantData: JoinParticipantData
    ): Promise<ApiResult<JoinRoomResponse>> =>
      fetchJson(
        `${hubUrl}/v1/rooms/${code}/participants/${participantData.id}`,
        JoinRoomResponse,
        {
          method: "PUT",
          body: JSON.stringify(participantData),
        }
      ),
    [hubUrl]
  );

  const leaveRoom = useCallback(
    (
      code: string,
      participantId: string
    ): Promise<ApiResult<SuccessResponse>> =>
      fetchJson(
        `${hubUrl}/v1/rooms/${code}/participants/${participantId}`,
        SuccessResponse,
        {
          method: "DELETE",
        }
      ),
    [hubUrl]
  );

  const healthCheck = useCallback(
    (
      code: string,
      participantId: string
    ): Promise<ApiResult<SuccessResponse>> =>
      fetchJson(
        `${hubUrl}/v1/rooms/${code}/participants/${participantId}/heartbeat`,
        SuccessResponse,
        {
          method: "POST",
        }
      ),
    [hubUrl]
  );

  const getParticipants = useCallback(
    (code: string): Promise<ApiResult<ParticipantsResponse>> =>
      fetchJson(
        `${hubUrl}/v1/rooms/${code}/participants`,
        ParticipantsResponse
      ),
    [hubUrl]
  );

  return {
    checkHub,
    listRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    healthCheck,
    getParticipants,
  };
}
