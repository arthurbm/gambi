/**
 * The management clients attached to the harness participants of one hub.
 *
 * A harness participant sends its events up through one long-lived tunnel
 * call (`HarnessEvents`), which `Tunnels` opens on every tunnel. `Tunnels`
 * hands each event to `deliver`, and `deliver` hands it to every client
 * attached to that participant.
 *
 * `deliver` never waits. One fiber reads the socket of a tunnel: it hands each
 * chunk of a stream call to the buffer of that call and waits while the buffer
 * is full. A delivery that waited for a slow client would fill that buffer
 * and stop the fiber, and with it every other call of the tunnel, pongs
 * included; two ping intervals later the hub would drop the tunnel for
 * silence. Each client therefore has its own bounded buffer: when it is full
 * the oldest event leaves, and the client reads a `harness.dropped` with the
 * count at that point of its stream. A slow client loses events of its own
 * and holds back nobody else.
 *
 * A client is attached to a participant, not to a tunnel: it stays attached
 * while the tunnel is down and reads `harness.disconnected` and, when the
 * participant is back, `harness.connected`.
 */
import type { HarnessAttachEvent, HarnessDetached } from "@gambi/protocol";
import {
  type Array as Arr,
  Cause,
  Context,
  Effect,
  Layer,
  type Scope,
  Stream,
} from "effect";
import { participantKey } from "./participant-key.ts";
import { HubSettings } from "./settings.ts";

/** The events held for one attached client, until it reads them. */
interface Mailbox {
  /** Nothing more will come: the client reads what is held and its stream ends. */
  readonly end: () => void;
  readonly offer: (event: HarnessAttachEvent) => void;
  /** What is held, at least one event. Fails with `Cause.Done` after `end`. */
  readonly take: Effect.Effect<
    Arr.NonEmptyReadonlyArray<HarnessAttachEvent>,
    Cause.Done
  >;
}

const makeMailbox = (capacity: number): Mailbox => {
  let held: HarnessAttachEvent[] = [];
  let dropped = 0;
  let ended = false;
  let wake: (() => void) | undefined;

  const drain = ():
    | Arr.NonEmptyReadonlyArray<HarnessAttachEvent>
    | undefined => {
    if (held.length === 0 && dropped === 0) {
      return undefined;
    }
    // What was dropped is older than everything still held, and newer than
    // everything already read: the notice goes first.
    const batch: [HarnessAttachEvent, ...HarnessAttachEvent[]] =
      dropped > 0
        ? [{ type: "harness.dropped", count: dropped }, ...held]
        : (held as [HarnessAttachEvent, ...HarnessAttachEvent[]]);
    held = [];
    dropped = 0;
    return batch;
  };

  return {
    end: () => {
      ended = true;
      wake?.();
    },
    offer: (event) => {
      if (ended) {
        return;
      }
      if (held.length >= capacity) {
        held.shift();
        dropped++;
      }
      held.push(event);
      wake?.();
    },
    take: Effect.callback((resume) => {
      const settle = () => {
        const batch = drain();
        if (batch !== undefined) {
          resume(Effect.succeed(batch));
          return true;
        }
        if (ended) {
          resume(Cause.done());
          return true;
        }
        return false;
      };
      if (settle()) {
        return;
      }
      // Cleared before resuming: the reader may ask again at once, and that
      // sets a new one. It is only called with something to settle.
      wake = () => {
        wake = undefined;
        settle();
      };
      return Effect.sync(() => {
        wake = undefined;
      });
    }),
  };
};

interface Attached {
  readonly clients: Set<Mailbox>;
  /** `undefined` while the hub is receiving the participant's events. */
  disconnected:
    | Extract<HarnessAttachEvent, { type: "harness.disconnected" }>
    | undefined;
}

const NO_TUNNEL = {
  type: "harness.disconnected",
  reason: "NoTunnel",
} as const;

export class HarnessClients extends Context.Service<
  HarnessClients,
  {
    /**
     * Attaches a client to the participant and returns its events, from this
     * moment on. The first one says whether the hub is receiving the
     * participant's events (`harness.connected`) or not
     * (`harness.disconnected`). The client is attached when this returns and
     * detached when the scope closes.
     *
     * It does not ask whether the participant exists or has a harness: the
     * caller answers for that.
     */
    readonly attach: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<Stream.Stream<HarnessAttachEvent>, never, Scope.Scope>;
    /**
     * Detaches every client of a participant that is out of the room: each
     * reads a last `harness.detached` and its stream ends.
     */
    readonly detach: (
      roomCode: string,
      participantId: string,
      reason: HarnessDetached["reason"]
    ) => Effect.Effect<void>;
    /** How many clients are attached to the participant. */
    readonly count: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<number>;
    /**
     * Hands an event of the participant to every client attached to it. It
     * never waits for a client.
     */
    readonly deliver: (
      roomCode: string,
      participantId: string,
      event: HarnessAttachEvent
    ) => Effect.Effect<void>;
  }
>()("gambi/core/HarnessClients") {
  static readonly layer = Layer.effect(
    HarnessClients,
    Effect.gen(function* () {
      const settings = yield* HubSettings;
      const attached = new Map<string, Attached>();

      const entryOf = (key: string): Attached => {
        let entry = attached.get(key);
        if (entry === undefined) {
          entry = { clients: new Set(), disconnected: NO_TUNNEL };
          attached.set(key, entry);
        }
        return entry;
      };
      // An entry says something only while a client is attached or the
      // participant is connected. Anything else is the default.
      const forget = (key: string, entry: Attached) => {
        if (entry.clients.size === 0 && entry.disconnected !== undefined) {
          attached.delete(key);
        }
      };

      const attach = (roomCode: string, participantId: string) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const entry = entryOf(participantKey(roomCode, participantId));
            const mailbox = makeMailbox(settings.harnessClientBuffer);
            entry.clients.add(mailbox);
            return {
              mailbox,
              initial:
                entry.disconnected ?? ({ type: "harness.connected" } as const),
            };
          }),
          ({ mailbox }) =>
            Effect.sync(() => {
              const key = participantKey(roomCode, participantId);
              const entry = attached.get(key);
              if (entry !== undefined) {
                entry.clients.delete(mailbox);
                forget(key, entry);
              }
            })
        ).pipe(
          Effect.map(({ initial, mailbox }) =>
            Stream.concat(
              Stream.succeed(initial),
              Stream.fromEffectRepeat(mailbox.take).pipe(Stream.flattenArray)
            )
          )
        );

      const deliver = (
        roomCode: string,
        participantId: string,
        event: HarnessAttachEvent
      ) =>
        Effect.sync(() => {
          const key = participantKey(roomCode, participantId);
          const entry = entryOf(key);
          if (event.type === "harness.connected") {
            entry.disconnected = undefined;
          } else if (event.type === "harness.disconnected") {
            entry.disconnected = event;
          }
          for (const client of entry.clients) {
            client.offer(event);
          }
          forget(key, entry);
        });

      const detach = (
        roomCode: string,
        participantId: string,
        reason: HarnessDetached["reason"]
      ) =>
        Effect.sync(() => {
          const key = participantKey(roomCode, participantId);
          const entry = attached.get(key);
          if (entry === undefined) {
            return;
          }
          attached.delete(key);
          for (const client of entry.clients) {
            client.offer({ type: "harness.detached", reason });
            client.end();
          }
        });

      return HarnessClients.of({
        attach,
        detach,
        count: (roomCode, participantId) =>
          Effect.sync(
            () =>
              attached.get(participantKey(roomCode, participantId))?.clients
                .size ?? 0
          ),
        deliver,
      });
    })
  );
}
