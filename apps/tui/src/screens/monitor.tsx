import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { ActivityLog } from "../components/activity-log";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { ParticipantList } from "../components/participant-list";
import { RoomTabs } from "../components/room-tabs";
import type { Screen } from "../hooks/use-navigation";
import { useParticipantSession } from "../hooks/use-participant-session";
import type { RoomState } from "../hooks/use-rooms";
import { colors } from "../types";

interface MonitorProps {
  hubUrl: string;
  rooms: Map<string, RoomState>;
  activeRoom: string | null;
  allConnected: boolean;
  onSetActiveRoom: (code: string | null) => void;
  onAddRoom: (code: string) => void;
  onRemoveRoom: (code: string) => void;
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

export function Monitor({
  hubUrl,
  rooms,
  activeRoom,
  allConnected,
  onSetActiveRoom,
  onAddRoom,
  onRemoveRoom,
  onNavigate,
  onBack,
  canGoBack,
}: MonitorProps) {
  const [expanded, setExpanded] = useState(false);
  const session = useParticipantSession({ hubUrl });

  const handleCycleRooms = useCallback(() => {
    const roomList = [...rooms.keys()];
    if (roomList.length > 1 && activeRoom) {
      const currentIndex = roomList.indexOf(activeRoom);
      const nextIndex = (currentIndex + 1) % roomList.length;
      onSetActiveRoom(roomList[nextIndex] ?? null);
    }
  }, [rooms, activeRoom, onSetActiveRoom]);

  const handleRefreshRoom = useCallback(() => {
    if (activeRoom && rooms.has(activeRoom)) {
      onRemoveRoom(activeRoom);
      onAddRoom(activeRoom);
    }
  }, [activeRoom, rooms, onRemoveRoom, onAddRoom]);

  useKeyboard(
    (key) => {
      if (key.name === "escape") {
        onBack();
        return;
      }

      if (key.name === "tab") handleCycleRooms();
      if (key.name === "a") onNavigate("addRoom", { hubUrl });
      if (key.name === "c") onNavigate("create", { hubUrl });
      if (key.name === "r") handleRefreshRoom();
      if (key.name === "e") setExpanded((prev) => !prev);
      if (key.name === "l" && session.status === "joined") {
        session.leave();
      }
    },
    { release: false }
  );

  const currentRoom = activeRoom ? rooms.get(activeRoom) : null;

  // Check if user is a participant in current room
  const isParticipant =
    session.status === "joined" && session.roomCode === activeRoom;

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Header with participant badge */}
      <box flexDirection="row" justifyContent="space-between">
        <Header
          connected={allConnected}
          hubUrl={hubUrl}
          roomCount={rooms.size}
        />
        {session.status === "joined" && (
          <box paddingRight={2}>
            <text fg={colors.success}>
              ◉ Joined as participant in {session.roomCode}
            </text>
          </box>
        )}
      </box>

      {/* Room tabs */}
      <RoomTabs activeRoom={activeRoom} rooms={rooms} />

      {/* Main content area */}
      <box flexDirection="row" flexGrow={1}>
        {/* Participants panel */}
        <box flexGrow={1}>
          {currentRoom ? (
            <ParticipantList
              expanded={expanded}
              participants={currentRoom.participants}
              processingRequests={currentRoom.processingRequests}
              selectedId={isParticipant ? session.participantId ?? undefined : undefined}
            />
          ) : (
            <box
              alignItems="center"
              borderStyle="single"
              flexGrow={1}
              justifyContent="center"
            >
              <text fg={colors.muted}>No room selected</text>
            </box>
          )}
        </box>

        {/* Activity log panel */}
        <box flexGrow={1}>
          {currentRoom ? (
            <ActivityLog entries={currentRoom.logs} />
          ) : (
            <box
              alignItems="center"
              borderStyle="single"
              flexGrow={1}
              justifyContent="center"
            >
              <text fg={colors.muted}>No activity</text>
            </box>
          )}
        </box>
      </box>

      {/* Footer */}
      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "Tab", description: "Switch room" },
          { key: "a", description: "Add room" },
          { key: "c", description: "Create room" },
          { key: "e", description: expanded ? "Collapse" : "Expand" },
          { key: "r", description: "Refresh" },
          ...(session.status === "joined"
            ? [{ key: "l", description: "Leave" }]
            : []),
        ]}
      />
    </box>
  );
}
