import { type DiscoveredService, mDNS } from "@gambi/core/mdns";
import type { RoomInfoPublic } from "@gambi/core/types";

const TRAILING_SLASH_REGEX = /\/$/;

interface RoomInfoWithParticipantCount extends RoomInfoPublic {
  participantCount: number;
}

interface ListRoomsResponse {
  rooms: RoomInfoWithParticipantCount[];
}

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

export interface DiscoveredRoom extends RoomInfoWithParticipantCount {
  hubName: string;
  hubUrl: string;
}

export interface DiscoverRoomsOnNetworkOptions {
  browseServices?: (
    callback: (service: DiscoveredService) => void
  ) => () => void | Promise<void>;
  fetchFn?: FetchLike;
  seedHubUrl: string;
  timeoutMs?: number;
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function normalizeHostname(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

function formatUrlHost(hostname: string): string {
  if (hostname.includes(":") && !hostname.startsWith("[")) {
    return `[${hostname}]`;
  }

  return hostname;
}

function normalizeHubUrl(url: string): string {
  const normalizedUrl = new URL(url);
  normalizedUrl.pathname = "";
  normalizedUrl.search = "";
  normalizedUrl.hash = "";
  return normalizedUrl.toString().replace(TRAILING_SLASH_REGEX, "");
}

function getHubCandidateUrls(service: DiscoveredService): string[] {
  const hosts = [
    ...service.addresses.map(normalizeHostname),
    normalizeHostname(service.host),
  ].filter(Boolean);

  return [...new Set(hosts)].map(
    (host) => `http://${formatUrlHost(host)}:${service.port}`
  );
}

async function fetchRoomsFromHub(
  hubUrl: string,
  fetchFn: FetchLike
): Promise<RoomInfoWithParticipantCount[] | null> {
  try {
    const response = await fetchFn(`${hubUrl}/rooms`);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ListRoomsResponse;
    return Array.isArray(data.rooms) ? data.rooms : [];
  } catch {
    return null;
  }
}

async function resolveHubRooms(
  candidates: { label: string; urls: string[] },
  fetchFn: FetchLike
): Promise<DiscoveredRoom[]> {
  for (const hubUrl of candidates.urls) {
    const rooms = await fetchRoomsFromHub(hubUrl, fetchFn);
    if (rooms === null) {
      continue;
    }

    return rooms.map((room) => ({
      ...room,
      hubName: candidates.label,
      hubUrl,
    }));
  }

  return [];
}

export async function discoverRoomsOnNetwork(
  options: DiscoverRoomsOnNetworkOptions
): Promise<DiscoveredRoom[]> {
  const browseServices = options.browseServices ?? mDNS.browse;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1500;
  const services: DiscoveredService[] = [];
  const stopBrowsing = browseServices((service) => {
    services.push(service);
  });

  try {
    await wait(timeoutMs);
  } finally {
    await stopBrowsing();
  }

  const discoveredHubs = [
    {
      label: "Configured hub",
      urls: [normalizeHubUrl(options.seedHubUrl)],
    },
    ...services.map((service) => ({
      label: service.name,
      urls: getHubCandidateUrls(service),
    })),
  ];

  const rooms = new Map<string, DiscoveredRoom>();
  for (const hub of discoveredHubs) {
    const discoveredRooms = await resolveHubRooms(hub, fetchFn);
    for (const room of discoveredRooms) {
      if (!rooms.has(room.id)) {
        rooms.set(room.id, room);
      }
    }
  }

  return [...rooms.values()].sort((left, right) => {
    const participantCountDiff = right.participantCount - left.participantCount;
    if (participantCountDiff !== 0) {
      return participantCountDiff;
    }

    return left.name.localeCompare(right.name);
  });
}

export const roomDiscovery = {
  discoverRoomsOnNetwork,
} as const;
