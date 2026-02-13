import { colors } from "../types";

interface Room {
  code: string;
  connected: boolean;
}

interface RoomListCompactProps {
  rooms: Room[];
  activeRoomCode?: string | null;
  maxVisible?: number;
}

export function RoomListCompact({
  rooms,
  activeRoomCode,
  maxVisible = 5,
}: RoomListCompactProps) {
  const visibleRooms = rooms.slice(0, maxVisible);
  const hiddenCount = Math.max(0, rooms.length - maxVisible);

  if (rooms.length === 0) {
    return (
      <box flexDirection="column">
        <text fg={colors.muted}>Rooms</text>
        <text fg={colors.muted}>No rooms</text>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <text fg={colors.muted}>Rooms ({rooms.length})</text>
      {visibleRooms.map((room) => (
        <box key={room.code}>
          <text>
            <span fg={room.connected ? colors.success : colors.muted}>
              {room.connected ? "●" : "○"}
            </span>
            <span
              fg={room.code === activeRoomCode ? colors.primary : colors.text}
            >
              {" "}
              {room.code}
            </span>
          </text>
        </box>
      ))}
      {hiddenCount > 0 && <text fg={colors.muted}>+{hiddenCount} more</text>}
    </box>
  );
}
