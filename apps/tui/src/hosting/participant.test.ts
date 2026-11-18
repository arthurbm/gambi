import { expect } from "bun:test";
import { connect, createServer, type Socket } from "node:net";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import {
  chatCompletionsOnly,
  FAKE_MODEL,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { it, layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { hostParticipant, probeProvider } from "./participant";

/**
 * A TCP relay in front of the hub of the block that can stop passing on
 * requests to leave a room, the way a hub that stopped answering does: the
 * `DELETE` is accepted and never answered. `abandoned` completes when the
 * client closes the connection of a request held like that.
 */
const hubThatStopsAnsweringLeaves = Effect.gen(function* () {
  const hub = yield* Hub;
  const upstreamPort = Number(new URL(hub.url).port);
  const abandoned = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  let holding = false;
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const relay = createServer((client) => {
            const upstream = connect(upstreamPort, "127.0.0.1");
            let held = false;
            sockets.add(client).add(upstream);
            client.on("data", (chunk) => {
              if (holding && chunk.toString("latin1").startsWith("DELETE ")) {
                held = true;
              }
              if (!held) {
                upstream.write(chunk);
              }
            });
            upstream.on("data", (chunk) => client.write(chunk));
            client.on("close", () => {
              if (held) {
                abandoned.resolve();
              }
              upstream.destroy();
            });
            upstream.on("close", () => client.destroy());
            client.on("error", () => undefined);
            upstream.on("error", () => undefined);
          });
          relay.listen(0, "127.0.0.1", () => resolve(relay));
        })
    ),
    (relay) =>
      Effect.sync(() => {
        for (const socket of sockets) {
          socket.destroy();
        }
        relay.close();
      })
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    /** Completes when the client gave up a request to leave it had sent. */
    abandoned: Effect.promise(() => abandoned.promise),
    stopAnsweringLeaves: Effect.sync(() => {
      holding = true;
    }),
    url: `http://127.0.0.1:${port}`,
  };
});

layer(layerHub(), { excludeTestServices: true })("hosted participant", (it) => {
  it.effect(
    "leaving gives up on a hub that does not answer, and takes back its request",
    () =>
      Effect.gen(function* () {
        const management = yield* managementClient;
        const { room } = yield* management.rooms.create({
          payload: { name: "Frevo" },
        });
        const hub = yield* hubThatStopsAnsweringLeaves;
        const participant = yield* Effect.promise(() =>
          hostParticipant({
            hubUrl: hub.url,
            roomCode: room.code,
            participantId: "arthur-1",
            nickname: "Arthur",
            model: "llama3",
            endpoint: "http://127.0.0.1:1",
            leaveTimeoutMs: 20,
          })
        );
        const watch = yield* watchRoom(room.code);

        yield* hub.stopAnsweringLeaves;
        yield* Effect.promise(() => participant.leave());
        // The request does not stay behind to take effect later, when the
        // participant with this id may be someone else.
        yield* hub.abandoned;

        // The hub never heard the participant leave: it saw its tunnel drop.
        expect(yield* watch.next).toMatchObject({
          type: "participant.offline",
          participant: { id: "arthur-1" },
        });
      })
  );
});

it.live("probes the provider of this machine, with its auth headers", () =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider({ answer: chatCompletionsOnly });

    const probe = yield* Effect.promise(() =>
      probeProvider(provider.url, { Authorization: "Bearer segredo" })
    );

    expect(probe).toEqual({
      reachable: true,
      models: [FAKE_MODEL],
      capabilities: {
        openResponses: "unsupported",
        chatCompletions: "supported",
      },
    });
    const calls = yield* provider.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every((call) => call.headers.authorization === "Bearer segredo")
    ).toBe(true);
  })
);

it.live("a provider that is not there is a probe that found nothing", () =>
  Effect.gen(function* () {
    const probe = yield* Effect.promise(() =>
      probeProvider("http://127.0.0.1:1")
    );

    expect(probe).toEqual({
      reachable: false,
      models: [],
      capabilities: { openResponses: "unknown", chatCompletions: "unknown" },
    });
  })
);
