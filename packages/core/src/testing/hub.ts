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
import { type ManagementClient, makeManagementClient } from "@gambi/protocol";
import { Effect, Layer, Logger } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { Hub, type HubOptions, type HubStartError } from "../hub/hub.ts";
import { Mdns } from "../hub/mdns.ts";

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
): Layer.Layer<Hub | HttpClient.HttpClient, HubStartError, Mdns> => {
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
): Layer.Layer<Hub | Mdns | HttpClient.HttpClient, HubStartError> =>
  layerHubWithoutMdns(options).pipe(Layer.provideMerge(Mdns.layerTest));

/** The management client derived from the contract, pointed at the hub in the environment. */
export const managementClient: Effect.Effect<
  ManagementClient,
  never,
  Hub | HttpClient.HttpClient
> = Effect.gen(function* () {
  const hub = yield* Hub;
  return yield* makeManagementClient(hub.url);
});
