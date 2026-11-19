/**
 * The hub, on Effect (ADR-0007).
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
  Duration,
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
import { HarnessClients } from "./harness-clients.ts";
import { InferenceRoutes } from "./inference.ts";
import { ManagementRoutes } from "./management.ts";
import { Mdns, type MdnsAnnounceFailed } from "./mdns.ts";
import { OpenStreams } from "./open-streams.ts";
import { Participants } from "./participants.ts";
import { RoomEvents } from "./room-events.ts";
import { RoomPasswords } from "./room-passwords.ts";
import { Rooms } from "./rooms.ts";
import { HubSettings } from "./settings.ts";
import { StoredResponses } from "./stored-responses.ts";
import { TunnelRoute } from "./tunnel-route.ts";
import { Tunnels } from "./tunnels.ts";

export const DEFAULT_HUB_PORT = 3000;
export const DEFAULT_HUB_HOSTNAME = "0.0.0.0";
export const DEFAULT_TUNNEL_PING_INTERVAL: Duration.Input = "5 seconds";
export const DEFAULT_HARNESS_CLIENT_BUFFER = 1024;
export const DEFAULT_INFERENCE_IDLE_TIMEOUT: Duration.Input = "5 minutes";
export const DEFAULT_RECONNECT_DEADLINE: Duration.Input = "60 seconds";
export const DEFAULT_STORED_RESPONSES_LIMIT = 10_000;

/** The platform services an HTTP server brings: `BunHttpServer.layer` provides all of them. */
export type HubPlatform =
  | HttpServer.HttpServer
  | HttpPlatform.HttpPlatform
  | Etag.Generator
  | FileSystem.FileSystem
  | Path.Path;

export interface HubOptions {
  /**
   * How many events the hub holds for one management client attached to a
   * harness participant; a client that falls further behind loses its oldest
   * events. Default 1024.
   */
  readonly harnessClientBuffer?: number | undefined;
  /** The interface to listen on. Default `0.0.0.0`. */
  readonly hostname?: string | undefined;
  /**
   * How long an inference request may go without one piece of the response
   * arriving from the participant, before the first one and between any two.
   * Past it the hub cancels the request and answers with an error. Default 5
   * minutes.
   */
  readonly inferenceIdleTimeout?: Duration.Input | undefined;
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
   * How long a participant may stay `offline` before the hub removes it from
   * the room. Reconnecting before that keeps it. Default 60 seconds.
   */
  readonly reconnectDeadline?: Duration.Input | undefined;
  /**
   * How many Responses of the Responses API the hub remembers the
   * participant of. A Response past the limit can no longer be read back,
   * deleted or cancelled through the hub. Default 10 000.
   */
  readonly storedResponsesLimit?: number | undefined;
  /**
   * How often the hub pings each tunnel; a tunnel that stays silent for one
   * more interval is dropped. Default 5 seconds.
   */
  readonly tunnelPingInterval?: Duration.Input | undefined;
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
  ): Layer.Layer<Hub | Tunnels | HarnessClients, HubStartError, Mdns> => {
    const Settings = Layer.succeed(
      HubSettings,
      HubSettings.of({
        harnessClientBuffer:
          options.harnessClientBuffer ?? DEFAULT_HARNESS_CLIENT_BUFFER,
        inferenceIdleTimeout: Duration.fromInputUnsafe(
          options.inferenceIdleTimeout ?? DEFAULT_INFERENCE_IDLE_TIMEOUT
        ),
        reconnectDeadline: Duration.fromInputUnsafe(
          options.reconnectDeadline ?? DEFAULT_RECONNECT_DEADLINE
        ),
        storedResponsesLimit:
          options.storedResponsesLimit ?? DEFAULT_STORED_RESPONSES_LIMIT,
        tunnelPingInterval: Duration.fromInputUnsafe(
          options.tunnelPingInterval ?? DEFAULT_TUNNEL_PING_INTERVAL
        ),
        version: options.version ?? GAMBI_VERSION,
      })
    );

    const State = Layer.mergeAll(
      Rooms.layer,
      Tunnels.layer,
      StoredResponses.layer
    ).pipe(
      Layer.provideMerge(Participants.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          RoomEvents.layer,
          OpenStreams.layer,
          HarnessClients.layer
        )
      ),
      Layer.provide(RoomPasswords.layerWebCrypto),
      Layer.provide(SecureRandom.layerWebCrypto),
      Layer.provideMerge(Settings)
    );

    const Served = HttpRouter.serve(
      Layer.mergeAll(ManagementRoutes, TunnelRoute, InferenceRoutes),
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
        const name =
          options.mdns === true
            ? `gambi-hub-${address.port}-${yield* (yield* SecureRandom.SecureRandom).uuidV4()}`
            : undefined;
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
    ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

    // Built last, so released first: the tunnels and the open streams close
    // before the routes and the server start to stop. Each of them is a
    // request still being answered, and the server would wait 20 s for it.
    const TunnelsClosedFirst = Layer.effectDiscard(
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const streams = yield* OpenStreams;
        // The streams first, so that their watchers see the hub go away
        // instead of every participant going offline.
        yield* Effect.addFinalizer(() =>
          Effect.andThen(streams.closeAll, tunnels.closeAll)
        );
      })
    );

    // `Tunnels` is also the in-process way to call a participant, and
    // `HarnessClients` the in-process way to attach to a harness participant,
    // so they are part of what the layer provides.
    return TunnelsClosedFirst.pipe(
      Layer.provideMerge(Layer.mergeAll(Served, Announced)),
      Layer.provideMerge(State),
      Layer.provide(listening(options))
    );
  };
}
