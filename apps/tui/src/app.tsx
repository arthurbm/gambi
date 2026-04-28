import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useState } from "react";
import { AddRoomModal } from "./components/add-room-modal";
import { ConfirmModal } from "./components/confirm-modal";
import { Footer } from "./components/footer";
import { HealthNotification } from "./components/health-notification";
import { Sidebar } from "./components/sidebar";
import { useHubHealthQuery } from "./hooks/queries";
import { useNavigation } from "./hooks/use-navigation";
import { useParticipantSession } from "./hooks/use-participant-session";
import { useRooms } from "./hooks/use-rooms";
import { CreateRoom } from "./screens/create-room";
import { JoinRoom } from "./screens/join-room";
import { ListRooms } from "./screens/list-rooms";
import { MainMenu } from "./screens/main-menu";
import { Monitor } from "./screens/monitor";
import { ServeHub } from "./screens/serve-hub";
import { shutdownHub, useHubStore } from "./store/hub-store";

// Layout wrapper that includes sidebar and notifications
function WithSidebar({ children }: { children: React.ReactNode }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <HealthNotification />
      <box flexDirection="row" flexGrow={1}>
        <Sidebar />
        <box flexDirection="column" flexGrow={1}>
          {children}
        </box>
      </box>
    </box>
  );
}

type ConfirmAction = "quit" | "leave" | null;

export function App() {
  const renderer = useRenderer();
  const hubStatus = useHubStore((s) => s.status);
  const session = useParticipantSession();

  // Confirmation modal state
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction>(null);
  const [isQuitting, setIsQuitting] = useState(false);

  // Run periodic health checks on the local hub
  useHubHealthQuery();

  const { screen, params, navigate, goBack, canGoBack } = useNavigation({
    initialScreen: "menu",
  });

  const {
    rooms,
    activeRoom,
    setActiveRoom,
    addRoom,
    removeRoom,
    allConnected,
  } = useRooms();

  // Check if confirmation is needed before quitting
  const hasActiveSession =
    session.status === "joining" ||
    session.status === "joined" ||
    session.status === "leaving";
  const needsQuitConfirmation = hubStatus === "running" || hasActiveSession;

  const doQuit = useCallback(async () => {
    if (isQuitting) {
      return;
    }
    setIsQuitting(true);
    if (hasActiveSession) {
      await session.leave();
    }
    shutdownHub();
    renderer.destroy();
  }, [renderer, session, hasActiveSession, isQuitting]);

  const handleQuit = useCallback(() => {
    if (isQuitting) {
      return;
    }
    if (needsQuitConfirmation) {
      setPendingConfirm("quit");
    } else {
      void doQuit();
    }
  }, [needsQuitConfirmation, doQuit, isQuitting]);

  const handleConfirm = useCallback(() => {
    if (isQuitting) {
      return;
    }
    if (pendingConfirm === "quit") {
      void doQuit();
    } else if (pendingConfirm === "leave") {
      void session.leave();
    }
    setPendingConfirm(null);
  }, [pendingConfirm, doQuit, session, isQuitting]);

  const handleCancelConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  // Screens with text inputs that should NOT receive global shortcuts
  const screensWithInputs = ["create", "join", "addRoom"];
  const hasActiveInput = screensWithInputs.includes(screen);

  // Global keyboard shortcuts for navigation
  useKeyboard(
    (key) => {
      // Don't capture shortcuts when modal is showing or on screens with inputs
      if (pendingConfirm || hasActiveInput) {
        return;
      }

      // Global quit
      if (key.name === "q") {
        handleQuit();
        return;
      }

      // Global navigation shortcuts (h/c/j/m)
      // Only navigate if not already on that screen
      if (key.name === "h" && screen !== "serve") {
        navigate("serve", {});
        return;
      }
      if (key.name === "c" && screen !== "create") {
        navigate("create", {});
        return;
      }
      if (key.name === "j" && screen !== "join") {
        navigate("join", {});
        return;
      }
      if (key.name === "m" && screen !== "monitor") {
        navigate("monitor", {});
        return;
      }
      if (key.name === "l" && screen !== "list") {
        navigate("list", {});
        return;
      }
    },
    { release: false }
  );

  // Confirmation Modal
  if (isQuitting) {
    return (
      <WithSidebar>
        <box alignItems="center" flexGrow={1} justifyContent="center">
          <text>Leaving participant session and shutting down...</text>
        </box>
      </WithSidebar>
    );
  }

  if (pendingConfirm === "quit") {
    const reasons: string[] = [];
    if (hubStatus === "running") {
      reasons.push("Hub is running");
    }
    if (hasActiveSession) {
      reasons.push("You are joined in a room");
    }
    return (
      <WithSidebar>
        <ConfirmModal
          message={
            isQuitting
              ? "Closing participant tunnel..."
              : `${reasons.join(" and ")}. Are you sure you want to quit?`
          }
          onCancel={handleCancelConfirm}
          onConfirm={handleConfirm}
          title="Confirm Quit"
        />
      </WithSidebar>
    );
  }

  if (pendingConfirm === "leave") {
    return (
      <WithSidebar>
        <ConfirmModal
          message="Are you sure you want to leave the room?"
          onCancel={handleCancelConfirm}
          onConfirm={handleConfirm}
          title="Confirm Leave"
        />
      </WithSidebar>
    );
  }

  // Screen: Menu Principal
  if (screen === "menu") {
    return (
      <WithSidebar>
        <MainMenu onNavigate={navigate} onQuit={handleQuit} />
      </WithSidebar>
    );
  }

  // Screen: Serve Hub
  if (screen === "serve") {
    return (
      <WithSidebar>
        <ServeHub canGoBack={canGoBack()} onBack={goBack} />
      </WithSidebar>
    );
  }

  // Screen: Create Room
  if (screen === "create") {
    return (
      <WithSidebar>
        <CreateRoom
          canGoBack={canGoBack()}
          onBack={goBack}
          onNavigate={(s, p) => {
            if (p.roomCodes) {
              for (const code of p.roomCodes as string[]) {
                addRoom(code);
              }
            }
            navigate(s, p as Record<string, unknown>);
          }}
        />
      </WithSidebar>
    );
  }

  // Screen: List Rooms
  if (screen === "list") {
    return (
      <WithSidebar>
        <ListRooms
          canGoBack={canGoBack()}
          onBack={goBack}
          onNavigate={(s, p) => {
            if (p.roomCodes) {
              for (const code of p.roomCodes as string[]) {
                addRoom(code);
              }
            }
            navigate(s, p as Record<string, unknown>);
          }}
        />
      </WithSidebar>
    );
  }

  // Screen: Join Room
  if (screen === "join") {
    return (
      <WithSidebar>
        <JoinRoom
          canGoBack={canGoBack()}
          onBack={goBack}
          onNavigate={(s, p) => {
            if (p.roomCodes) {
              for (const code of p.roomCodes as string[]) {
                addRoom(code);
              }
            }
            navigate(s, p as Record<string, unknown>);
          }}
          roomCode={params.roomCode as string | undefined}
        />
      </WithSidebar>
    );
  }

  // Screen: Add Room Modal (no sidebar - it's a modal overlay)
  if (screen === "addRoom") {
    return (
      <AddRoomModal
        onAdd={(code) => {
          addRoom(code);
          navigate("monitor", { roomCodes: [code] });
        }}
        onCancel={() => goBack()}
      />
    );
  }

  // Screen: Monitor (Dashboard)
  if (screen === "monitor") {
    return (
      <WithSidebar>
        <Monitor
          activeRoom={activeRoom}
          allConnected={allConnected}
          canGoBack={canGoBack()}
          onAddRoom={addRoom}
          onBack={goBack}
          onNavigate={(s, p) => {
            if (p.roomCodes) {
              for (const code of p.roomCodes as string[]) {
                addRoom(code);
              }
            }
            navigate(s, p as Record<string, unknown>);
          }}
          onRemoveRoom={removeRoom}
          onSetActiveRoom={setActiveRoom}
          rooms={rooms}
        />
      </WithSidebar>
    );
  }

  // Fallback: Telas não implementadas
  return (
    <WithSidebar>
      <box
        alignItems="center"
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
      >
        <text>Screen not implemented: {screen}</text>
        <text>Press ESC to go back or q to quit</text>
        <Footer canGoBack={canGoBack()} />
      </box>
    </WithSidebar>
  );
}
