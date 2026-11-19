import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateRoomData } from "../../hub-client";
import { useHubClient } from "../use-hub-client";

export type { CreateRoomData } from "../../hub-client";

// ============================================================================
// Query Keys Factory
// ============================================================================

export const roomKeys = {
  all: ["rooms"] as const,
  list: () => [...roomKeys.all, "list"] as const,
};

// ============================================================================
// Queries
// ============================================================================

export function useRoomsList() {
  const client = useHubClient();

  return useQuery({
    queryKey: roomKeys.list(),
    queryFn: () => client.rooms.list(),
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateRoom() {
  const client = useHubClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRoomData) => client.rooms.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}
