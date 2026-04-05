import { describe, expect, test } from "bun:test";
import type { DiscoveredService } from "@gambi/core/mdns";
import { discoverRoomsOnNetwork } from "./room-discovery.ts";

type FetchLike = Parameters<typeof discoverRoomsOnNetwork>[0]["fetchFn"];

const alphaRoom = {
  id: "room-alpha",
  code: "ABC123",
  name: "Alpha",
  hostId: "host-alpha",
  createdAt: 1,
  participantCount: 2,
  passwordProtected: false,
};

const betaRoom = {
  id: "room-beta",
  code: "XYZ999",
  name: "Beta",
  hostId: "host-beta",
  createdAt: 2,
  participantCount: 1,
  passwordProtected: false,
};

function createBrowseServices(services: DiscoveredService[]) {
  return (callback: (service: DiscoveredService) => void) => {
    for (const service of services) {
      callback(service);
    }

    return () => undefined;
  };
}

describe("room discovery", () => {
  test("falls back to the configured hub when mDNS browsing fails", async () => {
    const fetchFn: NonNullable<FetchLike> = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(Response.json({ data: [alphaRoom] }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const rooms = await discoverRoomsOnNetwork({
      browseServices: () => {
        throw new Error("mDNS unavailable");
      },
      fetchFn,
      seedHubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(rooms).toEqual([
      {
        ...alphaRoom,
        hubName: "Configured hub",
        hubSource: "configured",
        hubUrl: "http://localhost:3000",
      },
    ]);
  });

  test("aggregates rooms from the configured hub and mDNS hubs", async () => {
    const fetchCalls: string[] = [];
    const fetchFn: NonNullable<FetchLike> = (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(Response.json({ data: [alphaRoom] }));
      }

      if (url === "http://192.168.1.40:3100/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://192.168.1.40:3100/v1/rooms") {
        return Promise.resolve(Response.json({ data: [betaRoom] }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const rooms = await discoverRoomsOnNetwork({
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
      seedHubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(fetchCalls).toEqual([
      "http://localhost:3000/v1/health",
      "http://192.168.1.40:3100/v1/health",
      "http://localhost:3000/v1/rooms",
      "http://192.168.1.40:3100/v1/rooms",
    ]);
    expect(rooms).toEqual([
      {
        ...alphaRoom,
        hubName: "Configured hub",
        hubSource: "configured",
        hubUrl: "http://localhost:3000",
      },
      {
        ...betaRoom,
        hubName: "gambi-hub-3100",
        hubSource: "mdns",
        hubUrl: "http://192.168.1.40:3100",
      },
    ]);
  });

  test("prefers the configured hub when the same room appears twice", async () => {
    const fetchFn: NonNullable<FetchLike> = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(Response.json({ data: [alphaRoom] }));
      }

      if (url === "http://192.168.1.50:3000/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://192.168.1.50:3000/v1/rooms") {
        return Promise.resolve(
          Response.json({
            data: [{ ...alphaRoom, name: "Alpha duplicate" }],
          })
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const rooms = await discoverRoomsOnNetwork({
      browseServices: createBrowseServices([
        {
          addresses: ["192.168.1.50"],
          host: "gambi-hub-3000.local",
          name: "gambi-hub-3000",
          port: 3000,
          txt: {},
        },
      ]),
      fetchFn,
      seedHubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(rooms).toEqual([
      {
        ...alphaRoom,
        hubName: "Configured hub",
        hubSource: "configured",
        hubUrl: "http://localhost:3000",
      },
    ]);
  });

  test("prefers discovered addresses for mDNS hubs", async () => {
    const fetchCalls: string[] = [];
    const fetchFn: NonNullable<FetchLike> = (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(Response.json({ data: [] }));
      }

      if (url === "http://192.168.1.60:3200/v1/health") {
        return Promise.resolve(
          Response.json({ data: { status: "ok", timestamp: Date.now() } })
        );
      }

      if (url === "http://192.168.1.60:3200/v1/rooms") {
        return Promise.resolve(Response.json({ data: [betaRoom] }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const rooms = await discoverRoomsOnNetwork({
      browseServices: createBrowseServices([
        {
          addresses: ["192.168.1.60"],
          host: "unreachable.local",
          name: "gambi-hub-3200",
          port: 3200,
          txt: {},
        },
      ]),
      fetchFn,
      seedHubUrl: "http://localhost:3000",
      timeoutMs: 0,
    });

    expect(fetchCalls).toEqual([
      "http://localhost:3000/v1/health",
      "http://192.168.1.60:3200/v1/health",
      "http://localhost:3000/v1/rooms",
      "http://192.168.1.60:3200/v1/rooms",
    ]);
    expect(rooms).toEqual([
      {
        ...betaRoom,
        hubName: "gambi-hub-3200",
        hubSource: "mdns",
        hubUrl: "http://192.168.1.60:3200",
      },
    ]);
  });
});
