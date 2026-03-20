import { describe, expect, test } from "bun:test";
import type { DiscoveredService } from "@gambi/core/mdns";
import {
  createGambi,
  type DiscoveryError,
  discoverHubs,
  type discoverRooms,
  resolveGambiTarget,
} from "./index.ts";

type FetchLike = NonNullable<Parameters<typeof discoverRooms>[0]["fetchFn"]>;

const alphaRoom = {
  id: "room-alpha",
  code: "ABC123",
  name: "Alpha",
  hostId: "host-alpha",
  createdAt: 1,
  participantCount: 2,
};

const betaRoom = {
  id: "room-beta",
  code: "XYZ999",
  name: "Beta",
  hostId: "host-beta",
  createdAt: 2,
  participantCount: 1,
};

function createBrowseServices(services: DiscoveredService[]) {
  return (callback: (service: DiscoveredService) => void) => {
    for (const service of services) {
      callback(service);
    }

    return () => undefined;
  };
}

describe("SDK discovery", () => {
  test("discovers configured and mDNS hubs", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/health") {
        return Promise.resolve(
          Response.json({ status: "ok", timestamp: Date.now() })
        );
      }

      if (url === "http://192.168.1.40:3100/health") {
        return Promise.resolve(
          Response.json({ status: "ok", timestamp: Date.now() })
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const hubs = await discoverHubs({
      browseServices: createBrowseServices([
        {
          addresses: ["192.168.1.40"],
          host: "gambi-hub-3100.local",
          name: "gambi-hub-3100",
          port: 3100,
          txt: {},
        },
      ]),
      fetchFn,
      hubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(hubs).toEqual([
      {
        addresses: [],
        host: "localhost",
        hubUrl: "http://localhost:3000",
        name: "Configured hub",
        port: 3000,
        source: "configured",
        txt: {},
      },
      {
        addresses: ["192.168.1.40"],
        host: "gambi-hub-3100.local",
        hubUrl: "http://192.168.1.40:3100",
        name: "gambi-hub-3100",
        port: 3100,
        source: "mdns",
        txt: {},
      },
    ]);
  });

  test("resolves a discovered target and feeds createGambi", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/health") {
        return Promise.resolve(
          Response.json({ status: "ok", timestamp: Date.now() })
        );
      }

      if (url === "http://localhost:3000/rooms") {
        return Promise.resolve(Response.json({ rooms: [alphaRoom] }));
      }

      if (url === "http://192.168.1.40:3100/health") {
        return Promise.resolve(
          Response.json({ status: "ok", timestamp: Date.now() })
        );
      }

      if (url === "http://192.168.1.40:3100/rooms") {
        return Promise.resolve(Response.json({ rooms: [betaRoom] }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const target = await resolveGambiTarget({
      browseServices: createBrowseServices([
        {
          addresses: ["192.168.1.40"],
          host: "gambi-hub-3100.local",
          name: "gambi-hub-3100",
          port: 3100,
          txt: {},
        },
      ]),
      fetchFn,
      roomCode: "XYZ999",
      hubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(target.hubUrl).toBe("http://192.168.1.40:3100");
    expect(target.roomCode).toBe("XYZ999");
    expect(target.room.name).toBe("Beta");

    const provider = createGambi(target);
    expect(provider.baseURL).toBe("http://192.168.1.40:3100/rooms/XYZ999/v1");
  });

  test("throws a typed error when multiple rooms match", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/health") {
        return Promise.resolve(
          Response.json({ status: "ok", timestamp: Date.now() })
        );
      }

      if (url === "http://localhost:3000/rooms") {
        return Promise.resolve(Response.json({ rooms: [alphaRoom, betaRoom] }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    await expect(
      resolveGambiTarget({
        browseServices: createBrowseServices([]),
        fetchFn,
        hubUrl: "http://localhost:3000",
        timeoutMs: 0,
      })
    ).rejects.toMatchObject<Partial<DiscoveryError>>({
      code: "AMBIGUOUS_ROOM_MATCH",
      matches: [
        expect.objectContaining({ code: "ABC123" }),
        expect.objectContaining({ code: "XYZ999" }),
      ],
    });
  });
});
