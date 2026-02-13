import { useAppStore } from "../store/app-store";
import { useSessionStore } from "../store/session-store";
import { colors } from "../types";
import { HubStatusIndicator } from "./hub-status";
import { RoomListCompact } from "./room-list-compact";
import { SessionBadge } from "./session-badge";

const SIDEBAR_WIDTH = 18;

export function Sidebar() {
  const activeRooms = useAppStore((s) => s.activeRooms);
  const sessionRoomCode = useSessionStore((s) => s.roomCode);

  return (
    <box
      border
      borderColor={colors.muted}
      borderStyle="single"
      flexDirection="column"
      gap={2}
      paddingLeft={1}
      paddingRight={1}
      width={SIDEBAR_WIDTH}
    >
      {/* Hub Status - Top */}
      <box paddingTop={1}>
        <HubStatusIndicator />
      </box>

      {/* Room List - Middle (grows) */}
      <box flexGrow={1}>
        <RoomListCompact activeRoomCode={sessionRoomCode} rooms={activeRooms} />
      </box>

      {/* Session Badge - Bottom */}
      <box paddingBottom={1}>
        <SessionBadge />
      </box>
    </box>
  );
}
