import {
  DEFAULT_HUB_HOSTNAME,
  DEFAULT_HUB_PORT,
  Hub,
  type HubOptions,
} from "@gambi/core/hub/hub";
import { Context, Effect, Layer, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { Output } from "../output.ts";
import { Termination } from "../termination.ts";

/**
 * How the hub opens its port. The commands have no platform dependency
 * (ADR-0007): the entrypoint provides `BunHttpServer.layer`.
 */
export class HubListen extends Context.Service<
  HubListen,
  HubOptions["listen"]
>()("gambi/cli/HubListen") {}

const Port = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 65_535 })
);

const serve = Command.make(
  "serve",
  {
    host: Flag.String("host").pipe(
      Flag.withDescription("Interface to listen on"),
      Flag.withDefault(DEFAULT_HUB_HOSTNAME)
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Port to listen on; 0 takes any free port"),
      Flag.withSchema(Port),
      Flag.withDefault(DEFAULT_HUB_PORT)
    ),
    mdns: Flag.Boolean("mdns").pipe(
      Flag.withDescription("Announce the hub on the local network over mDNS"),
      Flag.withDefault(false)
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print what would start, without starting it"),
      Flag.withDefault(false)
    ),
  },
  Effect.fn("hub.serve")(function* ({ dryRun, host, mdns, port }) {
    const output = yield* Output;
    if (dryRun) {
      return yield* output.result(
        { host, port, mdns },
        () =>
          `Would start a hub on ${host}:${port} (mDNS: ${mdns ? "on" : "off"}).`
      );
    }

    const listen = yield* HubListen;
    const termination = yield* Termination;
    // The scope holds the port, the rooms and the mDNS announcement. It
    // closes, and the hub with it, before `stopped` is written.
    const signal = yield* Effect.scoped(
      Effect.gen(function* () {
        const hub = Context.get(
          yield* Layer.build(Hub.layer({ hostname: host, port, mdns, listen })),
          Hub
        );
        yield* output.event(
          "started",
          { host, port: hub.port, mdns, hubUrl: hub.url },
          `Hub started at ${hub.url}\nPress Ctrl+C to stop`
        );
        if (hub.mdnsName !== undefined) {
          yield* output.event(
            "mdns_registered",
            { name: hub.mdnsName },
            `Announced over mDNS as ${hub.mdnsName}`
          );
        }
        const received = yield* termination.signal;
        yield* output.event(
          "signal_received",
          { signal: received },
          `Shutting down (${received})...`
        );
        return received;
      })
    );
    yield* output.event("stopped", { signal }, "Hub stopped.");
  })
).pipe(
  Command.withDescription("Start a hub and keep it running until Ctrl+C"),
  Command.withExamples([
    { command: "gambi hub serve", description: "Start a hub on port 3000" },
    {
      command: "gambi hub serve --port 4000 --mdns",
      description: "Start a hub on port 4000 and announce it over mDNS",
    },
  ])
);

export const hub = Command.make("hub").pipe(
  Command.withDescription("Run a hub"),
  Command.withSubcommands([serve])
);
