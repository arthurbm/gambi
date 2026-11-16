import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { watchRooms } from "../rooms/watch-rooms";
import type { RoomState } from "../types";
import { useHubClient } from "./use-hub-client";

export type { RoomState } from "../types";

interface UseRoomsReturn {
  rooms: ReadonlyMap<string, RoomState>;
  activeRoom: string | null;
  setActiveRoom: (code: string | null) => void;
  addRoom: (code: string) => void;
  removeRoom: (code: string) => void;
  allConnected: boolean;
}

/**
 * The rooms the monitor watches. The watching itself, with its
 * reconnection, is `watchRooms`; this hook only shows it to React.
 */
export function useRooms(): UseRoomsReturn {
  const client = useHubClient();
  const watcher = useMemo(() => watchRooms(client), [client]);
  // A watched room keeps the process alive, by its open stream or by the
  // next attempt to watch it again: quitting the TUI unmounts this.
  useEffect(() => () => watcher.close(), [watcher]);

  const rooms = useSyncExternalStore(watcher.subscribe, watcher.rooms);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  const addRoom = useCallback(
    (code: string) => {
      watcher.add(code);
      // The first room added becomes the active one.
      setActiveRoom((current) => current ?? code);
    },
    [watcher]
  );

  const removeRoom = useCallback(
    (code: string) => {
      watcher.remove(code);
      setActiveRoom((current) =>
        current === code
          ? (watcher.rooms().keys().next().value ?? null)
          : current
      );
    },
    [watcher]
  );

  const allConnected =
    rooms.size > 0 && [...rooms.values()].every((r) => r.connected);

  return {
    rooms,
    activeRoom,
    setActiveRoom,
    addRoom,
    removeRoom,
    allConnected,
  };
}
