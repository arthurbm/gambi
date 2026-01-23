import {
  type GenerationConfig,
  type MachineSpecs,
  ParticipantInfo,
  RoomInfoPublic,
} from "@gambiarra/core/types";
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
  room: RoomInfoPublic,
  hostId: z.string(),
});

const ListRoomsResponse = z.object({
  rooms: z.array(
    RoomInfoPublic.extend({
      participantCount: z.number().optional(),
    })
  ),
});

const JoinRoomResponse = z.object({
  participant: ParticipantInfo,
  roomId: z.string(),
});

const SuccessResponse = z.object({
  success: z.literal(true),
});

const ParticipantsResponse = z.object({
  participants: z.array(ParticipantInfo),
});

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
  config?: z.infer<typeof GenerationConfig>;
}

export interface UseHubApiReturn {
  checkHub: () => Promise<ApiResult<HealthResponse>>;
  listRooms: () => Promise<ApiResult<ListRoomsResponse>>;
  createRoom: (
    name: string,
    password?: string
  ) => Promise<ApiResult<CreateRoomResponse>>;
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
// Helper Functions
// ============================================================================

function createErrorResult<T>(error: string): ApiResult<T> {
  return { data: null, error };
}

function createSuccessResult<T>(data: T): ApiResult<T> {
  return { data, error: null };
}

async function fetchJson<T>(
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
        (errorBody as { error?: string }).error ||
        `HTTP ${response.status}: ${response.statusText}`;
      return createErrorResult(errorMessage);
    }

    const data: unknown = await response.json();
    const parsed = schema.safeParse(data);

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
      fetchJson(`${hubUrl}/health`, HealthResponse),
    [hubUrl]
  );

  const listRooms = useCallback(
    (): Promise<ApiResult<ListRoomsResponse>> =>
      fetchJson(`${hubUrl}/rooms`, ListRoomsResponse),
    [hubUrl]
  );

  const createRoom = useCallback(
    (name: string, password?: string): Promise<ApiResult<CreateRoomResponse>> =>
      fetchJson(`${hubUrl}/rooms`, CreateRoomResponse, {
        method: "POST",
        body: JSON.stringify({ name, password }),
      }),
    [hubUrl]
  );

  const joinRoom = useCallback(
    (
      code: string,
      participantData: JoinParticipantData
    ): Promise<ApiResult<JoinRoomResponse>> =>
      fetchJson(`${hubUrl}/rooms/${code}/join`, JoinRoomResponse, {
        method: "POST",
        body: JSON.stringify(participantData),
      }),
    [hubUrl]
  );

  const leaveRoom = useCallback(
    (
      code: string,
      participantId: string
    ): Promise<ApiResult<SuccessResponse>> =>
      fetchJson(
        `${hubUrl}/rooms/${code}/leave/${participantId}`,
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
      fetchJson(`${hubUrl}/rooms/${code}/health`, SuccessResponse, {
        method: "POST",
        body: JSON.stringify({ id: participantId }),
      }),
    [hubUrl]
  );

  const getParticipants = useCallback(
    (code: string): Promise<ApiResult<ParticipantsResponse>> =>
      fetchJson(`${hubUrl}/rooms/${code}/participants`, ParticipantsResponse),
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
