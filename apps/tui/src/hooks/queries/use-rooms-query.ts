import {
  type MachineSpecs,
  type ParticipantAuthHeaders,
  type ParticipantCapabilities,
  ParticipantInfo,
  RoomInfoPublic,
  type RuntimeConfig,
} from "@gambi/core/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAppStore } from "../../store/app-store";

// ============================================================================
// Schemas
// ============================================================================

const ListRoomsResponse = z.object({
  rooms: z.array(
    RoomInfoPublic.extend({
      participantCount: z.number().optional(),
    })
  ),
});

const CreateRoomResponse = z.object({
  room: RoomInfoPublic,
  hostId: z.string(),
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

// ============================================================================
// Types
// ============================================================================

export type ListRoomsResponse = z.infer<typeof ListRoomsResponse>;
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;
export type JoinRoomResponse = z.infer<typeof JoinRoomResponse>;
export type ParticipantsResponse = z.infer<typeof ParticipantsResponse>;

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

// ============================================================================
// Query Keys Factory
// ============================================================================

export const roomKeys = {
  all: ["rooms"] as const,
  list: () => [...roomKeys.all, "list"] as const,
  participants: (code: string) =>
    [...roomKeys.all, code, "participants"] as const,
};

// ============================================================================
// Helper
// ============================================================================

async function fetchAndParse<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: RequestInit
): Promise<T> {
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
    throw new Error(errorMessage);
  }

  const data: unknown = await response.json();
  return schema.parse(data);
}

// ============================================================================
// Queries
// ============================================================================

export function useRoomsList() {
  const hubUrl = useAppStore((s) => s.hubUrl);

  return useQuery({
    queryKey: roomKeys.list(),
    queryFn: () => fetchAndParse(`${hubUrl}/rooms`, ListRoomsResponse),
  });
}

export function useParticipants(roomCode: string) {
  const hubUrl = useAppStore((s) => s.hubUrl);

  return useQuery({
    queryKey: roomKeys.participants(roomCode),
    queryFn: () =>
      fetchAndParse(
        `${hubUrl}/rooms/${roomCode}/participants`,
        ParticipantsResponse
      ),
    enabled: Boolean(roomCode),
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateRoom() {
  const hubUrl = useAppStore((s) => s.hubUrl);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRoomData) =>
      fetchAndParse(`${hubUrl}/rooms`, CreateRoomResponse, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}

export function useJoinRoom() {
  const hubUrl = useAppStore((s) => s.hubUrl);

  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: JoinParticipantData }) =>
      fetchAndParse(`${hubUrl}/rooms/${code}/join`, JoinRoomResponse, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useLeaveRoom() {
  const hubUrl = useAppStore((s) => s.hubUrl);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      code,
      participantId,
    }: {
      code: string;
      participantId: string;
    }) =>
      fetchAndParse(
        `${hubUrl}/rooms/${code}/leave/${participantId}`,
        SuccessResponse,
        { method: "DELETE" }
      ),
    onSuccess: (_data, { code }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.participants(code) });
    },
  });
}

export function useHealthCheck() {
  const hubUrl = useAppStore((s) => s.hubUrl);

  return useMutation({
    mutationFn: ({
      code,
      participantId,
    }: {
      code: string;
      participantId: string;
    }) =>
      fetchAndParse(`${hubUrl}/rooms/${code}/health`, SuccessResponse, {
        method: "POST",
        body: JSON.stringify({ id: participantId }),
      }),
  });
}
