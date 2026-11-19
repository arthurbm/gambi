import { describe, expect, test } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import {
  type DiscoveredService,
  type DiscoveryError,
  type DiscoveryOptions,
  discoverHubs,
  discoverRooms,
  resolveGambiTarget,
} from "./discovery.ts";
import { createGambi } from "./provider.ts";

type FetchLike = NonNullable<DiscoveryOptions["fetchFn"]>;

const alphaRoom = {
  id: "room-alpha",
  code: "ABC123",
  name: "Alpha",
  hostId: "host-alpha",
  passwordProtected: false,
  createdAt: 1,
  participantCount: 2,
};

const betaRoom = {
  id: "room-beta",
  code: "XYZ999",
  name: "Beta",
  hostId: "host-beta",
  passwordProtected: false,
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
  test("a server returning unrelated JSON is omitted from discovered hubs", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ healthy: true }),
    });
    try {
      expect(
        await discoverHubs({
          hubUrl: server.url.href,
          browseServices: () => {
            throw new Error("no mDNS");
          },
        })
      ).toEqual([]);
    } finally {
      await server.stop(true);
    }
  });
  test("does not wait for the mDNS timeout when browsing throws", async () => {
    const startedAt = performance.now();

    const hubs = await discoverHubs({
      browseServices: () => {
        throw new Error("mDNS unavailable");
      },
      fetchFn: (input) => {
        const url = String(input);

        if (url === "http://localhost:3000/v1/health") {
          return Promise.resolve(
            Response.json({
              data: { status: "ok", timestamp: Date.now() },
              meta: { requestId: "req-local" },
            })
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      hubUrl: "http://localhost:3000",
      timeoutMs: 500,
    });

    const elapsedMs = performance.now() - startedAt;

    expect(hubs).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(250);
  });

  test("keeps the configured hub when mDNS browsing throws", async () => {
    const hubs = await discoverHubs({
      browseServices: () => {
        throw new Error("mDNS unavailable");
      },
      fetchFn: (input) => {
        const url = String(input);

        if (url === "http://localhost:3000/v1/health") {
          return Promise.resolve(
            Response.json({
              data: { status: "ok", timestamp: Date.now() },
              meta: { requestId: "req-local" },
            })
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
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
    ]);
  });

  test("discovers configured and mDNS hubs", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({
            data: { status: "ok", timestamp: Date.now() },
            meta: { requestId: "req-local" },
          })
        );
      }

      if (url === "http://192.168.1.40:3100/v1/health") {
        return Promise.resolve(
          Response.json({
            data: { status: "ok", timestamp: Date.now() },
            meta: { requestId: "req-remote" },
          })
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
    const fetchCalls: string[] = [];
    const fetchFn: FetchLike = (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({
            data: { status: "ok", timestamp: Date.now() },
            meta: { requestId: "req-local" },
          })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(
          Response.json({
            data: [alphaRoom],
            meta: { requestId: "req-rooms-local" },
          })
        );
      }

      if (url === "http://192.168.1.40:3100/v1/health") {
        return Promise.resolve(
          Response.json({
            data: { status: "ok", timestamp: Date.now() },
            meta: { requestId: "req-remote" },
          })
        );
      }

      if (url === "http://192.168.1.40:3100/v1/rooms") {
        return Promise.resolve(
          Response.json({
            data: [betaRoom],
            meta: { requestId: "req-rooms-remote" },
          })
        );
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
    expect(fetchCalls).toEqual([
      "http://localhost:3000/v1/health",
      "http://192.168.1.40:3100/v1/health",
      "http://localhost:3000/v1/rooms",
      "http://192.168.1.40:3100/v1/rooms",
    ]);

    const provider = createGambi(target);
    expect(provider.baseURL).toBe("http://192.168.1.40:3100/rooms/XYZ999/v1");
  });

  test("throws a typed error when multiple rooms match", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(
          Response.json({
            data: { status: "ok", timestamp: Date.now() },
            meta: { requestId: "req-local" },
          })
        );
      }

      if (url === "http://localhost:3000/v1/rooms") {
        return Promise.resolve(
          Response.json({
            data: [alphaRoom, betaRoom],
            meta: { requestId: "req-rooms-local" },
          })
        );
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

  test("throws a typed error when no hubs are reachable", async () => {
    const fetchFn: FetchLike = (input) => {
      const url = String(input);

      if (url === "http://localhost:3000/v1/health") {
        return Promise.resolve(new Response("offline", { status: 503 }));
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
      code: "NO_HUBS_FOUND",
    });
  });
});

layer(layerHub(), { excludeTestServices: true })(
  "SDK discovery against a hub",
  (it) => {
    it.effect("finds the rooms of the configured hub", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = createClient({ hubUrl: hub.url });
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Frevo" })
        );

        const rooms = yield* Effect.promise(() =>
          discoverRooms({
            hubUrl: hub.url,
            browseServices: () => {
              throw new Error("no mDNS in this test");
            },
          })
        );

        expect(rooms).toContainEqual({
          ...room,
          hubName: "Configured hub",
          hubSource: "configured",
          hubUrl: hub.url,
        });
      })
    );
  }
);
