import type { RoomState } from "../types";
import { colors, statusIndicators } from "../types";

interface RoomTabsProps {
  rooms: ReadonlyMap<string, RoomState>;
  activeRoom: string | null;
}

export function RoomTabs({ rooms, activeRoom }: RoomTabsProps) {
  const roomList = [...rooms.values()];

  return (
    <box
      borderStyle="single"
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" gap={2}>
        {roomList.map((room) => {
          const isActive = room.code === activeRoom;
          const indicator = isActive
            ? statusIndicators.selected
            : statusIndicators.offline;
          const participantCount = room.participants.size;

          return (
            <text fg={isActive ? colors.primary : colors.muted} key={room.code}>
              {indicator} {room.code} ({participantCount})
            </text>
          );
        })}
        {roomList.length === 0 && (
          <text fg={colors.muted}>No rooms selected</text>
        )}
      </box>
      <text fg={colors.muted}>[+] Add (a)</text>
    </box>
  );
}
