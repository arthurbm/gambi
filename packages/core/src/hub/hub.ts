/**
 * The hub, on Effect (ADR-0007). It lives beside the current `../hub.ts`
 * until the migration replaces it.
 *
 * `Hub.layer` acquires the port first (`options.listen`). Everything else is
 * built on top of it: the state (`Rooms`), the routes, and the mDNS
 * announcement when asked for. A failure in any of them releases what was
 * already acquired, the port included, and releasing the layer releases all.
 *
 * Add a resource the hub owns (a timer, a registry of tunnels) as a layer or
 * an `Effect.acquireRelease` on top of the port, never before it.
 */

import { GAMBI_VERSION } from "@gambi/protocol";
import {
  Cause,
  Context,
  Effect,
  type FileSystem,
  Layer,
  type Path,
  Predicate,
  Schema,
} from "effect";
import { SecureRandom } from "effect/crypto";
import {
  type Etag,
  type HttpPlatform,
  HttpRouter,
  HttpServer,
} from "effect/http";
import { ManagementRoutes } from "./management.ts";
import { Mdns, type MdnsAnnounceFailed } from "./mdns.ts";
import { Participants } from "./participants.ts";
import { RoomPasswords } from "./room-passwords.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
import { TunnelRoute } from "./tunnel-route.ts";
import { Tunnels } from "./tunnels.ts";

export const DEFAULT_HUB_PORT = 3000;
export const DEFAULT_HUB_HOSTNAME = "0.0.0.0";

/** The platform services an HTTP server brings: `BunHttpServer.layer` provides all of them. */
export type HubPlatform =
  | HttpServer.HttpServer
  | HttpPlatform.HttpPlatform
  | Etag.Generator
  | FileSystem.FileSystem
  | Path.Path;

export interface HubOptions {
  /** The interface to listen on. Default `0.0.0.0`. */
  readonly hostname?: string | undefined;
  /**
   * Opens the port. The core has no platform dependency, so the entrypoint
   * passes the server of its platform: `listen: BunHttpServer.layer`.
   */
  readonly listen: (address: {
    readonly hostname: string;
    readonly port: number;
  }) => Layer.Layer<HubPlatform, unknown>;
  /** Announce the hub over mDNS. Default `false`. */
  readonly mdns?: boolean | undefined;
  /** The port to listen on; `0` takes any free port. Default `3000`. */
  readonly port?: number | undefined;
  /**
   * The Gambi version this hub answers for. A participant of another minor
   * is refused at registration. Default: `GAMBI_VERSION`, the version of this
   * build.
   */
  readonly version?: string | undefined;
}

/** Another process already listens on the port the hub was asked to use. */
export class PortInUse extends Schema.TaggedError<PortInUse>()("PortInUse", {
  hostname: Schema.String,
  port: Schema.Int,
}) {
  override get message(): string {
    return `Port ${this.port} is already in use on ${this.hostname}. Stop the process that holds it or choose another port.`;
  }
}

/** The hub could not start listening, for a reason other than a busy port. */
export class HubListenFailed extends Schema.TaggedError<HubListenFailed>()(
  "HubListenFailed",
  { hostname: Schema.String, port: Schema.Int, cause: Schema.Defect() }
) {
  override get message(): string {
    return `The hub could not listen on ${this.hostname}:${this.port}.`;
  }
}

export type HubStartError = PortInUse | HubListenFailed | MdnsAnnounceFailed;

const isAddressInUse = (cause: unknown): boolean => {
  let current = cause;
  // A platform may wrap the system error (`ServeError { cause }`).
  for (let depth = 0; depth < 4 && Predicate.isObject(current); depth++) {
    if (
      Predicate.hasProperty(current, "code") &&
      current.code === "EADDRINUSE"
    ) {
      return true;
    }
    current = Predicate.hasProperty(current, "cause")
      ? current.cause
      : undefined;
  }
  return false;
};

/** Step 1: the port. A busy port becomes `PortInUse`, whatever the platform throws. */
const listening = (
  options: HubOptions
): Layer.Layer<HubPlatform, PortInUse | HubListenFailed> => {
  const hostname = options.hostname ?? DEFAULT_HUB_HOSTNAME;
  const port = options.port ?? DEFAULT_HUB_PORT;
  return Layer.effectContext(
    Layer.build(options.listen({ hostname, port })).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause as Cause.Cause<never>);
        }
        const error = Cause.squash(cause);
        return Effect.fail(
          isAddressInUse(error)
            ? new PortInUse({ hostname, port })
            : new HubListenFailed({ hostname, port, cause: error })
        );
      })
    )
  );
};

const mdnsName = (port: number) => `gambi-hub-${port}`;

export class Hub extends Context.Service<
  Hub,
  {
    /** The name announced over mDNS, when the hub announces itself. */
    readonly mdnsName: string | undefined;
    /** The port the hub listens on: the real one when `0` was asked for. */
    readonly port: number;
    /** Where clients reach the hub, for example `http://localhost:3000`. */
    readonly url: string;
  }
>()("gambi/core/Hub") {
  /**
   * A running hub. Building the layer starts it; releasing the layer stops it
   * and frees the port, the announcement and the state.
   */
  static readonly layer = (
    options: HubOptions
  ): Layer.Layer<Hub | Tunnels, HubStartError, Mdns> => {
    const Settings = Layer.succeed(
      HubSettings,
      HubSettings.of({ version: options.version ?? GAMBI_VERSION })
    );

    const State = Layer.mergeAll(Rooms.layer, Tunnels.layer).pipe(
      Layer.provideMerge(Participants.layer),
      Layer.provide(RoomPasswords.layerWebCrypto),
      Layer.provide(SecureRandom.layerWebCrypto),
      Layer.provideMerge(Settings)
    );

    const Served = HttpRouter.serve(
      Layer.mergeAll(ManagementRoutes, TunnelRoute),
      { disableListenLog: true }
    ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

    const Announced = Layer.effect(
      Hub,
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (address._tag === "UnixPathAddress") {
          return yield* Effect.die(
            new Error("The hub listens on a TCP port, not on a Unix socket.")
          );
        }
        const hostname = options.hostname ?? DEFAULT_HUB_HOSTNAME;
        const host =
          hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
        const url = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
        const name = options.mdns === true ? mdnsName(address.port) : undefined;
        if (name !== undefined) {
          const mdns = yield* Mdns;
          yield* mdns.announce({
            name,
            port: address.port,
            type: "gambi",
            txt: { version: "1.0", protocol: "http" },
          });
        }
        yield* Effect.logInfo("hub listening").pipe(
          Effect.annotateLogs({ url, mdnsName: name })
        );
        return Hub.of({ mdnsName: name, port: address.port, url });
      })
    );

    // Built last, so released first: the tunnels close before the routes
    // and the server start to stop. Each tunnel is a request still being
    // answered, and the server would wait 20 s for it.
    const TunnelsClosedFirst = Layer.effectDiscard(
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        yield* Effect.addFinalizer(() => tunnels.closeAll);
      })
    );

    // `Tunnels` is also the in-process way to call a participant, so it is
    // part of what the layer provides.
    return TunnelsClosedFirst.pipe(
      Layer.provideMerge(Layer.mergeAll(Served, Announced)),
      Layer.provideMerge(State),
      Layer.provide(listening(options))
    );
  };
}
