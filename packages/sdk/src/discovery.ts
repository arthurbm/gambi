/**
 * `gambi-sdk/discovery`: finds hubs and rooms on the local network, over mDNS
 * and the management plane. It is an entry of its own because mDNS opens UDP
 * sockets, which the default entry must not bring.
 */
import { type ManagementClient, makeManagementClient } from "@gambi/protocol";
import type { Service } from "bonjour-service";
import BonjourDefault, { Bonjour as BonjourNamed } from "bonjour-service";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import type { RoomSummary } from "./types.ts";

const DEFAULT_HUB_NAME = "Configured hub";
const DEFAULT_HUB_URL = "http://localhost:3000";
const TRAILING_SLASH_REGEX = /\/$/;

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

/** A hub announced over mDNS, before it answered anything. */
export interface DiscoveredService {
  addresses: string[];
  host: string;
  name: string;
  port: number;
  txt: Record<string, string>;
}

// The default and the named export differ between the bundler and the runtime.
const Bonjour =
  BonjourNamed ??
  (typeof BonjourDefault === "function" ? BonjourDefault : undefined);

/** Browses the hubs announced on the local network until the returned function is called. */
function browseMdns(
  callback: (service: DiscoveredService) => void
): () => void {
  if (typeof Bonjour !== "function") {
    throw new TypeError(
      "bonjour-service did not expose a usable Bonjour constructor"
    );
  }
  const bonjour = new Bonjour();
  const browser = bonjour.find(
    { type: "gambi" },
    (service: Service & { addresses?: string[] }) => {
      callback({
        addresses: service.addresses ?? [],
        host: service.host,
        name: service.name,
        port: service.port,
        txt: (service.txt ?? {}) as Record<string, string>,
      });
    }
  );
  return () => {
    browser.stop();
    bonjour.destroy();
  };
}

type BrowseServicesLike = (
  callback: (service: DiscoveredService) => void
) => (() => void | Promise<void>) | void | Promise<void>;

export interface DiscoveredHub {
  addresses: string[];
  host: string;
  hubUrl: string;
  name: string;
  port: number;
  source: "configured" | "mdns";
  txt: Record<string, string>;
}

export interface DiscoveredRoom extends RoomSummary {
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

/** Probe candidates through the same validated contract used for management. */
const probeHub = <A, E>(
  hubUrl: string,
  fetchFn: FetchLike,
  operation: (client: ManagementClient) => Effect.Effect<A, E>
) =>
  makeManagementClient(hubUrl).pipe(
    Effect.flatMap(operation),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetchFn as typeof fetch),
    Effect.match({ onFailure: () => null, onSuccess: (value) => value }),
    Effect.runPromise
  );

async function discoverRoomsFromHubs(
  hubs: DiscoveredHub[],
  fetchFn: FetchLike
): Promise<DiscoveredRoom[]> {
  const rooms = new Map<string, DiscoveredRoom>();

  for (const hub of hubs) {
    const discoveredRooms = await probeHub(hub.hubUrl, fetchFn, (client) =>
      client.rooms.list()
    );
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
    const health = await probeHub(hubUrl, fetchFn, (client) =>
      client.hub.health()
    );
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
  const browseServices = options.browseServices ?? browseMdns;
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
