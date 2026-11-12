import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Clock, Context, Effect, Exit, Layer, Scope } from "effect";
import {
  layerHub,
  layerHubWithoutMdns,
  managementClient,
} from "../testing/hub.ts";
import { Hub, PortInUse } from "./hub.ts";
import { Mdns, MdnsAnnounceFailed } from "./mdns.ts";

/** Starts a hub in a scope of its own, so the test decides when it closes. */
const start = <A, E>(hub: Layer.Layer<A, E>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(hub, scope).pipe(
      Effect.onError(() => Scope.close(scope, Exit.void))
    );
    return { context, close: Scope.close(scope, Exit.void) };
  });

/** The live clock, counting the sleeps that are still pending. */
const countingClock = Effect.gen(function* () {
  const live = yield* Clock.Clock;
  let pending = 0;
  const clock: Clock.Clock = {
    currentTimeMillis: live.currentTimeMillis,
    currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe(),
    currentTimeNanos: live.currentTimeNanos,
    currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    sleep: (duration) =>
      Effect.suspend(() => {
        pending++;
        return live.sleep(duration).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              pending--;
            })
          )
        );
      }),
  };
  return { layer: Layer.succeed(Clock.Clock, clock), pending: () => pending };
});

it.live(
  "a busy port fails with PortInUse and leaves no announcement and no timer",
  () =>
    Effect.gen(function* () {
      const holder = yield* start(layerHub());
      const port = Context.get(holder.context, Hub).port;
      const mdns = yield* Layer.build(Mdns.layerTest);
      const clock = yield* countingClock;

      const error = yield* start(
        layerHubWithoutMdns({ port, mdns: true }).pipe(
          Layer.provide(Layer.succeedContext(mdns)),
          Layer.provide(clock.layer)
        )
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(PortInUse);
      expect(error.message).toContain(String(port));
      expect(yield* Context.get(mdns, Mdns).announced).toEqual([]);
      expect(clock.pending()).toBe(0);

      // The hub that holds the port is untouched.
      const client = yield* managementClient.pipe(
        Effect.provide(holder.context)
      );
      expect((yield* client.hub.health()).status).toBe("ok");
      yield* holder.close;
    })
);

it.live("announces itself over mDNS only after it holds the port", () =>
  Effect.gen(function* () {
    const hub = yield* start(layerHub({ mdns: true }));
    const { port, mdnsName } = Context.get(hub.context, Hub);

    expect(mdnsName).toBe(`gambi-hub-${port}`);
    expect(yield* Context.get(hub.context, Mdns).announced).toEqual([
      {
        name: `gambi-hub-${port}`,
        port,
        type: "gambi",
        txt: { version: "1.0", protocol: "http" },
      },
    ]);
    yield* hub.close;
  })
);

it.live("a failed mDNS announcement gives the port back", () =>
  Effect.gen(function* () {
    // Find a free port by starting and closing a hub on it.
    const probe = yield* start(layerHub());
    const port = Context.get(probe.context, Hub).port;
    yield* probe.close;
    const failing = Layer.succeed(
      Mdns,
      Mdns.of({
        announce: (announcement) =>
          Effect.fail(
            new MdnsAnnounceFailed({
              name: announcement.name,
              cause: new Error("no multicast here"),
            })
          ),
        announced: Effect.succeed([]),
      })
    );

    const error = yield* start(
      layerHubWithoutMdns({ port, mdns: true }).pipe(Layer.provide(failing))
    ).pipe(Effect.flip);
    const second = yield* start(layerHub({ port }));

    expect(error).toBeInstanceOf(MdnsAnnounceFailed);
    expect(Context.get(second.context, Hub).port).toBe(port);
    yield* second.close;
  })
);

it.live("closing the hub frees the port and withdraws the announcement", () =>
  Effect.gen(function* () {
    const first = yield* start(layerHub({ mdns: true }));
    const port = Context.get(first.context, Hub).port;
    const mdns = Context.get(first.context, Mdns);
    const client = yield* managementClient.pipe(Effect.provide(first.context));
    yield* client.hub.health();

    yield* first.close;

    expect(yield* mdns.announced).toEqual([]);
    expect(Exit.isFailure(yield* Effect.exit(client.hub.health()))).toBe(true);
    const second = yield* start(layerHub({ port }));
    expect(Context.get(second.context, Hub).port).toBe(port);
    yield* second.close;
  })
);

it.live("two hubs in one process do not see each other's rooms", () =>
  Effect.gen(function* () {
    const first = yield* start(layerHub());
    const second = yield* start(layerHub());
    const firstClient = yield* managementClient.pipe(
      Effect.provide(first.context)
    );
    const secondClient = yield* managementClient.pipe(
      Effect.provide(second.context)
    );

    const created = yield* firstClient.rooms.create({
      payload: { name: "Só no primeiro" },
    });

    expect(yield* secondClient.rooms.list()).toEqual([]);
    expect(
      (yield* secondClient.rooms
        .get({ params: { code: created.room.code } })
        .pipe(Effect.flip))._tag
    ).toBe("RoomNotFound");

    // Closing one hub leaves the other's rooms alone.
    yield* second.close;
    expect(yield* firstClient.rooms.list()).toHaveLength(1);
    yield* first.close;
  })
);

it.live("announces with the real mDNS responder and withdraws on close", () =>
  Effect.gen(function* () {
    const hub = yield* start(
      layerHubWithoutMdns({ mdns: true }).pipe(Layer.provideMerge(Mdns.layer))
    );
    const mdns = Context.get(hub.context, Mdns);
    const { port } = Context.get(hub.context, Hub);

    expect(
      (yield* mdns.announced).map((announcement) => announcement.name)
    ).toEqual([`gambi-hub-${port}`]);

    yield* hub.close;
    expect(yield* mdns.announced).toEqual([]);
  })
);
