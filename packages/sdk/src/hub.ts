/**
 * `gambi-sdk/hub`: a hub hosted in this process, in `Promise`.
 *
 * **Bun only.** A hub listens on a port and accepts WebSocket tunnels with
 * Bun's own server, so this entry does not load in Node. The default entry
 * (`gambi-sdk`) stays free of it: importing that one never loads this one.
 *
 * It exports one function, one error class and types. No schema value and no
 * Effect type leaves this package.
 *
 * @example
 * import { createHub } from "gambi-sdk/hub";
 *
 * const hub = await createHub({ port: 0 });
 * console.log(hub.url);
 * // ...
 * await hub.close();
 */
import { BunHttpServer } from "@effect/platform-bun";
import {
  Hub,
  type HubStartError,
  type HubOptions as RuntimeHubOptions,
} from "@gambi/core/hub/hub";
import { Mdns } from "@gambi/core/hub/mdns";
import { Effect, Layer } from "effect";
import { failingWith, host, type LogEntry, logsTo } from "./hosting.ts";
import { withoutUndefined } from "./input.ts";

export type { LogEntry } from "./hosting.ts";

export interface HubOptions {
  /** The interface to listen on. Default `0.0.0.0`. */
  readonly hostname?: string | undefined;
  /**
   * How long an inference request may go without one piece of the answer
   * arriving from the participant, in milliseconds. Past it the hub cancels
   * the request and answers with an error. Default 5 minutes.
   */
  readonly inferenceIdleTimeoutMs?: number | undefined;
  /** Announce the hub on the local network over mDNS. Default `false`. */
  readonly mdns?: boolean | undefined;
  /**
   * Called with each log line of the hub. Without it the hub logs nowhere:
   * it never writes to the stdout of the program that hosts it.
   */
  readonly onLog?: ((entry: LogEntry) => void) | undefined;
  /** The port to listen on; `0` takes any free port. Default `3000`. */
  readonly port?: number | undefined;
  /**
   * How long a participant may stay `offline` before the hub removes it from
   * the room, in milliseconds. Default 60 seconds.
   */
  readonly reconnectDeadlineMs?: number | undefined;
}

export interface HostedHub {
  /**
   * Stops the hub: closes its tunnels and event streams, withdraws the mDNS
   * announcement and frees the port. Its rooms go with it: they live in
   * memory.
   */
  readonly close: () => Promise<void>;
  /** The name announced over mDNS, when the hub announces itself. */
  readonly mdnsName: string | undefined;
  /** The port the hub listens on: the real one when `0` was asked for. */
  readonly port: number;
  /** Where clients reach the hub, for example `http://localhost:3000`. */
  readonly url: string;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Why a hub did not start.
 *
 * - `PORT_IN_USE`: another process listens on the port; `details.port` names it.
 * - `LISTEN_FAILED`: the port could not be opened for another reason.
 * - `MDNS_ANNOUNCE_FAILED`: the hub listened, but could not announce itself.
 */
export type HubErrorCode =
  | "PORT_IN_USE"
  | "LISTEN_FAILED"
  | "MDNS_ANNOUNCE_FAILED";

/** The one error `createHub` rejects with. `code` tells the cases apart. */
export class HubError extends Error {
  override readonly name = "HubError";
  readonly code: HubErrorCode;
  /** The structured fields of the error: `hostname` and `port`, or the mDNS `name`. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(init: {
    readonly cause?: unknown;
    readonly code: HubErrorCode;
    readonly details: Readonly<Record<string, unknown>>;
    readonly message: string;
  }) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.details = init.details;
  }
}

const toHubError = (error: HubStartError): HubError => {
  switch (error._tag) {
    case "PortInUse":
      return new HubError({
        code: "PORT_IN_USE",
        details: { hostname: error.hostname, port: error.port },
        message: error.message,
      });
    case "HubListenFailed":
      return new HubError({
        cause: error.cause,
        code: "LISTEN_FAILED",
        details: { hostname: error.hostname, port: error.port },
        message: error.message,
      });
    default:
      return new HubError({
        cause: error.cause,
        code: "MDNS_ANNOUNCE_FAILED",
        details: { name: error.name },
        message: error.message,
      });
  }
};

const runtimeOptions = (options: HubOptions): RuntimeHubOptions =>
  withoutUndefined({
    hostname: options.hostname,
    inferenceIdleTimeout: options.inferenceIdleTimeoutMs,
    listen: BunHttpServer.layer,
    mdns: options.mdns,
    port: options.port,
    reconnectDeadline: options.reconnectDeadlineMs,
  });

/**
 * Starts a hub in this process and resolves once it listens. It rejects with
 * a `HubError`, and then nothing is left behind: no port, no announcement.
 *
 * @example
 * await using hub = await createHub({ hostname: "127.0.0.1", port: 0 });
 * const client = createClient({ hubUrl: hub.url });
 */
export const createHub = async (
  options: HubOptions = {}
): Promise<HostedHub> => {
  const { boundary, value } = await host(
    Hub.layer(runtimeOptions(options)).pipe(
      Layer.provide(Mdns.layer),
      Layer.provide(logsTo(options.onLog)),
      failingWith(toHubError)
    ),
    "The hub",
    Hub.use((hub) =>
      Effect.succeed({ mdnsName: hub.mdnsName, port: hub.port, url: hub.url })
    )
  );
  return {
    ...value,
    close: boundary.close,
    [Symbol.asyncDispose]: boundary.close,
  };
};
