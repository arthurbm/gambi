import {
  type DiscoveredRoom,
  type DiscoveryOptions,
  discoverRooms,
} from "@gambi/core/discovery";

export type { DiscoveredRoom } from "@gambi/core/discovery";

export interface DiscoverRoomsOnNetworkOptions
  extends Omit<DiscoveryOptions, "hubUrl"> {
  seedHubUrl: string;
}

export function discoverRoomsOnNetwork(
  options: DiscoverRoomsOnNetworkOptions
): Promise<DiscoveredRoom[]> {
  return discoverRooms({
    browseServices: options.browseServices,
    fetchFn: options.fetchFn,
    hubUrl: options.seedHubUrl,
    timeoutMs: options.timeoutMs,
  });
}

export const roomDiscovery = {
  discoverRoomsOnNetwork,
} as const;
