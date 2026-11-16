/**
 * A real hub for tests: any free port on the loopback interface, a recording
 * mDNS double, no log output, and what the derived management client needs.
 * How to use it: `docs/reference/effect-conventions.md`.
 *
 * Test support only: this is the one file of the core that imports
 * `@effect/platform-bun`, which is a devDependency here. From another
 * workspace, import it as `@gambi/core/testing/hub` and add
 * `@effect/platform-bun` to that workspace's devDependencies.
 */
import { BunHttpServer } from "@effect/platform-bun";
import {
  type ManagementClient,
  makeManagementClient,
  type RoomEvent,
  type RoomSnapshot,
} from "@gambi/protocol";
import { Effect, Layer, Logger, Queue, type Scope, Stream } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import type { HarnessClients } from "../hub/harness-clients.ts";
import { Hub, type HubOptions, type HubStartError } from "../hub/hub.ts";
import { Mdns } from "../hub/mdns.ts";
import type { Tunnels } from "../hub/tunnels.ts";

export interface TestHubOptions extends Partial<Omit<HubOptions, "listen">> {
  /** Where the hub's log lines go. Default: nowhere. */
  readonly loggers?: readonly Logger.Logger<unknown, unknown>[] | undefined;
}

/**
 * `layerHub` without the mDNS double, for a test that brings its own `Mdns`
 * (one that fails, or one shared by two hubs).
 */
export const layerHubWithoutMdns = (
  options: TestHubOptions = {}
): Layer.Layer<
  Hub | Tunnels | HarnessClients | HttpClient.HttpClient,
  HubStartError,
  Mdns
> => {
  const { loggers = [], ...hubOptions } = options;
  return Hub.layer({
    hostname: "127.0.0.1",
    port: 0,
    ...hubOptions,
    listen: BunHttpServer.layer,
  }).pipe(
    Layer.provide(Logger.layer(loggers)),
    Layer.provideMerge(FetchHttpClient.layer)
  );
};

/**
 * A hub listening on `127.0.0.1`, on a free port unless `port` says otherwise.
 * mDNS announcements go to `Mdns.layerTest`; read them with `Mdns.announced`.
 *
 * Share one hub in a block with `layer(layerHub(), { excludeTestServices: true })`,
 * or give a single test its own with `Effect.provide(layerHub())`.
 */
export const layerHub = (
  options: TestHubOptions = {}
): Layer.Layer<
  Hub | Tunnels | HarnessClients | Mdns | HttpClient.HttpClient,
  HubStartError
> => layerHubWithoutMdns(options).pipe(Layer.provideMerge(Mdns.layerTest));

/** The management client derived from the contract, pointed at the hub in the environment. */
export const managementClient: Effect.Effect<
  ManagementClient,
  never,
  Hub | HttpClient.HttpClient
> = Effect.gen(function* () {
  const hub = yield* Hub;
  return yield* makeManagementClient(hub.url);
});

export interface RoomWatch {
  /**
   * The next event of the room, in order, waiting for it if it has not
   * arrived. Each event is handed out once.
   */
  readonly next: Effect.Effect<RoomEvent>;
  /** How the room was when the watch started. */
  readonly snapshot: RoomSnapshot;
}

/**
 * Watches the events of a room through the derived client, until the test
 * ends. It returns once the stream is open and its snapshot arrived, so
 * whatever the test does next shows up in `next`.
 *
 * @example
 * const watch = yield* watchRoom(room.code);
 * yield* joinParticipant({ roomCode: room.code });
 * expect((yield* watch.next).type).toBe("participant.joined");
 */
export const watchRoom = (
  roomCode: string
): Effect.Effect<RoomWatch, never, Hub | HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const received = yield* Queue.unbounded<RoomEvent>();
    yield* client.events.watch({ params: { code: roomCode } }).pipe(
      Stream.unwrap,
      Stream.runForEach((event) => Queue.offer(received, event)),
      Effect.orDie,
      Effect.forkScoped
    );
    const snapshot = yield* Queue.take(received);
    if (snapshot.type !== "room.snapshot") {
      return yield* Effect.die(
        new Error(
          `The stream of a room starts with its snapshot, not with '${snapshot.type}'.`
        )
      );
    }
    return { next: Queue.take(received), snapshot };
  });
