/**
 * The rooms a monitor watches, kept up to date from each room's event stream
 * (`client.events.watch`). It is plain TypeScript, with no React in it:
 * `useRooms` subscribes to it, and the tests run it against a real hub.
 */
import type { GambiClient } from "gambi-sdk";
import { nanoid } from "nanoid";
import type { ActivityLogEntry, RoomEvent, RoomState } from "../types";
import { applyRoomEvent, emptyRoom } from "./room-state";

/** How many lines of activity a room keeps. */
const MAX_LOG_ENTRIES = 100;

/** The room after `event`, with the line the event adds to its activity log. */
const afterEvent = (room: RoomState, event: RoomEvent): RoomState => {
  const result = applyRoomEvent(room, event);
  if (result.log === undefined) {
    return result.room;
  }
  const entry: ActivityLogEntry = {
    ...result.log,
    id: nanoid(),
    roomCode: room.code,
    // The hub's clock: when it happened, not when it got here.
    timestamp: event.timestamp,
  };
  return {
    ...result.room,
    logs: [...result.room.logs, entry].slice(-MAX_LOG_ENTRIES),
  };
};

export interface WatchRoomsOptions {
  /**
   * How long to wait before watching again a room whose stream ended or
   * failed. Default 3 seconds.
   */
  readonly reconnectDelayMs?: number;
}

export interface RoomsWatcher {
  /** Starts watching a room. Does nothing for a room already watched. */
  readonly add: (code: string) => void;
  /** Stops watching every room. */
  readonly close: () => void;
  /** Stops watching a room and forgets what was known of it. */
  readonly remove: (code: string) => void;
  /** The watched rooms. The same map until something changes. */
  readonly rooms: () => ReadonlyMap<string, RoomState>;
  /** Calls `listener` after each change. Returns how to stop. */
  readonly subscribe: (listener: () => void) => () => void;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;

/** Resolves after `ms`, or at once when `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

export const watchRooms = (
  client: Pick<GambiClient, "events">,
  options: WatchRoomsOptions = {}
): RoomsWatcher => {
  const reconnectDelayMs =
    options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  let rooms: ReadonlyMap<string, RoomState> = new Map();
  const listeners = new Set<() => void>();
  const watches = new Map<string, AbortController>();

  const publish = (next: ReadonlyMap<string, RoomState>) => {
    rooms = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const change = (code: string, next: (room: RoomState) => RoomState) => {
    const room = rooms.get(code);
    if (room !== undefined) {
      publish(new Map(rooms).set(code, next(room)));
    }
  };

  /**
   * Watches a room until `signal` aborts. A stream ends without an error when
   * the hub closes, and with one when the hub is unreachable or the room is
   * gone. Both are the same to a monitor: the room is not connected, and it
   * is watched again after a pause. The snapshot that opens the next stream
   * brings whatever happened in between.
   */
  const watch = async (code: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        for await (const event of client.events.watch(code, { signal })) {
          change(code, (room) => afterEvent(room, event));
        }
      } catch {
        // Shown as a room that is not connected.
      }
      if (signal.aborted) {
        return;
      }
      change(code, (room) => ({ ...room, connected: false }));
      await wait(reconnectDelayMs, signal);
    }
  };

  return {
    add: (code) => {
      if (watches.has(code)) {
        return;
      }
      const controller = new AbortController();
      watches.set(code, controller);
      publish(new Map(rooms).set(code, emptyRoom(code)));
      watch(code, controller.signal).catch(() => undefined);
    },
    remove: (code) => {
      watches.get(code)?.abort();
      watches.delete(code);
      if (rooms.has(code)) {
        const next = new Map(rooms);
        next.delete(code);
        publish(next);
      }
    },
    close: () => {
      for (const controller of watches.values()) {
        controller.abort();
      }
      watches.clear();
    },
    rooms: () => rooms,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
