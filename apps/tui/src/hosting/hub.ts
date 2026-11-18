/**
 * A hub hosted in this process, behind a `Promise` boundary.
 *
 * This is the edge where the TUI, which is React, meets the hub, which is
 * Effect (ADR-0007): the one `ManagedRuntime` of a hosted hub lives here and
 * nothing of Effect leaves this file. It stands where the hub entry of
 * `gambi-sdk` will (#125); until then it builds on what `@gambi/core` exposes.
 */
import { BunHttpServer } from "@effect/platform-bun";
import { Hub } from "@gambi/core/hub/hub";
import { Mdns } from "@gambi/core/hub/mdns";
import { Cause, Effect, Exit, Layer, Logger, ManagedRuntime } from "effect";

export interface HostHubOptions {
  /** The interface to listen on. Default `0.0.0.0`. */
  readonly hostname?: string | undefined;
  /** Announce the hub over mDNS. Default `false`. */
  readonly mdns?: boolean | undefined;
  /** The port to listen on; `0` takes any free port. Default `3000`. */
  readonly port?: number | undefined;
}

export interface HostedHub {
  /** The name announced over mDNS, when the hub announces itself. */
  readonly mdnsName: string | undefined;
  /** The port the hub listens on: the real one when `0` was asked for. */
  readonly port: number;
  /**
   * Stops the hub: closes its tunnels and event streams, withdraws the mDNS
   * announcement and frees the port.
   */
  readonly stop: () => Promise<void>;
  /** Where clients reach the hub, for example `http://localhost:3000`. */
  readonly url: string;
}

/**
 * Starts a hub and resolves once it listens. It rejects with an `Error`
 * whose message says what went wrong (a port in use names the port), and
 * then nothing is left behind: no port, no announcement.
 */
export const hostHub = async (
  options: HostHubOptions = {}
): Promise<HostedHub> => {
  const runtime = ManagedRuntime.make(
    Hub.layer({ ...options, listen: BunHttpServer.layer }).pipe(
      Layer.provide(Mdns.layer),
      // The terminal belongs to the TUI: the hub's log lines go nowhere.
      Layer.provide(Logger.layer([]))
    )
  );
  const started = await runtime.runPromiseExit(
    Hub.use((hub) =>
      Effect.succeed({
        mdnsName: hub.mdnsName,
        port: hub.port,
        url: hub.url,
      })
    )
  );
  if (Exit.isFailure(started)) {
    await runtime.dispose();
    throw Cause.squash(started.cause);
  }
  return { ...started.value, stop: () => runtime.dispose() };
};
