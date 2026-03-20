import { networkInterfaces } from "node:os";

export interface NetworkCandidate {
  address: string;
  interfaceName: string;
}

const IPV4_FAMILY = "IPv4";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const UNSPECIFIED_HOSTS = new Set(["0.0.0.0", "::"]);

function getIpv4Octets(address: string): number[] | null {
  const segments = address.split(".");
  if (segments.length !== 4) {
    return null;
  }

  const octets = segments.map((segment) => Number(segment));
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255
  )
    ? octets
    : null;
}

function isLinkLocalIpv4(address: string): boolean {
  const octets = getIpv4Octets(address);
  return octets !== null && octets[0] === 169 && octets[1] === 254;
}

function isPrivateIpv4(address: string): boolean {
  const octets = getIpv4Octets(address);
  if (octets === null) {
    return false;
  }

  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) {
    return false;
  }

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isSameSubnet24(left: string, right: string): boolean {
  const leftOctets = getIpv4Octets(left);
  const rightOctets = getIpv4Octets(right);
  if (!(leftOctets && rightOctets)) {
    return false;
  }

  return (
    leftOctets[0] === rightOctets[0] &&
    leftOctets[1] === rightOctets[1] &&
    leftOctets[2] === rightOctets[2]
  );
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function isUnspecifiedHost(hostname: string): boolean {
  return UNSPECIFIED_HOSTS.has(hostname.toLowerCase());
}

export function isLoopbackLikeHost(hostname: string): boolean {
  return isLoopbackHost(hostname) || isUnspecifiedHost(hostname);
}

export function isRemoteHubUrl(hubUrl: string): boolean {
  const { hostname } = new URL(hubUrl);
  return !isLoopbackLikeHost(hostname);
}

export function listNetworkCandidates(): NetworkCandidate[] {
  const candidates: NetworkCandidate[] = [];
  const interfaces = networkInterfaces();

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (
        entry.family !== IPV4_FAMILY ||
        entry.internal ||
        isLinkLocalIpv4(entry.address)
      ) {
        continue;
      }

      candidates.push({
        interfaceName,
        address: entry.address,
      });
    }
  }

  return candidates;
}

export function rankNetworkCandidatesForHub(
  hubUrl: string,
  candidates: NetworkCandidate[]
): NetworkCandidate[] {
  const { hostname } = new URL(hubUrl);

  const sameSubnet = candidates.filter((candidate) =>
    isSameSubnet24(candidate.address, hostname)
  );
  if (sameSubnet.length > 0) {
    return sameSubnet;
  }

  if (isPrivateIpv4(hostname)) {
    const privateCandidates = candidates.filter((candidate) =>
      isPrivateIpv4(candidate.address)
    );
    if (privateCandidates.length > 0) {
      return privateCandidates;
    }
  }

  return candidates;
}

export function replaceEndpointHost(
  endpoint: string,
  hostname: string
): string {
  const url = new URL(endpoint);
  url.hostname = hostname;
  return url.toString();
}
