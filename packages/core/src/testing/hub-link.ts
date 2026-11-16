/**
 * A link between a participant and the hub of a test that the test can cut
 * and bring back: a TCP relay on the loopback interface, in front of the hub
 * in the environment (`layerHub` from `./hub.ts`).
 *
 * To a participant runtime that reaches the hub through it, a cut link is a
 * hub that went away: its tunnel is severed and new connections are refused.
 * A frozen link is a hub that froze: every connection stays open and nothing
 * moves on it. The hub itself keeps running, with its rooms. How to use it:
 * `docs/reference/effect-conventions.md`.
 *
 * Test support only: it uses `node:net`, which the core itself does not.
 */
import {
  type AddressInfo,
  connect,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { Effect, type Scope } from "effect";
import { Hub } from "../hub/hub.ts";

export interface HubLink {
  /**
   * Severs every connection through the link and refuses new ones, until
   * `restore`. Returns when the link is down.
   */
  readonly cut: Effect.Effect<void>;
  /**
   * Stops everything that moves through the link, in both directions, without
   * closing anything: connections stay open and new ones are accepted, but no
   * byte and no close arrives until `unfreeze`. It is what a participant sees
   * of a hub whose process froze.
   */
  readonly freeze: Effect.Effect<void>;
  /** Brings the link back, on the same URL. Returns when it accepts connections. */
  readonly restore: Effect.Effect<void>;
  /** Lets through what `freeze` held, in order, and everything after it. */
  readonly unfreeze: Effect.Effect<void>;
  /** Where the hub is reached through the link. Pass it as `hubUrl`. */
  readonly url: string;
}

const HOSTNAME = "127.0.0.1";

/**
 * Starts a link to the hub in the environment. It goes away when the test
 * ends.
 *
 * @example
 * const link = yield* linkToHub;
 * const participant = yield* joinParticipant({ roomCode, hubUrl: link.url, reconnect: true });
 * yield* link.cut; // the runtime sees its tunnel drop and the hub refuse it
 * yield* link.restore;
 * yield* link.freeze; // the runtime hears nothing more from the hub
 * yield* link.unfreeze;
 */
export const linkToHub: Effect.Effect<HubLink, never, Hub | Scope.Scope> =
  Effect.gen(function* () {
    const hub = yield* Hub;
    const sockets = new Set<Socket>();
    let server: Server | undefined;
    let port = 0;

    // What a frozen link holds back: the bytes and the closes, in order.
    const held: (() => void)[] = [];
    let frozen = false;
    const deliver = (action: () => void) => {
      if (frozen) {
        held.push(action);
      } else {
        action();
      }
    };

    const forward = (from: Socket, to: Socket) => {
      sockets.add(from);
      from.on("data", (chunk) => deliver(() => to.write(chunk)));
      // A severed socket reports an error and then closes.
      from.on("error", () => undefined);
      from.on("close", () => {
        sockets.delete(from);
        deliver(() => to.destroy());
      });
    };
    const relay = (downstream: Socket) => {
      const upstream = connect(hub.port, HOSTNAME);
      forward(downstream, upstream);
      forward(upstream, downstream);
    };

    const restore = Effect.callback<void>((resume) => {
      if (server !== undefined) {
        resume(Effect.void);
        return;
      }
      const next = createServer(relay);
      next.once("error", (cause) => resume(Effect.die(cause)));
      next.listen(port, HOSTNAME, () => {
        server = next;
        port = (next.address() as AddressInfo).port;
        resume(Effect.void);
      });
    });

    const cut = Effect.callback<void>((resume) => {
      const current = server;
      server = undefined;
      if (current === undefined) {
        resume(Effect.void);
        return;
      }
      current.close(() => resume(Effect.void));
      frozen = false;
      held.length = 0;
      for (const socket of sockets) {
        socket.destroy();
      }
    });
    const freeze = Effect.sync(() => {
      frozen = true;
    });
    const unfreeze = Effect.sync(() => {
      frozen = false;
      for (const action of held.splice(0)) {
        action();
      }
    });

    yield* Effect.acquireRelease(restore, () => cut);
    return {
      cut,
      freeze,
      restore,
      unfreeze,
      url: `http://${HOSTNAME}:${port}`,
    };
  });
