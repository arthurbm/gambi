import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { ActivityLog } from "../components/activity-log";
import { ConfirmModal } from "../components/confirm-modal";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { HealthIndicator } from "../components/health-indicator";
import { ParticipantList } from "../components/participant-list";
import { RoomTabs } from "../components/room-tabs";
import type { Screen } from "../hooks/use-navigation";
import { useParticipantSession } from "../hooks/use-participant-session";
import type { RoomState } from "../hooks/use-rooms";
import { useAppStore } from "../store/app-store";
import { useSessionStore } from "../store/session-store";
import { colors } from "../types";

interface MonitorProps {
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
  const hubUrl = useAppStore((s) => s.hubUrl);
  const [expanded, setExpanded] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const session = useParticipantSession();
  const healthStatus = useSessionStore((s) => s.healthStatus);
  const lastHealthCheck = useSessionStore((s) => s.lastHealthCheck);

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
      // Don't process keys while showing confirmation
      if (showLeaveConfirm) {
        return;
      }

      if (key.name === "escape") {
        onBack();
        return;
      }

      if (key.name === "tab") {
        handleCycleRooms();
      }
      if (key.name === "a") {
        onNavigate("addRoom", {});
      }
      if (key.name === "c") {
        onNavigate("create", {});
      }
      if (key.name === "r") {
        handleRefreshRoom();
      }
      if (key.name === "e") {
        setExpanded((prev) => !prev);
      }
      if (key.name === "l" && session.status === "joined") {
        setShowLeaveConfirm(true);
      }
    },
    { release: false }
  );

  const handleLeaveConfirm = useCallback(() => {
    session.leave();
    setShowLeaveConfirm(false);
  }, [session]);

  const handleLeaveCancel = useCallback(() => {
    setShowLeaveConfirm(false);
  }, []);

  const currentRoom = activeRoom ? rooms.get(activeRoom) : null;

  // Check if user is a participant in current room
  const isParticipant =
    session.status === "joined" && session.roomCode === activeRoom;

  // Show leave confirmation modal
  if (showLeaveConfirm) {
    return (
      <ConfirmModal
        message={`Leave room ${session.roomCode}? Health checks will stop.`}
        onCancel={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        title="Confirm Leave"
      />
    );
  }

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
          <box flexDirection="row" gap={1} paddingRight={2}>
            <text fg={colors.success}>
              ◉ Joined as participant in {session.roomCode}
            </text>
            <HealthIndicator
              lastCheck={lastHealthCheck}
              showLabel
              showLastCheck
              status={healthStatus}
            />
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
              ownHealthStatus={isParticipant ? healthStatus : undefined}
              ownParticipantId={isParticipant ? session.participantId : null}
              participants={currentRoom.participants}
              processingRequests={currentRoom.processingRequests}
              selectedId={
                isParticipant ? (session.participantId ?? undefined) : undefined
              }
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
