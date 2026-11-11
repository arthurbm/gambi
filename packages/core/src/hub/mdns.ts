/**
 * mDNS announcements of the hub. An announcement is a resource: it lives in
 * the `Scope` that made it and is withdrawn when that scope closes.
 */
import type {
  Bonjour as BonjourInstance,
  ServiceConfig,
} from "bonjour-service";
import BonjourDefault, { Bonjour as BonjourNamed } from "bonjour-service";
import { Context, Effect, Layer, Schema, type Scope } from "effect";

/** What the hub announces on the local network. */
export interface MdnsAnnouncement {
  readonly name: string;
  readonly port: number;
  readonly txt: Readonly<Record<string, string>>;
  /** The service type, without the `_` and the protocol: `gambi`. */
  readonly type: string;
}

export class MdnsAnnounceFailed extends Schema.TaggedError<MdnsAnnounceFailed>()(
  "MdnsAnnounceFailed",
  { name: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Could not announce '${this.name}' over mDNS.`;
  }
}

type BonjourConstructor = new () => BonjourInstance;

// The default and the named export differ between the bundler and the runtime.
const resolveBonjourConstructor = (): BonjourConstructor => {
  const candidate =
    BonjourNamed ??
    (typeof BonjourDefault === "function" ? BonjourDefault : undefined);
  if (typeof candidate !== "function") {
    throw new TypeError(
      "bonjour-service did not expose a usable Bonjour constructor"
    );
  }
  return candidate as BonjourConstructor;
};

export class Mdns extends Context.Service<
  Mdns,
  {
    /** Publishes `announcement` until the surrounding scope closes. */
    readonly announce: (
      announcement: MdnsAnnouncement
    ) => Effect.Effect<void, MdnsAnnounceFailed, Scope.Scope>;
    /** The announcements that are live right now. */
    readonly announced: Effect.Effect<readonly MdnsAnnouncement[]>;
  }
>()("gambi/core/Mdns") {
  /**
   * Announces with `bonjour-service`. The responder (and its UDP socket) is
   * created by the first announcement and destroyed when the layer is released.
   */
  static readonly layer = Layer.effect(
    Mdns,
    Effect.gen(function* () {
      const live = new Set<MdnsAnnouncement>();
      let responder: BonjourInstance | undefined;

      yield* Effect.addFinalizer(() =>
        Effect.callback<void>((resume) => {
          if (responder === undefined) {
            resume(Effect.void);
            return;
          }
          const current = responder;
          responder = undefined;
          current.unpublishAll(() => {
            current.destroy(() => resume(Effect.void));
          });
        }).pipe(Effect.timeoutOption("1 second"))
      );

      const announce = Effect.fn("Mdns.announce")(function* (
        announcement: MdnsAnnouncement
      ) {
        yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              responder ??= new (resolveBonjourConstructor())();
              const config: ServiceConfig = {
                name: announcement.name,
                port: announcement.port,
                txt: { ...announcement.txt },
                type: announcement.type,
              };
              const service = responder.publish(config);
              live.add(announcement);
              return service;
            },
            catch: (cause) =>
              new MdnsAnnounceFailed({ name: announcement.name, cause }),
          }),
          (service) =>
            Effect.sync(() => {
              live.delete(announcement);
              service.stop?.();
            })
        );
        yield* Effect.logInfo("mDNS announcement published").pipe(
          Effect.annotateLogs({
            mdnsName: announcement.name,
            port: announcement.port,
          })
        );
      });

      return Mdns.of({
        announce,
        announced: Effect.sync(() => [...live]),
      });
    })
  );

  /** Records announcements in memory and touches no network. */
  static readonly layerTest = Layer.sync(Mdns, () => {
    const live = new Set<MdnsAnnouncement>();
    return Mdns.of({
      announce: (announcement) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            live.add(announcement);
          }),
          () =>
            Effect.sync(() => {
              live.delete(announcement);
            })
        ),
      announced: Effect.sync(() => [...live]),
    });
  });
}
