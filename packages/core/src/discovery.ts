import { type DiscoveredService, mDNS } from "./mdns.ts";
import type { RoomInfoPublic } from "./types.ts";

const DEFAULT_HUB_NAME = "Configured hub";
const DEFAULT_HUB_URL = "http://localhost:3000";
const TRAILING_SLASH_REGEX = /\/$/;

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

type BrowseServicesLike = (
  callback: (service: DiscoveredService) => void
) => (() => void | Promise<void>) | void | Promise<void>;

interface RoomInfoWithParticipantCount extends RoomInfoPublic {
  participantCount: number;
}

interface HealthResponse {
  status: string;
  timestamp: number;
}

interface ListRoomsResponse {
  rooms: RoomInfoWithParticipantCount[];
}

export interface DiscoveredHub {
  addresses: string[];
  host: string;
  hubUrl: string;
  name: string;
  port: number;
  source: "configured" | "mdns";
  txt: Record<string, string>;
}

export interface DiscoveredRoom extends RoomInfoWithParticipantCount {
  hubName: string;
  hubSource: DiscoveredHub["source"];
  hubUrl: string;
}

export interface DiscoveryOptions {
  browseServices?: BrowseServicesLike;
  fetchFn?: FetchLike;
  hubUrl?: string;
  timeoutMs?: number;
}

export interface ResolveGambiTargetOptions extends DiscoveryOptions {
  roomCode?: string;
  roomName?: string;
}

export interface ResolvedGambiTarget {
  hub: DiscoveredHub;
  hubName: string;
  hubUrl: string;
  room: DiscoveredRoom;
  roomCode: string;
  roomName: string;
}

export class DiscoveryError extends Error {
  readonly code:
    | "NO_HUBS_FOUND"
    | "NO_ROOMS_FOUND"
    | "ROOM_NOT_FOUND"
    | "AMBIGUOUS_ROOM_MATCH";
  readonly matches: DiscoveredRoom[];

  constructor(
    code: DiscoveryError["code"],
    message: string,
    matches: DiscoveredRoom[] = []
  ) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.matches = matches;
  }
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

function getHubPort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }

  return url.protocol === "https:" ? 443 : 80;
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

async function fetchHubHealth(
  hubUrl: string,
  fetchFn: FetchLike
): Promise<HealthResponse | null> {
  try {
    const response = await fetchFn(`${hubUrl}/health`);
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
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

async function discoverRoomsFromHubs(
  hubs: DiscoveredHub[],
  fetchFn: FetchLike
): Promise<DiscoveredRoom[]> {
  const rooms = new Map<string, DiscoveredRoom>();

  for (const hub of hubs) {
    const discoveredRooms = await fetchRoomsFromHub(hub.hubUrl, fetchFn);
    if (!discoveredRooms) {
      continue;
    }

    for (const room of discoveredRooms) {
      if (rooms.has(room.id)) {
        continue;
      }

      rooms.set(room.id, {
        ...room,
        hubName: hub.name,
        hubSource: hub.source,
        hubUrl: hub.hubUrl,
      });
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

async function resolveHub(
  candidate: Omit<DiscoveredHub, "hubUrl">,
  urls: string[],
  fetchFn: FetchLike
): Promise<DiscoveredHub | null> {
  for (const hubUrl of urls) {
    const health = await fetchHubHealth(hubUrl, fetchFn);
    if (!health) {
      continue;
    }

    return {
      ...candidate,
      hubUrl,
    };
  }

  return null;
}

function createConfiguredHubCandidate(hubUrl: string): {
  candidate: Omit<DiscoveredHub, "hubUrl">;
  urls: string[];
} {
  const parsedUrl = new URL(normalizeHubUrl(hubUrl));
  const normalizedHubUrl = normalizeHubUrl(parsedUrl.toString());

  return {
    candidate: {
      addresses: [],
      host: parsedUrl.hostname,
      name: DEFAULT_HUB_NAME,
      port: getHubPort(parsedUrl),
      source: "configured",
      txt: {},
    },
    urls: [normalizedHubUrl],
  };
}

function createMdnsHubCandidate(service: DiscoveredService): {
  candidate: Omit<DiscoveredHub, "hubUrl">;
  urls: string[];
} {
  return {
    candidate: {
      addresses: service.addresses,
      host: service.host,
      name: service.name,
      port: service.port,
      source: "mdns",
      txt: service.txt,
    },
    urls: getHubCandidateUrls(service),
  };
}

export async function discoverHubs(
  options: DiscoveryOptions = {}
): Promise<DiscoveredHub[]> {
  const browseServices = options.browseServices ?? mDNS.browse;
  const fetchFn = options.fetchFn ?? fetch;
  const hubUrl = options.hubUrl ?? DEFAULT_HUB_URL;
  const timeoutMs = options.timeoutMs ?? 1500;
  const services: DiscoveredService[] = [];
  let stopBrowsing: () => void | Promise<void> = () => undefined;
  let didStartBrowsing = false;

  try {
    stopBrowsing =
      (await browseServices((service) => {
        services.push(service);
      })) ?? stopBrowsing;
    didStartBrowsing = true;
  } catch {
    // Ignore mDNS browse errors; discovery will proceed with configured hub only.
  }

  try {
    if (didStartBrowsing) {
      await wait(timeoutMs);
    }
  } finally {
    try {
      await stopBrowsing();
    } catch {
      // mDNS cleanup must not prevent configured-hub discovery.
    }
  }

  const hubCandidates = [
    createConfiguredHubCandidate(hubUrl),
    ...services.map(createMdnsHubCandidate),
  ];

  const hubs = new Map<string, DiscoveredHub>();
  for (const { candidate, urls } of hubCandidates) {
    const resolvedHub = await resolveHub(candidate, urls, fetchFn);
    if (!(resolvedHub && !hubs.has(resolvedHub.hubUrl))) {
      continue;
    }
    hubs.set(resolvedHub.hubUrl, resolvedHub);
  }

  return [...hubs.values()];
}

export async function discoverRooms(
  options: DiscoveryOptions = {}
): Promise<DiscoveredRoom[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const hubs = await discoverHubs(options);
  return discoverRoomsFromHubs(hubs, fetchFn);
}

export async function resolveGambiTarget(
  options: ResolveGambiTargetOptions = {}
): Promise<ResolvedGambiTarget> {
  const fetchFn = options.fetchFn ?? fetch;
  const hubs = await discoverHubs(options);

  if (hubs.length === 0) {
    throw new DiscoveryError(
      "NO_HUBS_FOUND",
      "No hubs were found on the configured hub or local network."
    );
  }

  const rooms = await discoverRoomsFromHubs(hubs, fetchFn);

  if (rooms.length === 0) {
    throw new DiscoveryError(
      "NO_ROOMS_FOUND",
      "No rooms were found on the configured hub or local network."
    );
  }

  const matchingRooms = rooms.filter((room) => {
    if (options.roomCode && room.code !== options.roomCode) {
      return false;
    }

    if (options.roomName && room.name !== options.roomName) {
      return false;
    }

    return true;
  });

  if (matchingRooms.length === 0) {
    if (options.roomCode || options.roomName) {
      throw new DiscoveryError(
        "ROOM_NOT_FOUND",
        "No discovered room matched the requested room code or room name."
      );
    }

    throw new DiscoveryError(
      "AMBIGUOUS_ROOM_MATCH",
      "Multiple rooms were discovered. Use discoverRooms() to choose one explicitly.",
      rooms
    );
  }

  if (matchingRooms.length > 1) {
    throw new DiscoveryError(
      "AMBIGUOUS_ROOM_MATCH",
      "Multiple discovered rooms matched the requested room code or room name.",
      matchingRooms
    );
  }

  const room = matchingRooms[0];
  if (!room) {
    throw new DiscoveryError(
      "ROOM_NOT_FOUND",
      "No discovered room matched the requested room code or room name."
    );
  }

  const hub = hubs.find((candidate) => candidate.hubUrl === room.hubUrl);
  if (!hub) {
    throw new DiscoveryError(
      "NO_HUBS_FOUND",
      "The room was discovered, but the corresponding hub could not be resolved."
    );
  }

  return {
    hub,
    hubName: hub.name,
    hubUrl: room.hubUrl,
    room,
    roomCode: room.code,
    roomName: room.name,
  };
}
