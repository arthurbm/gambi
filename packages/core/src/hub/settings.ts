/**
 * The values a hub is started with and that its services read: the plain
 * configuration of one hub instance. `Hub.layer` provides it from its options.
 *
 * A new knob of the hub (a timeout, a limit) is a field here, with its default
 * resolved in `Hub.layer`.
 */
import { Context, type Duration } from "effect";

export class HubSettings extends Context.Service<
  HubSettings,
  {
    /**
     * How often the hub pings a tunnel. A tunnel that stays silent for one
     * more interval after a ping is dropped.
     */
    readonly tunnelPingInterval: Duration.Duration;
    /**
     * The Gambi version of this hub. A participant registers with its own,
     * and the hub refuses a different minor.
     */
    readonly version: string;
  }
>()("gambi/core/HubSettings") {}
